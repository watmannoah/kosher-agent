/**
 * Live eval runner.
 *
 * The button executes all 12 cases against the real pipeline. The timestamp
 * comes from the server at the moment of the click, so a report cannot be
 * mistaken for a pre-rendered one — which is the whole point of the section.
 *
 * Streams per case, because 12 cases at several model calls each takes over a
 * minute and a static spinner for that long reads as hung.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EvalCaseResult, EvalSuiteResult } from '@/lib/evals/runner';
import { Disclosure, Label, Pill, formatUsd, ms } from './ui';

interface Manifest {
  manifest: Array<{ id: string; title: string; why: string }>;
  passThreshold: number;
  lastReport: EvalSuiteResult | null;
  apiConfigured: boolean;
}

export function EvalRunner() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [results, setResults] = useState<EvalCaseResult[]>([]);
  const [suite, setSuite] = useState<EvalSuiteResult | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/evals')
      .then((r) => r.json())
      .then((json: Manifest) => {
        setManifest(json);
        if (json.lastReport) setSuite(json.lastReport);
      })
      .catch(() => setError('Could not load the eval manifest.'));
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResults([]);
    setSuite(null);
    setProgress({ completed: 0, total: manifest?.manifest.length ?? 12 });

    try {
      const res = await fetch('/api/evals', { method: 'POST' });

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        setError(json.message ?? `The server refused the run (${res.status}).`);
        setRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body.');
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;

          const event = JSON.parse(line.slice(6)) as
            | { t: 'start'; total: number; startedAt: string }
            | { t: 'case'; completed: number; total: number; result: EvalCaseResult }
            | { t: 'done'; suite: EvalSuiteResult }
            | { t: 'error'; message: string };

          if (event.t === 'start') {
            setStartedAt(event.startedAt);
            setProgress({ completed: 0, total: event.total });
          } else if (event.t === 'case') {
            setResults((prev) => [...prev, event.result]);
            setProgress({ completed: event.completed, total: event.total });
          } else if (event.t === 'done') {
            setSuite(event.suite);
          } else if (event.t === 'error') {
            setError(event.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [manifest]);

  const shown = results.length > 0 ? results : (suite?.cases ?? []);
  const passed = shown.filter((c) => c.passed).length;
  const pct = progress.total === 0 ? 0 : (progress.completed / progress.total) * 100;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={running || manifest?.apiConfigured === false}
          className="border border-hairline-bright bg-slate-raised px-4 py-3 text-sm font-medium text-bone transition-colors hover:border-live hover:text-live disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running
            ? `Running ${progress.completed}/${progress.total}…`
            : `Run all ${manifest?.manifest.length ?? 12} cases now`}
        </button>

        {shown.length > 0 && (
          <span className="telemetry text-sm">
            <span className={passed === shown.length ? 'text-live' : 'text-warn'}>
              {passed}/{shown.length}
            </span>
            <span className="text-faint"> passing</span>
          </span>
        )}

        {suite && (
          <span className="telemetry text-[10px] text-faint">
            {ms(suite.durationMs)} · {formatUsd(suite.costUsd)}
          </span>
        )}
      </div>

      {running && (
        <div className="h-0.5 w-full bg-hairline">
          <div className="h-full bg-live transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      {(startedAt ?? suite?.startedAt) && (
        <p className="telemetry text-[10px] text-faint">
          {results.length > 0 || running ? 'this run started' : 'last run'}{' '}
          {new Date(startedAt ?? suite!.startedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC
          {results.length === 0 && !running && suite ? ' — click above to run it again, live' : ''}
        </p>
      )}

      {error && (
        <p className="telemetry border border-warn/40 px-3 py-2 text-[11px] leading-relaxed text-warn">
          {error}
        </p>
      )}

      {manifest?.apiConfigured === false && (
        <p className="telemetry border border-danger/40 px-3 py-2 text-[11px] text-danger">
          The server has no API key configured, so the suite cannot run.
        </p>
      )}

      {/* Cases */}
      <div className="divide-y divide-hairline border border-hairline">
        {(shown.length > 0
          ? shown
          : (manifest?.manifest ?? []).map(
              (m) => ({ ...m, passed: false, pending: true }) as unknown as EvalCaseResult,
            )
        ).map((c) => (
          <EvalCaseRow key={c.id} result={c} running={running} />
        ))}
      </div>
    </div>
  );
}

function EvalCaseRow({ result, running }: { result: EvalCaseResult; running: boolean }) {
  const pending = !('assertions' in result) || result.assertions === undefined;

  return (
    <div className="px-3 py-2.5">
      <Disclosure
        summary={
          <div className="flex flex-wrap items-center gap-2">
            {pending ? (
              <Pill>{running ? 'queued' : 'not run'}</Pill>
            ) : result.passed ? (
              <Pill tone="live">pass</Pill>
            ) : (
              <Pill tone="danger">fail</Pill>
            )}
            <span className="text-[13px] text-bone">{result.title}</span>
            {!pending && (
              <span className="telemetry text-[10px] text-faint">
                judge {result.judgeScore}/5 · {ms(result.durationMs)}
              </span>
            )}
          </div>
        }
      >
        <div className="space-y-3 pb-2">
          <p className="text-[12px] leading-relaxed text-muted">{result.why}</p>

          {!pending && (
            <>
              <div>
                <Label>Caller</Label>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  {result.callerMessage}
                </p>
              </div>

              <div>
                <Label>Agent replied</Label>
                <p className="mt-1 text-[12px] leading-relaxed text-bone">{result.reply}</p>
              </div>

              <div>
                <Label>Assertions</Label>
                <div className="mt-1 space-y-0.5">
                  {result.assertions.map((a, i) => (
                    <div key={i} className="flex gap-2">
                      <span
                        className={`telemetry text-[10px] ${a.passed ? 'text-live' : 'text-danger'}`}
                      >
                        {a.passed ? '✓' : '✗'}
                      </span>
                      <span className="telemetry text-[10px] leading-relaxed text-muted">
                        {a.name}
                        {!a.passed && (
                          <span className="text-danger">
                            {' '}
                            — expected {a.expected}, got {a.actual}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label>Judge</Label>
                <p className="telemetry mt-1 text-[10px] leading-relaxed text-muted">
                  <span className={result.judgePassed ? 'text-live' : 'text-danger'}>
                    {result.judgeScore}/5
                  </span>{' '}
                  — {result.judgeRationale}
                </p>
              </div>

              {result.error && (
                <p className="telemetry text-[10px] text-danger">{result.error}</p>
              )}
            </>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
