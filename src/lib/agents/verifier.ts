/**
 * The verifier.
 *
 * Receives the drafted reply plus the RAW tool results and returns pass or
 * block. It is a separate model call rather than a bigger prompt on the
 * specialist for one reason: a model checking its own work shares the
 * assumption that produced the error. The verifier never saw the caller's
 * pressure, has no draft to defend, and is given a checklist rather than a
 * conversation.
 *
 * It runs on the cheap tier because "does this claim appear in this JSON" is a
 * comparison, not a judgement, and paying Sonnet rates for it on every turn
 * would double the cost of the whole pipeline.
 */

import type Anthropic from '@anthropic-ai/sdk';
import config from '@config/agent.config.json';
import { anthropic, tierParams } from './client';
import { priceUsage, type Usage } from '../telemetry/cost';
import type { ExecutedTool } from '../tools/registry';
import type { Intent } from './triage';

export interface VerifierVerdict {
  verdict: 'pass' | 'block';
  /** Which lettered ground from the prompt was breached, when blocked. */
  ground: string | null;
  reason: string;
  usage: Usage;
  durationMs: number;
  model: string;
}

const STATUS_PATTERNS: readonly RegExp[] = config.verifier.shouldRun.statusAssertionPatterns.map(
  (p) => new RegExp(p, 'i'),
);

const VERDICT_TOOL: Anthropic.Tool = {
  name: 'verdict',
  description: 'Report whether the draft may reach the caller. Call this exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['pass', 'block'],
        description: 'block if any listed ground applies; pass otherwise.',
      },
      ground: {
        type: 'string',
        description:
          'The single letter (A through I) of the ground breached. Empty string when passing.',
      },
      reason: {
        type: 'string',
        description:
          'One sentence. When blocking, name the specific claim in the draft that the tool ' +
          'results do not support, so the retry can fix exactly that.',
      },
    },
    required: ['verdict', 'ground', 'reason'],
    additionalProperties: false,
  },
  strict: true,
};

/**
 * Whether this turn needs auditing.
 *
 * Skipping the verifier on turns that cannot cause religious harm is worth
 * roughly 250ms, which on a voice call is the difference between a pause and a
 * conversation. The decision is made from the turn's shape rather than its
 * content where possible — intent and whether any tool returned status — and
 * falls back to scanning the draft for status vocabulary.
 *
 * The bias is deliberately toward running it: an unnecessary verifier call
 * costs a fraction of a cent and a quarter second, while a skipped one that
 * should have run is the exact failure this system exists to prevent.
 */
export function shouldVerify(args: {
  intent: Intent;
  isShailah: boolean;
  draft: string;
  tools: readonly ExecutedTool[];
  guardrailFired: boolean;
}): { run: boolean; why: string } {
  const rules = config.verifier.shouldRun;

  if (args.guardrailFired && rules.alwaysRunWhenGuardrailFired) {
    return { run: true, why: 'a guardrail fired on this turn' };
  }

  // A shailah reply should contain no substantive content at all, so the
  // verifier's job here is confirming that nothing leaked in.
  if (args.isShailah) {
    return { run: true, why: 'shailah replies are checked for leaked halachic content' };
  }

  if (rules.alwaysRunForIntents.includes(args.intent)) {
    return { run: true, why: `intent "${args.intent}" can carry a certification claim` };
  }

  if (rules.alwaysRunWhenToolReturnedAlert) {
    const alerting = args.tools.some((t) => {
      if (!t.result.ok) return false;
      const data = t.result.data as { activeAlerts?: unknown[]; alerts?: unknown[] } | undefined;
      return Boolean(data?.activeAlerts?.length || data?.alerts?.length);
    });
    if (alerting) return { run: true, why: 'a tool returned an active alert' };
  }

  const assertion = STATUS_PATTERNS.find((p) => p.test(args.draft));
  if (assertion) {
    return { run: true, why: 'the draft uses status vocabulary' };
  }

  if (rules.skipForIntents.includes(args.intent)) {
    return { run: false, why: `intent "${args.intent}" asserts no status; skipped to save latency` };
  }

  return { run: true, why: 'default is to verify' };
}

export async function verify(args: {
  callerMessage: string;
  draft: string;
  tools: readonly ExecutedTool[];
}): Promise<VerifierVerdict> {
  const started = performance.now();
  const params = tierParams('verifier');

  // Raw results, unsummarised. The whole mechanism depends on the verifier
  // seeing what the tool actually returned rather than the specialist's
  // rendering of it.
  const toolBlock =
    args.tools.length === 0
      ? 'NO TOOLS WERE CALLED ON THIS TURN.'
      : args.tools
          .map(
            (t, i) =>
              `--- tool ${i + 1}: ${t.name} ---\n` +
              `arguments: ${JSON.stringify(t.input)}\n` +
              `result: ${JSON.stringify(t.result)}`,
          )
          .join('\n\n');

  const response = await anthropic().messages.create({
    ...params,
    system: [
      {
        type: 'text',
        text: config.verifier.prompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [VERDICT_TOOL],
    tool_choice: { type: 'tool', name: 'verdict' },
    messages: [
      {
        role: 'user',
        content:
          `CALLER SAID:\n${args.callerMessage}\n\n` +
          `RAW TOOL RESULTS:\n${toolBlock}\n\n` +
          `DRAFT REPLY:\n${args.draft}`,
      },
    ],
  });

  const usage = priceUsage('verifier', response.usage);
  const durationMs = Number((performance.now() - started).toFixed(1));

  const call = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'verdict',
  );

  if (!call) {
    // Forced tool_choice makes this unreachable, but a verifier that cannot
    // reach a verdict must not default to letting the draft through.
    return {
      verdict: 'block',
      ground: null,
      reason: 'The verifier did not return a verdict, so the draft is held rather than assumed safe.',
      usage,
      durationMs,
      model: params.model,
    };
  }

  const input = call.input as { verdict?: string; ground?: string; reason?: string };
  const blocked = input.verdict === 'block';

  return {
    verdict: blocked ? 'block' : 'pass',
    ground: blocked ? (input.ground?.trim() || null) : null,
    reason: input.reason?.trim() || (blocked ? 'Blocked without a stated reason.' : 'Grounded in the tool results.'),
    usage,
    durationMs,
    model: params.model,
  };
}

/** Corrective instruction injected into the retry after a verifier block. */
export function correctionFor(verdict: VerifierVerdict): string {
  return (
    `Your previous draft was BLOCKED by the verifier before it reached the caller` +
    `${verdict.ground ? ` on ground ${verdict.ground}` : ''}: ${verdict.reason}\n\n` +
    `Rewrite it so that every factual claim is supported by a tool result you actually received ` +
    `on this turn. If you need information you do not have, call the tool for it or say plainly ` +
    `that you need to check. Do not restate the blocked claim in softer words.`
  );
}
