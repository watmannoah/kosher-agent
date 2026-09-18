/**
 * POST /api/turn — run one conversational turn, streamed as SSE.
 *
 * Conversation history arrives from the client rather than a server-side
 * session. That is a deliberate tradeoff on serverless: instances are not
 * sticky, so a server-held session produces mid-conversation amnesia whenever
 * the request lands somewhere new. The usual objection to client-held history
 * is that a caller could fabricate an assistant turn — but the property this
 * system actually protects is that no certification status is asserted without
 * a tool lookup IN THE CURRENT TURN, and the verifier checks the draft against
 * this turn's raw tool results. A poisoned history cannot manufacture a tool
 * result, so it cannot produce the harm. It is still bounded and validated
 * below, because unbounded client input is its own problem.
 */

import { NextResponse, type NextRequest } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import config from '@config/agent.config.json';
import { runTurn } from '@/lib/agents/pipeline';
import { sseFrame, type TurnEvent } from '@/lib/agents/protocol';
import { hasApiKey } from '@/lib/agents/client';
import {
  checkSessionSpend,
  checkSessionTurns,
  checkSpendCap,
  checkTurnRate,
  clientKey,
  logAttempt,
  recordSpend,
} from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 2000;

interface TurnRequestBody {
  text?: unknown;
  callId?: unknown;
  turnId?: unknown;
  history?: unknown;
  interruptedAfter?: unknown;
  priorSessionCostUsd?: unknown;
  /** Set by the Break It panel so the attempt joins the public log. */
  attackId?: unknown;
  logAttempt?: unknown;
}

/** Accept only well-formed text turns; anything else is discarded silently. */
function sanitiseHistory(raw: unknown): Anthropic.MessageParam[] {
  if (!Array.isArray(raw)) return [];

  const out: Anthropic.MessageParam[] = [];
  for (const item of raw.slice(-MAX_HISTORY_MESSAGES)) {
    if (!item || typeof item !== 'object') continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof content !== 'string' || !content.trim()) continue;
    out.push({ role, content: content.slice(0, MAX_HISTORY_CHARS) });
  }
  return out;
}

export async function POST(request: NextRequest) {
  if (!hasApiKey()) {
    return NextResponse.json(
      {
        error: 'server_not_configured',
        message:
          'ANTHROPIC_API_KEY is not set on the server. Set it in .env.local for local use, or in ' +
          'the Vercel project environment variables for the deployment.',
      },
      { status: 503 },
    );
  }

  let body: TurnRequestBody;
  try {
    body = (await request.json()) as TurnRequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'empty_text' }, { status: 400 });
  }
  if (text.length > config.limits.maxInputChars) {
    return NextResponse.json(
      {
        error: 'text_too_long',
        message: `Keep it under ${config.limits.maxInputChars} characters.`,
      },
      { status: 413 },
    );
  }

  const callId =
    typeof body.callId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(body.callId)
      ? body.callId
      : `call_${Date.now().toString(36)}`;

  const turnId = Number.isFinite(Number(body.turnId)) ? Math.max(1, Number(body.turnId)) : 1;
  const priorSessionCostUsd =
    typeof body.priorSessionCostUsd === 'number' && body.priorSessionCostUsd >= 0
      ? body.priorSessionCostUsd
      : 0;

  // --- Limits, before any model call -------------------------------------
  // Order matters: cheap local checks first, then the counter-backed ones, so
  // an abusive client burns as little as possible getting refused.
  const ip = clientKey(request.headers);

  const sessionTurns = checkSessionTurns(turnId);
  if (!sessionTurns.allowed) {
    return NextResponse.json({ error: sessionTurns.reason, message: sessionTurns.message }, { status: 429 });
  }

  const sessionSpend = await checkSessionSpend(priorSessionCostUsd);
  if (!sessionSpend.allowed) {
    return NextResponse.json({ error: sessionSpend.reason, message: sessionSpend.message }, { status: 429 });
  }

  const rate = await checkTurnRate(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rate.reason, message: rate.message },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 60) } },
    );
  }

  // The spend cap degrades to scripted mode with an honest banner rather than
  // erroring, so the client gets a `degraded` event it can render in place.
  const spend = await checkSpendCap();
  if (!spend.allowed) {
    return NextResponse.json(
      { error: spend.reason, message: spend.message, degraded: true },
      { status: 503 },
    );
  }

  const isAttack = body.attackId !== undefined || body.logAttempt === true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: TurnEvent) => {
        controller.enqueue(encoder.encode(sseFrame(event)));
      };

      try {
        const generator = runTurn({
          text,
          callId,
          turnId,
          history: sanitiseHistory(body.history),
          interruptedAfter:
            typeof body.interruptedAfter === 'string'
              ? body.interruptedAfter.slice(0, MAX_HISTORY_CHARS)
              : undefined,
          priorSessionCostUsd,
        });

        const guardrails: string[] = [];
        let step = await generator.next();
        while (!step.done) {
          const event = step.value;
          if (event.t === 'guardrail') guardrails.push(event.hit.id);
          send(event);
          step = await generator.next();
        }

        const result = step.value;

        // Spend is recorded after the fact rather than reserved up front. A
        // turn can overshoot the cap by its own cost, which is fractions of a
        // cent — worth it to avoid estimating tokens before generating them.
        await recordSpend(result.usage.costUsd);

        if (isAttack) {
          await logAttempt({
            at: new Date().toISOString(),
            attackId: typeof body.attackId === 'string' ? body.attackId : null,
            text,
            outcome: result.fallback
              ? 'safe deflection'
              : result.blockedDrafts.length > 0
                ? `blocked then corrected (${result.blockedDrafts.length})`
                : 'held on the first draft',
            guardrails,
            blocked: result.blockedDrafts.length > 0,
          });
        }
      } catch (err) {
        // The caller is mid-conversation; an unhandled throw must still arrive
        // as something the UI can show rather than a truncated stream.
        send({
          t: 'error',
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Vercel's proxy buffers responses without this, which would defeat
      // streaming entirely and make every turn look like one slow block.
      'X-Accel-Buffering': 'no',
    },
  });
}
