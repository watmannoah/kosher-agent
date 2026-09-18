/**
 * Cost and abuse controls.
 *
 * A public endpoint that calls a paid model without these is negligence, so
 * they are not optional and they are not advisory — /api/turn refuses before
 * reaching a model.
 *
 * Two deliberate asymmetries:
 *
 *   Rate limits FAIL OPEN. If the counter backend is unreachable, a visitor
 *   gets through. The cost of a stranger seeing a broken demo is higher than
 *   the cost of a few extra turns.
 *
 *   The spend cap FAILS CLOSED. If we cannot confirm how much has been spent
 *   today, we assume the worst and degrade to scripted mode. An unbounded bill
 *   is not recoverable; a visitor seeing an honest banner is.
 */

import config from '@config/agent.config.json';
import { safely, store } from '../store/adapter';

const DAY_SECONDS = 86_400;
const HOUR_SECONDS = 3_600;
const MINUTE_SECONDS = 60;

/** UTC day key, so the cap resets on a boundary rather than a rolling window. */
function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dailySpendCapUsd(): number {
  const override = Number(process.env.DAILY_SPEND_CAP_USD);
  return Number.isFinite(override) && override > 0 ? override : config.limits.dailySpendCapUsd;
}

/**
 * Client identity for rate limiting.
 *
 * Vercel sets x-forwarded-for; the leftmost entry is the client and the rest
 * are proxies. Taking the last entry — a common mistake — would bucket every
 * visitor into one proxy address and rate-limit them collectively.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? 'unknown';
}

export interface LimitDecision {
  allowed: boolean;
  /** Machine-readable, for the client to branch on. */
  reason?:
    | 'rate_limited_minute'
    | 'rate_limited_hour'
    | 'eval_rate_limited'
    | 'eval_daily_limit'
    | 'attack_rate_limited'
    | 'session_turn_limit'
    | 'daily_spend_cap'
    | 'session_spend_cap';
  /** Shown to the visitor. Honest about what happened. */
  message?: string;
  retryAfterSeconds?: number;
}

const ALLOWED: LimitDecision = { allowed: true };

// --- Spend -----------------------------------------------------------------

/** Spend recorded so far today, in USD. Stored in micro-dollars as an integer. */
export async function spentTodayUsd(): Promise<number | null> {
  const micro = await safely(
    () => store().get(`spend:${dayKey()}`).then((v) => v as number | null),
    null,
  );
  if (micro === null) return null;
  return micro / 1_000_000;
}

/** Record spend after a turn. Integer micro-dollars, because INCRBY is integral. */
export async function recordSpend(usd: number): Promise<void> {
  if (usd <= 0) return;
  const micro = Math.max(1, Math.round(usd * 1_000_000));
  await safely(() => store().increment(`spend:${dayKey()}`, DAY_SECONDS, micro), 0);
}

/**
 * Whether we are inside the daily budget.
 *
 * Fails closed: a null reading means the backend did not answer, and we refuse
 * rather than assume there is headroom.
 */
export async function checkSpendCap(): Promise<LimitDecision> {
  const cap = dailySpendCapUsd();
  const spent = await spentTodayUsd();

  if (spent === null) {
    return {
      allowed: false,
      reason: 'daily_spend_cap',
      message:
        'The spend counter is unreachable, so the system has degraded to scripted mode rather ' +
        'than risk an uncapped bill. Recorded sessions and the evals report still work.',
    };
  }

  if (spent >= cap) {
    return {
      allowed: false,
      reason: 'daily_spend_cap',
      message:
        `The daily demonstration budget of $${cap.toFixed(2)} is spent, so live calls are off ` +
        `until tomorrow. This is a deliberate cap, not a fault — the recorded sessions and the ` +
        `last eval report are still live below.`,
    };
  }

  return ALLOWED;
}

export async function checkSessionSpend(sessionCostUsd: number): Promise<LimitDecision> {
  if (sessionCostUsd < config.limits.sessionSpendCapUsd) return ALLOWED;
  return {
    allowed: false,
    reason: 'session_spend_cap',
    message:
      `This session has reached its $${config.limits.sessionSpendCapUsd.toFixed(2)} budget. ` +
      `Reload to start a new one.`,
  };
}

// --- Rate limits -----------------------------------------------------------

async function underLimit(
  key: string,
  ttl: number,
  max: number,
): Promise<{ ok: boolean; count: number }> {
  // Fails open: an unreachable backend returns 0, which is under any limit.
  const count = await safely(() => store().increment(key, ttl), 0);
  return { ok: count <= max, count };
}

export async function checkTurnRate(ip: string): Promise<LimitDecision> {
  const limits = config.limits.rateLimits;

  const minute = await underLimit(
    `rate:turn:m:${ip}:${Math.floor(Date.now() / 60_000)}`,
    MINUTE_SECONDS,
    limits.turnsPerIpPerMinute,
  );
  if (!minute.ok) {
    return {
      allowed: false,
      reason: 'rate_limited_minute',
      message: `That is more than ${limits.turnsPerIpPerMinute} turns in a minute. Give it a moment.`,
      retryAfterSeconds: 60,
    };
  }

  const hour = await underLimit(
    `rate:turn:h:${ip}:${Math.floor(Date.now() / 3_600_000)}`,
    HOUR_SECONDS,
    limits.turnsPerIpPerHour,
  );
  if (!hour.ok) {
    return {
      allowed: false,
      reason: 'rate_limited_hour',
      message: `Hourly limit of ${limits.turnsPerIpPerHour} turns reached for this address.`,
      retryAfterSeconds: 600,
    };
  }

  return ALLOWED;
}

export async function checkEvalRate(ip: string): Promise<LimitDecision> {
  const limits = config.limits.rateLimits;

  const perIp = await underLimit(
    `rate:eval:h:${ip}:${Math.floor(Date.now() / 3_600_000)}`,
    HOUR_SECONDS,
    limits.evalRunsPerIpPerHour,
  );
  if (!perIp.ok) {
    return {
      allowed: false,
      reason: 'eval_rate_limited',
      message:
        `The suite can be run ${limits.evalRunsPerIpPerHour} times an hour from one address. ` +
        `It is a real run against real models each time, so it costs real money. The last ` +
        `report is still shown below.`,
      retryAfterSeconds: 900,
    };
  }

  const global = await underLimit(
    `rate:eval:d:${dayKey()}`,
    DAY_SECONDS,
    limits.evalRunsPerDayGlobal,
  );
  if (!global.ok) {
    return {
      allowed: false,
      reason: 'eval_daily_limit',
      message: 'The suite has hit its daily run limit across all visitors. The last report stands.',
    };
  }

  return ALLOWED;
}

export async function checkAttackRate(ip: string): Promise<LimitDecision> {
  const max = config.limits.rateLimits.attacksPerIpPerMinute;
  const result = await underLimit(
    `rate:attack:m:${ip}:${Math.floor(Date.now() / 60_000)}`,
    MINUTE_SECONDS,
    max,
  );
  if (!result.ok) {
    return {
      allowed: false,
      reason: 'attack_rate_limited',
      message: `More than ${max} attempts a minute from one address. Give it a moment.`,
      retryAfterSeconds: 60,
    };
  }
  return ALLOWED;
}

export function checkSessionTurns(turnId: number): LimitDecision {
  if (turnId <= config.limits.maxTurnsPerSession) return ALLOWED;
  return {
    allowed: false,
    reason: 'session_turn_limit',
    message:
      `This session has reached ${config.limits.maxTurnsPerSession} turns, which is the cap. ` +
      `Reload to start a new one.`,
  };
}

// --- Adversarial attempt log ----------------------------------------------

export interface LoggedAttempt {
  at: string;
  attackId: string | null;
  text: string;
  outcome: string;
  guardrails: string[];
  blocked: boolean;
}

const ATTEMPT_LOG_KEY = 'attempts:log';
const ATTEMPT_LOG_CAP = 60;

/**
 * Record an adversarial attempt for the public attempts panel.
 *
 * Text is truncated and the log is capped. Visitors can type anything into the
 * free-text attack box, and whatever they type is shown to later visitors, so
 * this is user-generated content on a shared surface — the client escapes it on
 * render, and it is never treated as instructions anywhere.
 */
export async function logAttempt(attempt: LoggedAttempt): Promise<void> {
  await safely(
    () =>
      store().push(
        ATTEMPT_LOG_KEY,
        { ...attempt, text: attempt.text.slice(0, 240) },
        ATTEMPT_LOG_CAP,
        DAY_SECONDS * 7,
      ),
    undefined,
  );
}

export async function recentAttempts(limit = 25): Promise<LoggedAttempt[]> {
  const raw = await safely(() => store().list(ATTEMPT_LOG_KEY, limit), []);
  return raw.filter((r): r is LoggedAttempt => Boolean(r) && typeof r === 'object');
}

export async function countAttempts(): Promise<number> {
  const raw = await safely(() => store().list(ATTEMPT_LOG_KEY, ATTEMPT_LOG_CAP), []);
  return raw.length;
}

export function storeDescription(): { backend: string; durable: boolean } {
  const s = store();
  return { backend: s.backendName(), durable: s.durable() };
}
