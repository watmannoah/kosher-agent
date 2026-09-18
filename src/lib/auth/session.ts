/**
 * Passcode session cookie.
 *
 * HMAC-signed with SESSION_SECRET rather than a bare flag, so the cookie cannot
 * be forged by setting `authed=1` in devtools. Web Crypto only — no Node
 * built-ins — because this same verification runs in the proxy, which executes
 * on the edge runtime.
 *
 * This is a shared passcode for a private demo, not an identity system. It
 * keeps the link from being usable by anyone who stumbles on the URL, and reads
 * as deliberate rather than locked down. It is not protecting anything secret.
 */

export const COOKIE_NAME = 'kehilla_gate';
const SESSION_DAYS = 7;

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64url(sig);
}

/** Cookie value: `<expiryEpochSeconds>.<signature>`. */
export async function issueToken(secret: string, now = Date.now()): Promise<string> {
  const expiry = Math.floor(now / 1000) + SESSION_DAYS * 86_400;
  const payload = String(expiry);
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyToken(
  secret: string,
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expiry = Number(payload);
  if (!Number.isFinite(expiry) || expiry * 1000 < now) return false;

  const expected = await hmac(secret, payload);

  // Length-independent comparison. The signatures are fixed-length so an early
  // return would leak little, but constant-time is the correct habit and costs
  // nothing here.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Compare a submitted passcode against the configured one.
 *
 * Constant-time over the configured length, so response timing does not reveal
 * how many leading characters were right.
 */
export function passcodeMatches(submitted: string, expected: string): boolean {
  if (!expected) return false;
  const a = new TextEncoder().encode(submitted.trim());
  const b = new TextEncoder().encode(expected.trim());
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export const COOKIE_MAX_AGE = SESSION_DAYS * 86_400;
