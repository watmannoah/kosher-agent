/**
 * POST /api/evals — run the suite live, streamed case by case.
 * GET  /api/evals — the suite manifest, plus the last report if one is cached.
 *
 * Streamed because 12 cases at several model calls each takes well over a
 * minute, and a visitor watching a spinner for that long assumes it has hung.
 * Per-case frames also make the progress bar honest rather than animated.
 */

import { NextResponse, type NextRequest } from 'next/server';
import evalsConfig from '@config/evals.json';
import { runSuite, type EvalCaseResult, type EvalSuiteResult } from '@/lib/evals/runner';
import { hasApiKey } from '@/lib/agents/client';
import { checkEvalRate, checkSpendCap, clientKey } from '@/lib/limits';
import { safely, store } from '@/lib/store/adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * The suite is the longest-running thing here. Vercel's default function
 * timeout would cut it off partway and report a false failure.
 */
export const maxDuration = 300;

const LAST_REPORT_KEY = 'evals:last';
const REPORT_TTL_SECONDS = 86_400 * 7;

/** Strip the per-case event streams before caching — they are large. */
function summarise(suite: EvalSuiteResult) {
  return {
    ...suite,
    cases: suite.cases.map((c) => ({ ...c, events: [] })),
  };
}

export async function GET() {
  const cached = await safely(() => store().list(LAST_REPORT_KEY, 1), []);
  return NextResponse.json({
    manifest: evalsConfig.cases.map((c) => ({ id: c.id, title: c.title, why: c.why })),
    passThreshold: evalsConfig.judge.passThreshold,
    lastReport: cached[0] ?? null,
    apiConfigured: hasApiKey(),
  });
}

export async function POST(request: NextRequest) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: 'server_not_configured', message: 'ANTHROPIC_API_KEY is not set on the server.' },
      { status: 503 },
    );
  }

  const ip = clientKey(request.headers);

  const rate = await checkEvalRate(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rate.reason, message: rate.message },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 900) } },
    );
  }

  const spend = await checkSpendCap();
  if (!spend.allowed) {
    return NextResponse.json({ error: spend.reason, message: spend.message }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const total = evalsConfig.cases.length;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      // The timestamp is generated server-side at the moment of the request, so
      // the report cannot be mistaken for a pre-recorded one.
      send({ t: 'start', total, startedAt: new Date().toISOString() });

      try {
        const suite = await runSuite({
          onCaseComplete: (result: EvalCaseResult, completed: number) => {
            send({
              t: 'case',
              completed,
              total,
              // Events are dropped from the frame; the UI requests them only
              // when a case is expanded, so a 12-case run is not 12 full traces
              // down the wire.
              result: { ...result, events: [] },
            });
          },
        });

        await safely(() => store().push(LAST_REPORT_KEY, summarise(suite), 1, REPORT_TTL_SECONDS), undefined);
        send({ t: 'done', suite: summarise(suite) });
      } catch (err) {
        send({ t: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
