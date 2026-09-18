/**
 * Measured latency against the brief's targets.
 *
 * Shows both the target and the measurement, and colours against calibrated
 * amber/red thresholds rather than against the target — see latencyBudgetMs in
 * agent.config.json. A tool-using turn is two sequential API round trips, so
 * the brief's 1500ms total is not physically reachable and colouring against it
 * would leave the strip permanently red on a healthy system. Reporting a real
 * number next to the goal is more useful than a strip that is always failing.
 *
 * STT and TTS are measured in the browser; everything else on the server.
 */

'use client';

import config from '@config/agent.config.json';
import type { TurnView } from '@/lib/client/types';
import { Label, ms } from './ui';

type Budget = { target: number; amber: number; red: number };

const BUDGETS = config.latencyBudgetMs as unknown as Record<string, Budget>;

function tone(value: number | null, budget: Budget): string {
  if (value === null) return 'text-faint';
  if (value <= budget.amber) return 'text-live';
  if (value <= budget.red) return 'text-warn';
  return 'text-danger';
}

function Row({
  label,
  value,
  budgetKey,
  note,
}: {
  label: string;
  value: number | null;
  budgetKey: string;
  note?: string;
}) {
  const budget = BUDGETS[budgetKey];
  const colour = tone(value, budget);
  const pct = value === null ? 0 : Math.min(100, (value / budget.red) * 100);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="telemetry text-[10px] uppercase tracking-wider text-faint">{label}</span>
        <span className={`telemetry text-[11px] ${colour}`}>
          {ms(value)}
          <span className="ml-1 text-faint">/ {budget.target}ms</span>
        </span>
      </div>
      <div className="mt-1 h-0.5 w-full bg-hairline">
        <div
          className={`h-full transition-all ${
            colour === 'text-live'
              ? 'bg-live'
              : colour === 'text-warn'
                ? 'bg-warn'
                : colour === 'text-danger'
                  ? 'bg-danger'
                  : 'bg-hairline-bright'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {note && <p className="telemetry mt-1 text-[10px] text-faint">{note}</p>}
    </div>
  );
}

export function LatencyStrip({ turn }: { turn: TurnView | null }) {
  const m = turn?.metrics ?? null;

  return (
    <div className="border border-hairline bg-slate-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Latency, measured</Label>
        <span className="telemetry text-[10px] text-faint">
          target from the brief shown after each measurement
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Row
          label="STT finalise"
          value={turn?.sttFinaliseMs ?? null}
          budgetKey="stt_finalise"
          note="browser"
        />
        <Row label="Normalise" value={turn?.normaliseMs ?? null} budgetKey="normalise" />
        <Row label="Triage" value={m?.triageMs ?? null} budgetKey="triage" />
        <Row
          label="Specialist 1st token"
          value={m?.specialistFirstTokenMs ?? null}
          budgetKey="specialist_first_token"
        />
        <Row label="Verifier" value={m?.verifierMs ?? null} budgetKey="verifier" />
        <Row
          label="TTS first audio"
          value={turn?.ttsFirstAudioMs ?? null}
          budgetKey="tts_first_audio"
          note="browser"
        />
        <Row label="Turn total" value={m?.turnTotalMs ?? null} budgetKey="turn_total" />
        <div>
          <span className="telemetry text-[10px] uppercase tracking-wider text-faint">
            Tool time
          </span>
          <p className="telemetry mt-0.5 text-[11px] text-bone">{ms(m?.toolMs ?? null)}</p>
          <p className="telemetry mt-1 text-[10px] leading-relaxed text-faint">
            local lookups, not a network call
          </p>
        </div>
      </div>

      <p className="telemetry mt-4 border-t border-hairline pt-3 text-[10px] leading-relaxed text-faint">
        A turn that uses a tool is two sequential model round trips — the model asks for the
        lookup, then writes the answer from it — plus triage in front and the verifier behind.
        The 1500ms total in the brief is not reachable with that shape; these thresholds are
        calibrated to what the pipeline actually does, and the brief&rsquo;s targets are shown
        alongside rather than quietly dropped.
      </p>
    </div>
  );
}
