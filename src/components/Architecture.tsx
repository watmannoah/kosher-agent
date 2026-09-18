/**
 * Architecture and cost.
 *
 * The diagram is text in a <pre> rather than an SVG or a diagramming
 * dependency. It is the same diagram as in the brief and in ARCHITECTURE.md, it
 * survives copy-paste into an email, and it costs nothing to load on a phone.
 */

'use client';

import { useEffect, useState } from 'react';
import config from '@config/public.config.json';
import { Label, formatUsd } from './ui';

const DIAGRAM = `                    ┌──────────────┐
   caller  ─────▶   │   TRIAGE     │  Haiku 4.5 — fast, cheap
                    │ classify +   │  intent, urgency, shailah detection
                    │    route     │  forced tool call, strict JSON
                    └──────┬───────┘
                           │
     ┌─────────────┬───────┴────────┬──────────────┐
     ▼             ▼                ▼              ▼
┌─────────┐  ┌───────────┐   ┌───────────┐  ┌───────────┐
│ PRODUCT │  │ESTABLISH- │   │  SALES    │  │ COMPLAINT │   Sonnet 5
│ STATUS  │  │  MENT     │   │  INTAKE   │  │  INTAKE   │   scoped tools
│ 5 tools │  │  3 tools  │   │  3 tools  │  │  4 tools  │   per agent
└────┬────┘  └─────┬─────┘   └─────┬─────┘  └─────┬─────┘
     └─────────────┴───────┬───────┴──────────────┘
                           ▼
                  ┌─────────────────┐
                  │    VERIFIER     │  Haiku 4.5 — audits the draft
                  │ claim ↔ tool    │  against the RAW tool results
                  │ result match    │  BLOCKS on mismatch, retries once
                  └────────┬────────┘
                           ▼
                        caller

   ┌──────────────────────────────────────────────┐
   │ SHAILAH ROUTER — fires from any state,       │
   │ hard-stops the pipeline, routes to the Rav   │
   └──────────────────────────────────────────────┘`;

interface Usage {
  spend: { spentUsd: number | null; capUsd: number; percentUsed: number | null; degraded: boolean };
  storage: { backend: string; durable: boolean; caveat: string | null };
  models: Record<string, { id: string; usdPerMillion: { input: number; output: number } }>;
  adversarialAttemptsLogged: number;
}

const AGENT_KEYS = ['product_status', 'establishment', 'sales', 'complaint', 'hours', 'other', 'shailah'];

export function Architecture() {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    void fetch('/api/usage')
      .then((r) => r.json())
      .then(setUsage)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="thin-scroll overflow-x-auto border border-hairline bg-slate-panel p-4">
        <pre className="telemetry text-[10px] leading-[1.5] text-muted sm:text-[11px]">
          {DIAGRAM}
        </pre>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Why this shape */}
        <div>
          <Label>Why supervisor-and-specialists</Label>
          <div className="mt-2 space-y-2.5 text-[13px] leading-relaxed text-muted">
            <p>
              One prompt holding ten tools has to describe every rule for every situation at once,
              which makes each rule weaker. A specialist holding three tools gets a tighter prompt
              and cannot call the seven tools that are not its business — the sales agent has no
              way to open a complaint case.
            </p>
            <p>
              The verifier is a separate call rather than a longer specialist prompt because a
              model checking its own work shares the assumption that produced the error. It sees
              the raw tool results and a checklist, and never sees the caller&rsquo;s pressure.
            </p>
            <p>
              Triage runs on the cheap tier because classification is the one task where the
              cheap tier is genuinely sufficient, and it runs on every single turn.
            </p>
          </div>
        </div>

        {/* Tool scoping */}
        <div>
          <Label>Tools held per agent</Label>
          <div className="mt-2 divide-y divide-hairline border border-hairline">
            {AGENT_KEYS.map((key) => {
              const agent = (config.agents as Record<string, { label: string; tools: string[] }>)[key];
              if (!agent) return null;
              return (
                <div key={key} className="px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="telemetry text-[11px] text-bone">{agent.label}</span>
                    <span className="telemetry text-[10px] text-live">
                      {agent.tools.length} of 10
                    </span>
                  </div>
                  <p className="telemetry mt-0.5 text-[10px] leading-relaxed text-faint">
                    {agent.tools.join(' · ') || 'none — it routes, it does not act'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Cost */}
      <div>
        <Label>Cost per model tier</Label>
        <div className="mt-2 overflow-x-auto border border-hairline">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr className="border-b border-hairline">
                {['Tier', 'Model', '$/Mtok in', '$/Mtok out'].map((h) => (
                  <th
                    key={h}
                    className="telemetry px-3 py-2 text-left text-[10px] uppercase tracking-wider text-faint"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usage
                ? Object.entries(usage.models).map(([tier, m]) => (
                    <tr key={tier} className="border-b border-hairline last:border-0">
                      <td className="telemetry px-3 py-2 text-[11px] text-bone">{tier}</td>
                      <td className="telemetry px-3 py-2 text-[11px] text-muted">{m.id}</td>
                      <td className="telemetry px-3 py-2 text-[11px] text-muted">
                        ${m.usdPerMillion.input.toFixed(2)}
                      </td>
                      <td className="telemetry px-3 py-2 text-[11px] text-muted">
                        ${m.usdPerMillion.output.toFixed(2)}
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>

        {usage && (
          <div className="mt-3 space-y-1.5">
            <p className="telemetry text-[10px] leading-relaxed text-faint">
              Demonstration spend today:{' '}
              <span className={usage.spend.degraded ? 'text-warn' : 'text-live'}>
                {usage.spend.spentUsd === null
                  ? 'unknown'
                  : formatUsd(usage.spend.spentUsd)}
              </span>{' '}
              of {formatUsd(usage.spend.capUsd)} cap
              {usage.spend.percentUsed !== null ? ` (${usage.spend.percentUsed}%)` : ''}. On breach
              the system degrades to scripted mode with a banner rather than erroring.
            </p>
            <p className="telemetry text-[10px] leading-relaxed text-faint">
              Counter backend: {usage.storage.backend}.{' '}
              {usage.storage.caveat ?? 'Limits are global across instances.'}
            </p>
            <p className="telemetry text-[10px] text-faint">
              Adversarial attempts logged: {usage.adversarialAttemptsLogged}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
