/**
 * Term normalisation panel: raw STT against the normalised text.
 *
 * Also offers a free-text box, because the mangled input most worth showing is
 * whatever the visitor types in themselves — and this runs entirely in the
 * browser, so it costs nothing and works even when the spend cap has closed.
 */

'use client';

import { useMemo, useState } from 'react';
import { normalise } from '@/lib/normalise';
import type { TurnView } from '@/lib/client/types';
import { Label, Pill } from './ui';

const KIND_TONE: Record<string, 'info' | 'live' | 'warn'> = {
  term: 'info',
  variant: 'live',
  brand: 'warn',
};

const EXAMPLES = [
  'is the milk hig one holov yisroel',
  'do they have a heck share for par eve',
  'i have a shy la about pas yisroel',
  'is name on bakery challah yoshen',
  'is it mash giach temeedee there',
];

/** Render the raw string with substituted spans marked. */
function Highlighted({
  raw,
  substitutions,
}: {
  raw: string;
  substitutions: TurnView['substitutions'];
}) {
  if (substitutions.length === 0) return <span className="text-muted">{raw}</span>;

  const sorted = [...substitutions].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  sorted.forEach((sub, i) => {
    if (sub.start > cursor) parts.push(<span key={`t${i}`}>{raw.slice(cursor, sub.start)}</span>);
    parts.push(
      <mark
        key={`m${i}`}
        className="bg-warn/20 text-warn underline decoration-warn/50 decoration-dotted"
        title={`${sub.method} match, confidence ${sub.confidence}`}
      >
        {raw.slice(sub.start, sub.end)}
      </mark>,
    );
    cursor = sub.end;
  });

  if (cursor < raw.length) parts.push(<span key="tail">{raw.slice(cursor)}</span>);
  return <span className="text-muted">{parts}</span>;
}

export function NormalisePanel({ turn }: { turn: TurnView | null }) {
  const [typed, setTyped] = useState('');

  // Live for the free-text box; falls back to the last real call's result.
  const live = useMemo(() => (typed.trim() ? normalise(typed) : null), [typed]);

  const raw = live?.raw ?? turn?.callerRaw ?? '';
  const normalised = live?.normalised ?? turn?.callerNormalised ?? '';
  const substitutions = live?.substitutions ?? turn?.substitutions ?? [];
  const durationMs = live?.durationMs ?? turn?.normaliseMs ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setTyped(example)}
            className="telemetry border border-hairline bg-slate-raised px-2 py-1 text-[10px] text-muted transition-colors hover:border-hairline-bright hover:text-bone"
          >
            {example}
          </button>
        ))}
      </div>

      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder="Type mangled kashrus terminology to see it normalised, live"
        className="w-full border border-hairline bg-slate-panel px-3 py-3 text-base text-bone outline-none placeholder:text-faint focus:border-hairline-bright"
      />

      {raw ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="border border-hairline bg-slate-panel p-3">
            <Label>Raw — what STT produced</Label>
            <p className="mt-2 text-sm leading-relaxed">
              <Highlighted raw={raw} substitutions={substitutions} />
            </p>
          </div>
          <div className="border border-hairline bg-slate-panel p-3">
            <Label>Normalised — what the models receive</Label>
            <p className="mt-2 text-sm leading-relaxed text-bone">{normalised}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-faint">
          Make a call above, or type something in the box, to see the substitutions.
        </p>
      )}

      {substitutions.length > 0 && (
        <div className="border border-hairline bg-slate-panel">
          <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
            <Label>
              {substitutions.length} substitution{substitutions.length === 1 ? '' : 's'}
            </Label>
            <span className="telemetry text-[10px] text-live">
              {durationMs !== null ? `${durationMs.toFixed(2)}ms` : ''}
            </span>
          </div>
          <div className="divide-y divide-hairline">
            {substitutions.map((sub, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="telemetry text-[11px] text-warn">{sub.from}</span>
                <span className="telemetry text-[11px] text-faint">→</span>
                <span className="telemetry text-[11px] text-bone">{sub.to}</span>
                <Pill tone={KIND_TONE[sub.kind] ?? 'neutral'}>{sub.kind}</Pill>
                <span className="telemetry text-[10px] text-faint">
                  {sub.method} · {sub.confidence}
                </span>
                <span className="w-full text-[11px] leading-relaxed text-muted">{sub.gloss}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="telemetry text-[10px] leading-relaxed text-faint">
        Runs in the browser in under a millisecond, before anything reaches a model. Exact
        dictionary hit first, then fuzzy (Damerau-Levenshtein), then a phonetic consonant
        skeleton that survives transliteration — which is why &ldquo;hash gotcha&rdquo; reaches
        &ldquo;hashgacha&rdquo;. Brand names that sound alike are deliberately left unresolved so
        the lookup asks rather than guesses.
      </p>
    </div>
  );
}
