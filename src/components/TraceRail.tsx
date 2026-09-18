/**
 * The trace rail: what actually happened this turn.
 *
 * Shows the most recent turn rather than a scrolling log of all of them — the
 * question this answers is "what did it just do", and a rail you have to scroll
 * to find the current turn in answers it worse.
 *
 * Blocked drafts are rendered prominently and in full. A caught hallucination
 * the visitor can read is the single most persuasive thing here, so it is not
 * tucked behind a disclosure.
 */

'use client';

import type { TurnView } from '@/lib/client/types';
import { Disclosure, KeyValue, Label, Pill, formatUsd, ms } from './ui';

export function TraceRail({ turn }: { turn: TurnView | null }) {
  if (!turn) {
    return (
      <aside className="border border-hairline bg-slate-panel p-4">
        <Label>Trace</Label>
        <p className="mt-3 text-sm leading-relaxed text-faint">
          Every turn is traced here: which agent took it and on which model, each tool call with
          its arguments and result, every guardrail that fired, the verifier&rsquo;s verdict, and
          what it cost.
        </p>
      </aside>
    );
  }

  return (
    <aside className="thin-scroll max-h-[720px] space-y-4 overflow-y-auto border border-hairline bg-slate-panel p-4">
      {/* Routing */}
      <div>
        <Label>Routing</Label>
        <div className="mt-2 space-y-1">
          {turn.triage ? (
            <>
              <KeyValue
                k="triage"
                v={
                  <span>
                    {turn.triage.model} · {ms(turn.triage.durationMs)} ·{' '}
                    {formatUsd(turn.triage.costUsd)}
                  </span>
                }
              />
              <KeyValue k="intent" v={turn.triage.intent} />
              {turn.triage.isShailah && (
                <div className="py-1">
                  <Pill tone="danger">shailah — pipeline hard-stopped</Pill>
                </div>
              )}
              {turn.triage.asksOtherAgency && (
                <div className="py-1">
                  <Pill tone="warn">asks about another agency</Pill>
                </div>
              )}
              {turn.triage.urgency === 'high' && (
                <KeyValue k="urgency" v={<span className="text-warn">high</span>} />
              )}
              {Object.keys(turn.triage.entities).length > 0 && (
                <KeyValue
                  k="entities"
                  v={Object.entries(turn.triage.entities)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(' ')}
                />
              )}
            </>
          ) : (
            <p className="telemetry text-[11px] text-faint">classifying…</p>
          )}
        </div>
      </div>

      {/* Handling agent */}
      {turn.agent && (
        <div className="border-t border-hairline pt-3">
          <Label>Handled by</Label>
          <div className="mt-2 space-y-1">
            <KeyValue k="agent" v={turn.agentLabel ?? turn.agent} />
            <KeyValue k="model" v={turn.agentModel ?? '—'} />
            <KeyValue
              k="tools held"
              v={
                <span title={turn.toolNames.join(', ')}>
                  {turn.toolCount} of 10
                </span>
              }
            />
            <p className="telemetry pt-1 text-[10px] leading-relaxed text-faint">
              {turn.toolNames.join(' · ')}
            </p>
          </div>
        </div>
      )}

      {/* TTS gating decision */}
      {turn.speakMode && (
        <div className="border-t border-hairline pt-3">
          <Label>Audio path</Label>
          <div className="mt-2">
            <Pill tone={turn.speakMode === 'stream' ? 'live' : 'warn'}>
              {turn.speakMode === 'stream' ? 'speaks while streaming' : 'audio held for verdict'}
            </Pill>
            <p className="telemetry mt-2 text-[10px] leading-relaxed text-faint">
              {turn.verifyReason}
            </p>
          </div>
        </div>
      )}

      {/* Tool calls */}
      {turn.toolCalls.length > 0 && (
        <div className="border-t border-hairline pt-3">
          <Label>Tool calls</Label>
          <div className="mt-2 space-y-2">
            {turn.toolCalls.map((call, i) => (
              <div key={`${call.name}-${i}`} className="border border-hairline bg-ink/60 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="telemetry text-[11px] text-bone">{call.name}</span>
                  {call.ok === null ? (
                    <Pill tone="live">running</Pill>
                  ) : call.ok ? (
                    <Pill tone="live">ok</Pill>
                  ) : (
                    <Pill tone="warn">{call.error}</Pill>
                  )}
                  {call.durationMs !== null && (
                    <span className="telemetry text-[10px] text-faint">{ms(call.durationMs)}</span>
                  )}
                </div>

                <p className="telemetry mt-1 break-words text-[10px] text-muted">
                  {JSON.stringify(call.input)}
                </p>

                {call.result && (
                  <div className="mt-1.5">
                    <ToolResultSummary result={call.result} />
                    <Disclosure
                      summary={
                        <span className="telemetry text-[10px] text-faint">raw result</span>
                      }
                    >
                      <pre className="thin-scroll max-h-48 overflow-auto whitespace-pre-wrap break-words border border-hairline bg-ink p-2 telemetry text-[10px] leading-relaxed text-muted">
                        {JSON.stringify(call.result, null, 2)}
                      </pre>
                    </Disclosure>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Guardrails */}
      {turn.guardrails.length > 0 && (
        <div className="border-t border-hairline pt-3">
          <Label>Guardrails fired</Label>
          <div className="mt-2 space-y-1.5">
            {turn.guardrails.map((hit, i) => (
              <div key={`${hit.id}-${i}`}>
                <Pill tone={hit.action === 'block' ? 'danger' : 'warn'}>{hit.id}</Pill>
                <p className="telemetry mt-1 text-[10px] leading-relaxed text-muted">
                  {hit.label} · {hit.stage} · matched &ldquo;{hit.matched}&rdquo;
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Blocked drafts — deliberately prominent */}
      {turn.blockedDrafts.length > 0 && (
        <div className="border-t border-hairline pt-3">
          <Label>Blocked before the caller heard it</Label>
          <div className="mt-2 space-y-2">
            {turn.blockedDrafts.map((draft, i) => (
              <div key={i} className="border border-danger/40 bg-danger/5 p-2">
                <div className="flex items-center gap-2">
                  <Pill tone="danger">blocked by {draft.by}</Pill>
                  <span className="telemetry text-[10px] text-faint">attempt {draft.attempt}</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-danger line-through decoration-danger/40">
                  {draft.text}
                </p>
                <p className="telemetry mt-1.5 text-[10px] leading-relaxed text-muted">
                  {draft.reason}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Verifier */}
      {turn.verifier && (
        <div className="border-t border-hairline pt-3">
          <Label>Verifier</Label>
          <div className="mt-2">
            <Pill tone={turn.verifier.verdict === 'pass' ? 'live' : 'danger'}>
              {turn.verifier.verdict}
              {turn.verifier.ground ? ` · ground ${turn.verifier.ground}` : ''}
            </Pill>
            <p className="telemetry mt-2 text-[10px] leading-relaxed text-muted">
              {turn.verifier.reason}
            </p>
            <p className="telemetry mt-1 text-[10px] text-faint">
              {turn.verifier.model} · {ms(turn.verifier.durationMs)} ·{' '}
              {formatUsd(turn.verifier.costUsd)}
            </p>
          </div>
        </div>
      )}

      {/* Cost */}
      {turn.metrics && (
        <div className="border-t border-hairline pt-3">
          <Label>Cost</Label>
          <div className="mt-2 space-y-1">
            <KeyValue k="this turn" v={formatUsd(turn.metrics.turnCostUsd)} />
            <KeyValue k="session" v={formatUsd(turn.metrics.sessionCostUsd)} />
            <KeyValue
              k="tokens"
              v={`${turn.metrics.inputTokens} in · ${turn.metrics.outputTokens} out`}
            />
            {Object.entries(turn.metrics.costByAgent).map(([agent, cost]) => (
              <KeyValue key={agent} k={agent} v={formatUsd(cost)} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

/**
 * One line of plain English from a tool result.
 *
 * The raw JSON is available underneath, but the important thing about a result
 * is usually a single field — the status, or that an alert is attached — and
 * making someone read JSON to find it wastes the rail.
 */
function ToolResultSummary({ result }: { result: TurnView['toolCalls'][number]['result'] }) {
  if (!result) return null;

  if (!result.ok) {
    return (
      <p className="telemetry text-[10px] leading-relaxed text-warn">
        {result.error} — {result.message.slice(0, 180)}
      </p>
    );
  }

  const data = result.data as Record<string, unknown> | undefined;
  if (!data) return null;

  const status = data.status ?? data.openState ?? data.availability ?? null;
  const alerts = (data.activeAlerts ?? data.alerts) as Array<{ headline?: string }> | undefined;

  return (
    <div className="space-y-1">
      {status !== null && (
        <p className="telemetry text-[10px] text-bone">
          status = <span className="text-live">{String(status)}</span>
        </p>
      )}
      {Array.isArray(alerts) && alerts.length > 0 && (
        <p className="telemetry text-[10px] leading-relaxed text-danger">
          alert: {alerts[0].headline}
        </p>
      )}
      {typeof data.meaning === 'string' && (
        <p className="telemetry text-[10px] leading-relaxed text-muted">
          {data.meaning.slice(0, 200)}
          {data.meaning.length > 200 ? '…' : ''}
        </p>
      )}
    </div>
  );
}
