/**
 * Eval runner.
 *
 * Drives config/evals.json through `runTurn` — the same generator the browser
 * drives. There is deliberately no eval-only code path, which is what makes a
 * pass here evidence about the deployed system rather than about a test double.
 *
 * Each case pins a date, so the calendar-dependent cases (Erev Shabbos closure,
 * establishment expiry) are reproducible rather than passing or failing
 * according to the day CI happens to run.
 */

import evalsConfig from '@config/evals.json';
import { runTurnToCompletion } from '../agents/pipeline';
import { addUsage, EMPTY_USAGE, type Usage } from '../telemetry/cost';
import type { TurnEvent } from '../agents/protocol';
import { extractFacts, runAssertions, type AssertionResult, type AssertionSpec } from './assertions';
import { judge } from './judge';

export interface EvalCaseResult {
  id: string;
  title: string;
  why: string;
  passed: boolean;
  callerMessage: string;
  reply: string;
  assertions: AssertionResult[];
  judgeScore: number;
  judgeRationale: string;
  judgePassed: boolean;
  durationMs: number;
  costUsd: number;
  /** Full event stream, so the UI can expand a case into its trace. */
  events: TurnEvent[];
  error: string | null;
}

export interface EvalSuiteResult {
  startedAt: string;
  finishedAt: string;
  passed: number;
  total: number;
  passRate: number;
  durationMs: number;
  costUsd: number;
  cases: EvalCaseResult[];
}

type RawCase = (typeof evalsConfig.cases)[number];

export function caseCount(): number {
  return evalsConfig.cases.length;
}

export function caseIds(): string[] {
  return evalsConfig.cases.map((c) => c.id);
}

async function runCase(raw: RawCase): Promise<EvalCaseResult> {
  const started = performance.now();
  const callerMessage = raw.turns.map((t) => t.text).join(' ');
  const now = raw.pinDate ? new Date(`${raw.pinDate}T14:00:00Z`) : undefined;

  let usage: Usage = { ...EMPTY_USAGE };

  try {
    const { result, events } = await runTurnToCompletion({
      text: callerMessage,
      callId: `eval_${raw.id}`.slice(0, 64).replace(/[^A-Za-z0-9_-]/g, '_'),
      turnId: 1,
      now,
    });

    usage = addUsage(usage, result.usage);
    const facts = extractFacts(events);
    const assertions = runAssertions(raw.assert as AssertionSpec, facts);

    // The judge sees the tool results the specialist actually received.
    const toolsForJudge = events
      .filter((e): e is Extract<TurnEvent, { t: 'tool_result' }> => e.t === 'tool_result')
      .map((e) => ({
        name: e.name,
        input: {},
        result: e.result,
        durationMs: e.durationMs,
      }));

    const graded = await judge({
      callerMessage,
      reply: result.finalText,
      rubric: raw.rubric,
      tools: toolsForJudge,
    });

    usage = addUsage(usage, graded.usage);

    const assertionsPassed = assertions.every((a) => a.passed);

    return {
      id: raw.id,
      title: raw.title,
      why: raw.why,
      // Both gates must agree. Deterministic assertions catch mechanical
      // failures a judge waves through; the judge catches phrasing that
      // satisfies every regex and would still mislead a caller.
      passed: assertionsPassed && graded.passed,
      callerMessage,
      reply: result.finalText,
      assertions,
      judgeScore: graded.score,
      judgeRationale: graded.rationale,
      judgePassed: graded.passed,
      durationMs: Number((performance.now() - started).toFixed(1)),
      costUsd: usage.costUsd,
      events,
      error: null,
    };
  } catch (err) {
    return {
      id: raw.id,
      title: raw.title,
      why: raw.why,
      passed: false,
      callerMessage,
      reply: '',
      assertions: [
        {
          name: 'case ran without throwing',
          passed: false,
          expected: 'no exception',
          actual: err instanceof Error ? err.message : String(err),
        },
      ],
      judgeScore: 0,
      judgeRationale: 'Case did not complete.',
      judgePassed: false,
      durationMs: Number((performance.now() - started).toFixed(1)),
      costUsd: usage.costUsd,
      events: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface RunOptions {
  /** Run only these ids. */
  only?: string[];
  /**
   * How many cases run at once.
   *
   * Two by default. The cases are independent so this is safe, but each one is
   * several model calls and a wide fan-out invites rate limiting mid-suite,
   * which reads as a guardrail failure rather than the throttle it is.
   */
  concurrency?: number;
  onCaseComplete?: (result: EvalCaseResult, completed: number, total: number) => void;
}

export async function runSuite(options: RunOptions = {}): Promise<EvalSuiteResult> {
  const startedAt = new Date().toISOString();
  const started = performance.now();

  const selected = options.only?.length
    ? evalsConfig.cases.filter((c) => options.only!.includes(c.id))
    : evalsConfig.cases;

  const concurrency = Math.max(1, options.concurrency ?? 2);
  const results: EvalCaseResult[] = new Array(selected.length);
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= selected.length) return;
      const result = await runCase(selected[index]);
      results[index] = result;
      completed++;
      options.onCaseComplete?.(result, completed, selected.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));

  const passed = results.filter((r) => r.passed).length;
  const costUsd = Number(results.reduce((s, r) => s + r.costUsd, 0).toFixed(6));

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    passed,
    total: results.length,
    passRate: results.length === 0 ? 0 : Number((passed / results.length).toFixed(4)),
    durationMs: Number((performance.now() - started).toFixed(1)),
    costUsd,
    cases: results,
  };
}
