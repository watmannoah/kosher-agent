/**
 * Complaint intake, Rav escalation, and hotline hours.
 *
 * Case and escalation references are derived deterministically from their
 * inputs rather than randomly. Two reasons: the evals can assert on them, and a
 * serverless deployment has no shared counter to allocate from — a random
 * reference would look real but could collide, and an agent must never invent a
 * case number it then cannot honour.
 */

import config from '@config/agent.config.json';
import certificationData from '@data/certification.json';
import { fail, ok, type ToolResult } from './types';
import { classifyDay, spokenTime, sunset, REFERENCE_LOCATION } from './calendar';

/** Stable short reference from arbitrary input. */
function reference(prefix: string, ...parts: string[]): string {
  const joined = parts.join('|');
  let hash = 0;
  for (let i = 0; i < joined.length; i++) {
    hash = (hash * 33 + joined.charCodeAt(i)) % 1000000;
  }
  return `${prefix}-${String(hash).padStart(6, '0')}`;
}

// --- Hours -----------------------------------------------------------------

/** Hotline closes this many minutes before candle lighting on an erev. */
const CLOSE_BEFORE_CANDLES_MIN = 120;

export interface GetHoursArgs {
  date?: string;
  /** Injected by the pipeline; lets evals pin a date without touching the clock. */
  now?: Date;
}

export function getHours(args: GetHoursArgs = {}): ToolResult {
  const now = args.now ?? new Date();
  const target = args.date?.trim() ? new Date(`${args.date.trim()}T12:00:00Z`) : now;

  if (Number.isNaN(target.getTime())) {
    return fail('invalid_arguments', `Could not read "${args.date}" as a date.`);
  }

  const day = classifyDay(target);
  const org = config.organisation;

  let openState: 'open' | 'closed' | 'closing_early';
  let explanation: string;

  if (day.isShabbos && day.isYomTov) {
    openState = 'closed';
    explanation = `Closed — it is Shabbos and ${day.yomTovName}.`;
  } else if (day.isShabbos) {
    openState = 'closed';
    explanation = 'Closed for Shabbos.';
  } else if (day.isYomTov) {
    openState = 'closed';
    explanation = `Closed for ${day.yomTovName}.`;
  } else if (day.isErevShabbos || day.isErevYomTov) {
    openState = 'closing_early';
    const set = sunset(target, REFERENCE_LOCATION.latitude, REFERENCE_LOCATION.longitude);
    const closeAt = set
      ? new Date(
          set.getTime() -
            (18 + CLOSE_BEFORE_CANDLES_MIN) * 60000,
        )
      : null;
    explanation =
      `Open this morning but closing early — it is ${day.isErevShabbos ? 'Erev Shabbos' : `Erev ${day.erevOf}`}. ` +
      `Candle lighting in ${org.referenceCity} is ${day.candleLightingLocal}` +
      (closeAt ? `, and the hotline closes two hours before that, at ${spokenTime(closeAt)}.` : '.');
  } else {
    openState = 'open';
    explanation = `Open — ${org.hotlineHours.weekday}.`;
  }

  return ok({
    query: { date: day.date },
    referenceCity: org.referenceCity,
    weekday: day.weekday,
    hebrewDate: `${day.hebrew.day} ${day.hebrew.month} ${day.hebrew.year}`,
    openState,
    explanation,
    isShabbos: day.isShabbos,
    isYomTov: day.isYomTov,
    yomTovName: day.yomTovName,
    isCholHamoed: day.isCholHamoed,
    isErevShabbos: day.isErevShabbos,
    isErevYomTov: day.isErevYomTov,
    erevOf: day.erevOf,
    sunsetLocal: day.sunsetLocal,
    candleLightingLocal: day.candleLightingLocal,
    candleLightingCaveat:
      day.candleLightingLocal
        ? 'Candle lighting is calculated as 18 minutes before sunset for ' +
          `${org.referenceCity}. That is the widespread custom but not universal, and times ` +
          'differ by location — tell the caller to use their own local time.'
        : null,
    standardHours: org.hotlineHours,
    emergencyPath:
      openState === 'open'
        ? null
        : org.emergencyPath,
    dataNotice: config.organisation.disclaimer,
  });
}

// --- Rav escalation --------------------------------------------------------

export interface EscalateArgs {
  question?: string;
  urgency?: 'normal' | 'high' | string;
  now?: Date;
}

/**
 * Route a shailah to the Rav on call.
 *
 * Returns what actually happens next — available now, or a callback window —
 * so the shailah agent can tell the caller something concrete rather than a
 * vague promise. After-hours handling is derived from the same calendar the
 * hours tool uses, so the two can never disagree.
 */
export function escalateToRav(args: EscalateArgs): ToolResult {
  const question = (args.question ?? '').trim();
  const urgency = args.urgency === 'high' ? 'high' : 'normal';
  const now = args.now ?? new Date();

  if (!question) {
    return fail(
      'missing_required_detail',
      'Nothing to pass on. Capture the question in the caller\'s own words before escalating.',
    );
  }

  const day = classifyDay(now);
  const closed = day.isShabbos || day.isYomTov;
  const closingEarly = day.isErevShabbos || day.isErevYomTov;

  const ref = reference('RAV', question, day.date, urgency);

  let availability: string;
  let callbackWindow: string;

  if (closed) {
    availability = 'after_hours';
    callbackWindow =
      urgency === 'high'
        ? 'The Rav on call can be reached now through the emergency line for an urgent kashrus ' +
          'matter. Otherwise the office returns calls when it reopens.'
        : `The office is closed${day.yomTovName ? ` for ${day.yomTovName}` : ' for Shabbos'}. The ` +
          'Rav will call back when it reopens. If it cannot wait, the emergency line reaches the ' +
          'Rav on call now.';
  } else if (closingEarly) {
    availability = 'closing_soon';
    callbackWindow =
      `It is ${day.isErevShabbos ? 'Erev Shabbos' : `Erev ${day.erevOf}`} and the office closes ` +
      `two hours before candle lighting at ${day.candleLightingLocal}. The Rav will call back ` +
      `today if there is time, and otherwise after${day.isErevShabbos ? ' Shabbos' : ` ${day.erevOf}`}. ` +
      `The emergency line reaches the Rav on call if it cannot wait.`;
  } else {
    availability = 'available';
    callbackWindow =
      urgency === 'high'
        ? 'The Rav on call can take this now — offer to put the caller through.'
        : 'The Rav returns calls the same business day.';
  }

  return ok({
    escalated: true,
    reference: ref,
    question,
    urgency,
    availability,
    callbackWindow,
    emergencyPath: config.organisation.emergencyPath,
    hotlineState: {
      isShabbos: day.isShabbos,
      isYomTov: day.isYomTov,
      yomTovName: day.yomTovName,
      isErevShabbos: day.isErevShabbos,
      candleLightingLocal: day.candleLightingLocal,
    },
    instruction:
      'Tell the caller what this returned — the availability and the callback window — using the ' +
      'reference above. Give no halachic content of any kind: not a principle, not a ' +
      'consideration, not a hint at the answer, not whether it is likely to be fine.',
  });
}

// --- Complaints ------------------------------------------------------------

export interface OpenComplaintArgs {
  product_id?: string;
  details?: string;
  callback?: string;
}

export function openComplaint(args: OpenComplaintArgs): ToolResult {
  const details = (args.details ?? '').trim();
  const callback = (args.callback ?? '').trim();
  const productId = (args.product_id ?? '').trim();

  if (!details) {
    return fail(
      'missing_required_detail',
      'Cannot open a case without what the caller observed. Ask what they saw, on what product, ' +
        'and where they bought it.',
    );
  }
  if (!callback) {
    return fail(
      'missing_required_detail',
      'Cannot open a case without a callback number or email. Ask for one — do not open the case ' +
        'and do not give out a case number until you have it.',
    );
  }

  return ok({
    opened: true,
    caseNumber: reference('KC', details, callback),
    productId: productId || null,
    details,
    callback,
    department: certificationData.departmentContact,
    slaBusinessDays: 2,
    tellCaller:
      'Give the caller the case number exactly as returned here and say someone will be in touch ' +
      'within two business days. Never invent a case number. Do not concede fault, do not promise ' +
      'a particular outcome, and do not speculate about what happened.',
  });
}
