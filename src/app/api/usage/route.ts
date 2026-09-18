/**
 * GET /api/usage — spend, limits, and which storage backend is actually live.
 *
 * Reports the backend honestly. A daily spend cap backed by per-instance memory
 * is not really a daily cap, and a dashboard that showed a reassuring number
 * without saying so would be worse than no dashboard.
 */

import { NextResponse } from 'next/server';
import config from '@config/agent.config.json';
import { hasApiKey } from '@/lib/agents/client';
import { countAttempts, dailySpendCapUsd, spentTodayUsd, storeDescription } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cap = dailySpendCapUsd();
  const spent = await spentTodayUsd();
  const backend = storeDescription();

  return NextResponse.json({
    apiConfigured: hasApiKey(),
    spend: {
      day: new Date().toISOString().slice(0, 10),
      spentUsd: spent,
      capUsd: cap,
      remainingUsd: spent === null ? null : Number(Math.max(0, cap - spent).toFixed(6)),
      percentUsed: spent === null ? null : Number(((spent / cap) * 100).toFixed(1)),
      degraded: spent === null || spent >= cap,
    },
    storage: {
      backend: backend.backend,
      durable: backend.durable,
      caveat: backend.durable
        ? null
        : 'Counters are held per serverless instance and reset when one recycles, so the daily ' +
          'cap and rate limits are approximate rather than global. Setting UPSTASH_REDIS_REST_URL ' +
          'and UPSTASH_REDIS_REST_TOKEN makes them durable. The spend limit set in the Anthropic ' +
          'Console is the backstop either way.',
    },
    limits: config.limits,
    models: Object.fromEntries(
      Object.entries(config.models)
        .filter(([k]) => !k.startsWith('$'))
        .map(([tier, m]) => [
          tier,
          {
            id: (m as { id: string }).id,
            usdPerMillion: (m as { usdPerMillion: unknown }).usdPerMillion,
          },
        ]),
    ),
    adversarialAttemptsLogged: await countAttempts(),
  });
}
