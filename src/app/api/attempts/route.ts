/**
 * GET /api/attempts — adversarial attempts from all visitors.
 *
 * BRIEF 7.3 wants this as a talking point, and it is: a visitor sees that
 * others have already tried, and that the guardrails held. It is also
 * user-generated content on a shared surface, so `text` is truncated on write
 * and rendered as text on the client, never as markup, and never fed back to a
 * model as anything but caller input.
 */

import { NextResponse } from 'next/server';
import { recentAttempts, storeDescription } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const attempts = await recentAttempts(25);
  const backend = storeDescription();

  return NextResponse.json({
    attempts,
    durable: backend.durable,
    caveat: backend.durable
      ? null
      : 'Held in per-instance memory, so this list is short-lived and shows only attempts that ' +
        'reached the same serverless instance.',
  });
}
