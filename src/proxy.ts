/**
 * Passcode gate.
 *
 * Next 16 renamed the `middleware` convention to `proxy`. This runs before any
 * route renders, and the docs are explicit that it should not rely on shared
 * modules or globals — it may be deployed to a CDN edge separately from the
 * app. So it imports only the cookie verifier, which is Web Crypto and has no
 * other dependencies.
 *
 * Gating here rather than per-route means a route added later is protected by
 * default instead of by remembering to protect it.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, verifyToken } from '@/lib/auth/session';

export const config = {
  /*
   * Everything except the gate itself, the auth endpoint, and static assets.
   * Without a matcher this would also intercept CSS and JS and lock the gate
   * page out of its own styles.
   */
  matcher: ['/((?!gate|api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)'],
};

export async function proxy(request: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const passcode = process.env.DEMO_PASSCODE;

  // With no passcode configured the site is open. That is the right default for
  // local development, and the deploy instructions are explicit that both vars
  // must be set in Vercel.
  if (!passcode || !secret) return NextResponse.next();

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (await verifyToken(secret, token)) return NextResponse.next();

  // API routes get a 401 rather than a redirect — a fetch following a redirect
  // to an HTML page produces a confusing JSON parse error in the client.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'unauthorised', message: 'This demonstration is behind a passcode.' },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = '/gate';
  // Preserve where they were going, so the link in the email lands correctly
  // after the passcode rather than dumping them at the top.
  url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}
