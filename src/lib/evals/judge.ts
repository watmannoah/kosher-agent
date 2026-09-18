/**
 * LLM-as-judge.
 *
 * Runs on the strong tier, unlike everything else on the hot path, because it
 * is never in front of a caller — latency does not matter and grading quality
 * does. It sees the caller's turn, the raw tool results, the reply, and the
 * case's own rubric, and returns a score with a one-line rationale.
 *
 * It grades quality only. Whether a tool was called is checked mechanically in
 * assertions.ts; asking a model to confirm it would be both slower and less
 * reliable than reading the event stream.
 */

import type Anthropic from '@anthropic-ai/sdk';
import evalsConfig from '@config/evals.json';
import { anthropic, tierParams } from '../agents/client';
import { priceUsage, type Usage } from '../telemetry/cost';
import type { ExecutedTool } from '../tools/registry';

export interface JudgeResult {
  score: number;
  rationale: string;
  passed: boolean;
  usage: Usage;
  durationMs: number;
}

const GRADE_TOOL: Anthropic.Tool = {
  name: 'grade',
  description: 'Report the grade for this turn. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      score: {
        type: 'integer',
        enum: [1, 2, 3, 4, 5],
        description: '1 harmful, 3 vague, 5 nothing a supervising Rav would change.',
      },
      rationale: {
        type: 'string',
        description: 'One line. Name the specific thing that set the score.',
      },
    },
    required: ['score', 'rationale'],
    additionalProperties: false,
  },
  strict: true,
};

export async function judge(args: {
  callerMessage: string;
  reply: string;
  rubric: string;
  tools: readonly ExecutedTool[];
}): Promise<JudgeResult> {
  const started = performance.now();
  const params = tierParams('judge');

  const toolBlock =
    args.tools.length === 0
      ? 'NO TOOLS WERE CALLED.'
      : args.tools
          .map(
            (t, i) =>
              `--- ${i + 1}: ${t.name}(${JSON.stringify(t.input)}) ---\n${JSON.stringify(t.result)}`,
          )
          .join('\n\n');

  const response = await anthropic().messages.create({
    ...params,
    system: [
      {
        type: 'text',
        text: evalsConfig.judge.prompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [GRADE_TOOL],
    tool_choice: { type: 'tool', name: 'grade' },
    messages: [
      {
        role: 'user',
        content:
          `WHAT THIS CASE IS TESTING:\n${args.rubric}\n\n` +
          `CALLER SAID:\n${args.callerMessage}\n\n` +
          `RAW TOOL RESULTS THE AGENT RECEIVED:\n${toolBlock}\n\n` +
          `THE AGENT REPLIED:\n${args.reply}`,
      },
    ],
  });

  const usage = priceUsage('judge', response.usage);
  const durationMs = Number((performance.now() - started).toFixed(1));

  const call = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'grade',
  );

  if (!call) {
    return {
      score: 0,
      rationale: 'The judge returned no grade.',
      passed: false,
      usage,
      durationMs,
    };
  }

  const input = call.input as { score?: number; rationale?: string };
  const score = Number(input.score) || 0;

  return {
    score,
    rationale: input.rationale?.trim() || '(no rationale given)',
    passed: score >= evalsConfig.judge.passThreshold,
    usage,
    durationMs,
  };
}
