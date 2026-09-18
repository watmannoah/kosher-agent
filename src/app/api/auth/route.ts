/**
 * POST /api/auth — exchange the shared passcode for a signed session cookie.
 *
 * Rate limited by IP, because a four-word passcode on a public URL invites
 * guessing and an unlimited endpoint would let someone work through a wordlist.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_MAX_AGE, COOKIE_NAME, issueToken, passcodeMatches } from '@/lib/auth/session';
import { clientKey } from '@/lib/limits';
import { safely, store } from '@/lib/store/adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS_PER_10_MIN = 10;

export async function POST(request: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const expected = process.env.DEMO_PASSCODE;

  if (!secret || !expected) {
    return NextResponse.json(
      {
        ok: false,
        error: 'not_configured',
        message: 'No passcode is configured on the server, so the site is already open.',
      },
      { status: 500 },
    );
  }

  const ip = clientKey(request.headers);
  const attempts = await safely(
    () => store().increment(`gate:${ip}:${Math.floor(Date.now() / 600_000)}`, 600),
    0,
  );
  if (attempts > MAX_ATTEMPTS_PER_10_MIN) {
    return NextResponse.json(
      { ok: false, error: 'too_many_attempts', message: 'Too many attempts. Wait a few minutes.' },
      { status: 429 },
    );
  }

  let submitted = '';
  try {
    const body = (await request.json()) as { passcode?: unknown };
    submitted = typeof body.passcode === 'string' ? body.passcode : '';
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (!passcodeMatches(submitted, expected)) {
    return NextResponse.json(
      { ok: false, error: 'incorrect', message: "That passcode isn't right." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: await issueToken(secret),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}
