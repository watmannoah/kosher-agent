/**
 * The eval suite as a test, for CI.
 *
 * Skipped unless RUN_EVALS=1, because it makes real model calls and costs real
 * money — `npm test` must stay free and instant. CI runs it explicitly via
 * `npm run evals`.
 *
 * Writes a JSON report and a markdown summary so a CI failure says which case
 * regressed and why, rather than just going red.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { runSuite, type EvalSuiteResult } from '@/lib/evals/runner';

const ENABLED = process.env.RUN_EVALS === '1';
const REPORT_DIR = 'eval-reports';

/** Markdown summary, written to the GitHub Actions job summary when present. */
function summarise(suite: EvalSuiteResult): string {
  const lines: string[] = [
    `## Eval suite — ${suite.passed}/${suite.total} passing`,
    '',
    `Ran ${(suite.durationMs / 1000).toFixed(1)}s, cost $${suite.costUsd.toFixed(4)}.`,
    '',
    '| | Case | Judge | Failed assertions |',
    '|---|---|---|---|',
  ];

  for (const c of suite.cases) {
    const failed = c.assertions.filter((a) => !a.passed);
    const detail = failed.length
      ? failed.map((a) => `${a.name} (expected ${a.expected}, got ${a.actual})`).join('; ')
      : '—';
    lines.push(
      `| ${c.passed ? '✅' : '❌'} | ${c.title} | ${c.judgeScore}/5 | ${detail.replace(/\|/g, '\\|')} |`,
    );
  }

  const failures = suite.cases.filter((c) => !c.passed);
  if (failures.length > 0) {
    lines.push('', '### Failures in detail', '');
    for (const c of failures) {
      lines.push(`**${c.title}**`, '', `- Caller: ${c.callerMessage}`, `- Replied: ${c.reply}`);
      lines.push(`- Judge ${c.judgeScore}/5: ${c.judgeRationale}`);
      for (const a of c.assertions.filter((x) => !x.passed)) {
        lines.push(`- ✗ ${a.name} — expected ${a.expected}, got ${a.actual}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

describe.skipIf(!ENABLED)('eval suite against the real pipeline', () => {
  it(
    'all cases pass',
    // Twelve cases at several model calls each, two at a time. Options go in
    // the second argument — Vitest 4 removed the trailing-options signature.
    { timeout: 600_000 },
    async () => {
      const suite = await runSuite({ concurrency: 2 });

      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(
        `${REPORT_DIR}/report.json`,
        JSON.stringify({ ...suite, cases: suite.cases.map((c) => ({ ...c, events: [] })) }, null, 2),
      );

      const markdown = summarise(suite);
      writeFileSync(`${REPORT_DIR}/summary.md`, markdown);

      // Appending to the job summary puts the table on the workflow run page,
      // so a failure is legible without downloading an artifact.
      if (process.env.GITHUB_STEP_SUMMARY) {
        writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
      }

      const failed = suite.cases.filter((c) => !c.passed);
      const detail = failed
        .map((c) => {
          const assertions = c.assertions
            .filter((a) => !a.passed)
            .map((a) => `    ✗ ${a.name}: expected ${a.expected}, got ${a.actual}`)
            .join('\n');
          return `  ${c.title}\n    reply: ${c.reply}\n    judge ${c.judgeScore}/5: ${c.judgeRationale}\n${assertions}`;
        })
        .join('\n\n');

      expect(
        failed.length,
        failed.length === 0 ? '' : `\n\n${failed.length} case(s) failed:\n\n${detail}\n`,
      ).toBe(0);
    },
  );
});

describe.skipIf(ENABLED)('eval suite (skipped)', () => {
  it('is skipped unless RUN_EVALS=1, because it spends money', () => {
    expect(ENABLED).toBe(false);
  });
});
