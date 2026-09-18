/**
 * Specialist runner.
 *
 * An async generator over a manual streaming loop, rather than the SDK's tool
 * runner. Two reasons. The pipeline needs to interleave its own work with the
 * model's — emit a tool_call the instant the model asks for one, time each
 * execution separately, keep the raw results for the verifier — and the tool
 * runner owns the loop, hiding those seams. And being a generator means text
 * deltas reach the browser as they arrive; a callback-based design cannot yield
 * from inside the SDK's event handlers, which forces the text to be batched
 * until the round completes.
 *
 * Each specialist is constructed with only the tools its config grants it. That
 * is the substance behind "this agent has 3 tools, not 10" — the model
 * physically cannot call `open_complaint` from the sales queue.
 */

import type Anthropic from '@anthropic-ai/sdk';
import config from '@config/agent.config.json';
import { anthropic, tierParams } from './client';
import { addUsage, EMPTY_USAGE, priceUsage, type Usage } from '../telemetry/cost';
import { executeTool, toolsForAgent, type ExecutedTool, type ToolContext } from '../tools/registry';

/** Guards against a model looping on tool calls. Two round trips is the norm. */
const MAX_TOOL_ROUNDS = 4;

export type SpecialistEvent =
  | { t: 'first_token'; elapsedMs: number }
  | { t: 'text'; delta: string }
  | { t: 'tool_call'; name: string; input: Record<string, unknown> }
  | { t: 'tool_result'; executed: ExecutedTool };

export interface SpecialistRun {
  /** Everything the caller would hear, across all rounds. */
  text: string;
  tools: ExecutedTool[];
  usage: Usage;
  /** Time to the first text token, the number the latency strip reports. */
  firstTokenMs: number | null;
  totalMs: number;
  model: string;
  agent: string;
  toolCount: number;
  stopReason: string | null;
  /** Set when the loop hit MAX_TOOL_ROUNDS rather than finishing. */
  truncated: boolean;
}

function systemFor(agentKey: string): Anthropic.TextBlockParam[] {
  const agent = (config.agents as Record<string, { prompt: string }>)[agentKey];
  if (!agent) throw new Error(`Unknown agent "${agentKey}" in config.agents`);

  // Shared policy first and agent prompt second, both stable across a call, so
  // the cache breakpoint sits after the whole system prompt. Volatile content —
  // the caller's turn, tool results, any correction — goes in messages, after
  // the breakpoint, where it cannot invalidate the prefix.
  return [
    { type: 'text', text: config.sharedPolicy.text },
    {
      type: 'text',
      text: agent.prompt,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

export async function* runSpecialist(args: {
  agentKey: string;
  messages: Anthropic.MessageParam[];
  /** Appended as a corrective turn on a retry. */
  correction?: string;
  toolContext?: ToolContext;
}): AsyncGenerator<SpecialistEvent, SpecialistRun> {
  const started = performance.now();
  const params = tierParams('specialist');
  const tools = toolsForAgent(args.agentKey);

  const messages: Anthropic.MessageParam[] = [...args.messages];
  if (args.correction) {
    // A correction arrives as a turn the model must answer, not as a
    // system-prompt edit — editing the system prompt mid-call would invalidate
    // the cached prefix and lose the reason the retry exists.
    messages.push({ role: 'user', content: args.correction });
  }

  const executed: ExecutedTool[] = [];
  let usage = { ...EMPTY_USAGE };
  let firstTokenMs: number | null = null;
  // Accumulated across rounds. A brief "let me check that" before a tool call
  // is permitted by the style policy and is genuinely good on a phone call, so
  // it counts as spoken text and is verified along with everything else.
  let spoken = '';
  let stopReason: string | null = null;
  let truncated = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = anthropic().messages.stream({
      ...params,
      system: systemFor(args.agentKey),
      ...(tools.length > 0 ? { tools } : {}),
      messages,
    });

    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type !== 'text_delta') continue;

      if (firstTokenMs === null) {
        firstTokenMs = Number((performance.now() - started).toFixed(1));
        yield { t: 'first_token', elapsedMs: firstTokenMs };
      }
      spoken += event.delta.text;
      yield { t: 'text', delta: event.delta.text };
    }

    const message = await stream.finalMessage();
    usage = addUsage(usage, priceUsage('specialist', message.usage));
    stopReason = message.stop_reason ?? null;

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: message.content });

    // All tool results go back in ONE user message. Splitting them across
    // several teaches the model to stop issuing parallel calls.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const input = (use.input ?? {}) as Record<string, unknown>;
      yield { t: 'tool_call', name: use.name, input };

      const run = executeTool(use.name, input, args.toolContext ?? {});
      executed.push(run);
      yield { t: 'tool_result', executed: run };

      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(run.result),
        // Surfacing a failure as an error block, rather than as a success
        // containing an error, is what lets the model recover conversationally
        // instead of reading the failure out as though it were an answer.
        ...(run.result.ok ? {} : { is_error: true }),
      });
    }

    messages.push({ role: 'user', content: results });

    if (round === MAX_TOOL_ROUNDS - 1) truncated = true;
  }

  return {
    text: spoken.trim(),
    tools: executed,
    usage,
    firstTokenMs,
    totalMs: Number((performance.now() - started).toFixed(1)),
    model: params.model,
    agent: args.agentKey,
    toolCount: tools.length,
    stopReason,
    truncated,
  };
}
