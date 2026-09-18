/**
 * The passcode gate.
 *
 * First thing the recipient sees, probably on a phone, from an email. So it
 * says what this is and states the synthetic-data notice before asking for
 * anything — a bare password box with no explanation reads like a phishing
 * page.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function GatePage() {
  const router = useRouter();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };

      if (json.ok) {
        const next = new URLSearchParams(window.location.search).get('next');
        // Only same-origin paths, so a crafted ?next= cannot bounce someone
        // off-site after authenticating.
        router.push(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
      } else {
        setError(json.message ?? 'That did not work.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <p className="telemetry text-[11px] uppercase tracking-[0.18em] text-faint">
          Kehilla Kosher Certification
        </p>
        <h1 className="mt-3 text-xl font-medium text-bone">Consumer hotline — live agent</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          A multi-agent voice system for a kosher certification hotline. Real model calls, real
          tool lookups, real guardrails. The passcode is in the email.
        </p>

        <form onSubmit={submit} className="mt-7">
          <label htmlFor="passcode" className="telemetry block text-[11px] uppercase tracking-wider text-faint">
            Passcode
          </label>
          <input
            id="passcode"
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            // 16px minimum, or iOS Safari zooms the whole page on focus.
            className="mt-2 w-full rounded-sm border border-hairline bg-slate-panel px-3 py-3 text-base text-bone outline-none focus:border-hairline-bright"
            placeholder=""
          />

          <button
            type="submit"
            disabled={busy || !passcode.trim()}
            className="mt-4 w-full rounded-sm border border-hairline-bright bg-slate-raised px-4 py-3 text-sm font-medium text-bone transition-colors hover:border-live hover:text-live disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Enter'}
          </button>

          <div aria-live="polite" className="min-h-6">
            {error && <p className="mt-3 telemetry text-xs text-danger">{error}</p>}
          </div>
        </form>

        <p className="mt-8 border-t border-hairline pt-4 text-xs leading-relaxed text-faint">
          Kehilla Kosher Certification is a fictional agency. All products, establishments,
          symbols and statuses are synthetic demonstration data and must not be relied on for any
          purpose.
        </p>
      </div>
    </main>
  );
}
