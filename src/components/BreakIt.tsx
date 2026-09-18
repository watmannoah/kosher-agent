/**
 * The adversarial panel.
 *
 * Fires real attacks at the live system. Each button sends the same request the
 * microphone would; nothing is pre-scripted and nothing is replayed. The result
 * shows what the system did and which guardrail caught it.
 *
 * Audio is muted here on purpose: the point is reading what was blocked, and
 * six attacks in a row read aloud would be unusable.
 */

'use client';

import { useEffect, useState } from 'react';
import config from '@config/public.config.json';
import type { TurnView } from '@/lib/client/types';
import { Label, Pill } from './ui';

interface Attempt {
  at: string;
  attackId: string | null;
  text: string;
  outcome: string;
  guardrails: string[];
  blocked: boolean;
}

const ATTACKS = config.demo.attacks;

export function BreakIt({
  onAttack,
  turns,
  busy,
}: {
  onAttack: (text: string, attackId: string) => void;
  turns: TurnView[];
  busy: boolean;
}) {
  const [custom, setCustom] = useState('');
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [attemptsCaveat, setAttemptsCaveat] = useState<string | null>(null);
  const [fired, setFired] = useState<string | null>(null);

  // The visitor log refreshes after each attack so they see their own attempt
  // join it.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/attempts');
        if (!res.ok) return;
        const json = (await res.json()) as { attempts: Attempt[]; caveat: string | null };
        if (!cancelled) {
          setAttempts(json.attempts);
          setAttemptsCaveat(json.caveat);
        }
      } catch {
        /* the panel is still useful without the shared log */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [turns.length]);

  const fire = (text: string, id: string) => {
    setFired(id);
    onAttack(text, id);
  };

  // The turn produced by the attack we most recently fired.
  const latest = turns.at(-1) ?? null;
  const attack = ATTACKS.find((a) => a.id === fired) ?? null;

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ATTACKS.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy}
            onClick={() => fire(a.text, a.id)}
            className={`border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              fired === a.id
                ? 'border-live bg-live-dim/30'
                : 'border-hairline bg-slate-panel hover:border-hairline-bright'
            }`}
          >
            <span className="telemetry text-[10px] uppercase tracking-wider text-faint">
              {a.label}
            </span>
            <p className="mt-1.5 text-[13px] leading-snug text-bone">&ldquo;{a.text}&rdquo;</p>
            <p className="telemetry mt-2 text-[10px] leading-relaxed text-muted">
              expect: {a.expect}
            </p>
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = custom.trim();
          if (!text || busy) return;
          setCustom('');
          fire(text, 'custom');
        }}
        className="flex gap-2"
      >
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Or write your own attack"
          maxLength={800}
          className="min-w-0 flex-1 border border-hairline bg-slate-panel px-3 py-3 text-base text-bone outline-none placeholder:text-faint focus:border-hairline-bright"
        />
        <button
          type="submit"
          disabled={busy || !custom.trim()}
          className="shrink-0 border border-hairline-bright bg-slate-raised px-4 py-3 text-sm font-medium text-bone transition-colors hover:border-live hover:text-live disabled:cursor-not-allowed disabled:opacity-40"
        >
          Fire
        </button>
      </form>

      {/* What just happened */}
      {fired && latest && (
        <div className="border border-hairline bg-slate-panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Label>Result</Label>
            {latest.status === 'running' && <Pill tone="live">running</Pill>}
            {latest.blockedDrafts.length > 0 && (
              <Pill tone="danger">
                {latest.blockedDrafts.length} draft
                {latest.blockedDrafts.length === 1 ? '' : 's'} blocked
              </Pill>
            )}
            {latest.guardrails.map((g, i) => (
              <Pill key={i} tone="warn">
                {g.id}
              </Pill>
            ))}
            {latest.verifier && (
              <Pill tone={latest.verifier.verdict === 'pass' ? 'live' : 'danger'}>
                verifier {latest.verifier.verdict}
              </Pill>
            )}
            {latest.triage?.isShailah && <Pill tone="danger">routed to shailah</Pill>}
          </div>

          {attack && (
            <p className="telemetry mt-3 text-[10px] leading-relaxed text-faint">
              expected: {attack.expect}
            </p>
          )}

          {latest.blockedDrafts.map((draft, i) => (
            <div key={i} className="mt-3 border border-danger/40 bg-danger/5 p-2">
              <Pill tone="danger">blocked by {draft.by}</Pill>
              <p className="mt-1.5 text-[12px] leading-relaxed text-danger line-through decoration-danger/40">
                {draft.text}
              </p>
              <p className="telemetry mt-1 text-[10px] leading-relaxed text-muted">
                {draft.reason}
              </p>
            </div>
          ))}

          <div className="mt-3">
            <Label>What the caller would hear</Label>
            <p className="mt-1.5 text-sm leading-relaxed text-bone">
              {latest.finalText ?? latest.streamingText ?? '…'}
            </p>
          </div>

          {latest.toolCalls.length > 0 && (
            <p className="telemetry mt-3 text-[10px] text-faint">
              tools: {latest.toolCalls.map((c) => c.name).join(' · ')}
            </p>
          )}
        </div>
      )}

      {/* Everyone else's attempts */}
      <div className="border-t border-hairline pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label>Attempts from all visitors</Label>
          {attempts && (
            <span className="telemetry text-[10px] text-faint">{attempts.length} recorded</span>
          )}
        </div>

        {attemptsCaveat && (
          <p className="telemetry mt-2 text-[10px] leading-relaxed text-warn">{attemptsCaveat}</p>
        )}

        {attempts === null ? (
          <p className="telemetry mt-2 text-[11px] text-faint">loading…</p>
        ) : attempts.length === 0 ? (
          <p className="telemetry mt-2 text-[11px] text-faint">
            No attempts recorded yet. Yours will be the first.
          </p>
        ) : (
          <div className="thin-scroll mt-3 max-h-60 divide-y divide-hairline overflow-y-auto border border-hairline">
            {attempts.map((a, i) => (
              <div key={i} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="telemetry text-[10px] text-faint">
                    {new Date(a.at).toISOString().slice(5, 16).replace('T', ' ')}
                  </span>
                  {a.blocked && <Pill tone="danger">blocked</Pill>}
                  {a.guardrails.map((g, j) => (
                    <Pill key={j} tone="warn">
                      {g}
                    </Pill>
                  ))}
                </div>
                {/* Visitor-supplied text, rendered as text and never as markup. */}
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{a.text}</p>
                <p className="telemetry mt-0.5 text-[10px] text-faint">{a.outcome}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
