/**
 * A scriptable stand-in for the Anthropic client.
 *
 * The point is to exercise the pipeline's *control flow* without a network: the
 * retry loop, the shailah override, correction injection, the fallback path,
 * verifier gating, tool scoping. Those are ordinary logic bugs and they do not
 * need a real model to find — they need a predictable one.
 *
 * What this deliberately does NOT test is whether the prompts work, whether
 * triage classifies correctly, or whether the verifier judges well. Those need
 * the real API. This narrows the risk; it does not remove it.
 *
 * Responses are queued, and every request is recorded so a test can assert on
 * what the pipeline actually sent — which is how tool scoping and correction
 * injection are verified.
 */

import type Anthropic from '@anthropic-ai/sdk';

export interface ScriptedMessage {
  /** Text the model "says". Streamed in chunks by `stream()`. */
  text?: string;
  /** Tool calls the model requests. */
  toolUses?: Array<{ name: string; input: Record<string, unknown> }>;
  stopReason?: Anthropic.Message['stop_reason'];
  inputTokens?: number;
  outputTokens?: number;
}

function buildMessage(script: ScriptedMessage): Anthropic.Message {
  const content: Anthropic.ContentBlock[] = [];

  if (script.text) {
    content.push({ type: 'text', text: script.text, citations: null });
  }

  for (const [i, use] of (script.toolUses ?? []).entries()) {
    content.push({
      type: 'tool_use',
      id: `toolu_fake_${i}`,
      name: use.name,
      input: use.input,
    } as Anthropic.ToolUseBlock);
  }

  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'fake',
    content,
    stop_reason: script.stopReason ?? (script.toolUses?.length ? 'tool_use' : 'end_turn'),
    stop_sequence: null,
    usage: {
      input_tokens: script.inputTokens ?? 100,
      output_tokens: script.outputTokens ?? 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: null,
      service_tier: null,
    },
  } as unknown as Anthropic.Message;
}

/**
 * Mimics the shape the SDK's `.stream()` returns: async-iterable over events,
 * plus `finalMessage()`. The pipeline consumes both, so a fake that only did
 * one would pass while the real thing failed.
 */
function buildStream(script: ScriptedMessage) {
  const message = buildMessage(script);
  const text = script.text ?? '';

  // Chunked so the streaming path is genuinely exercised — a single chunk
  // would hide an off-by-one in delta accumulation.
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 8) chunks.push(text.slice(i, i + 8));

  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: chunk },
        };
      }
      yield { type: 'message_stop' };
    },
    async finalMessage() {
      return message;
    },
  };
}

export interface RecordedRequest {
  model: string;
  system?: unknown;
  messages: Anthropic.MessageParam[];
  tools?: Array<{ name: string }>;
  tool_choice?: unknown;
  temperature?: number;
  output_config?: unknown;
  thinking?: unknown;
}

export class FakeAnthropic {
  /** Responses for `messages.create` — triage and the verifier. */
  private creates: ScriptedMessage[] = [];
  /** Responses for `messages.stream` — specialists. */
  private streams: ScriptedMessage[] = [];

  readonly createRequests: RecordedRequest[] = [];
  readonly streamRequests: RecordedRequest[] = [];

  /** Throw on the nth create call (1-indexed), to test error handling. */
  failCreateAt: number | null = null;

  queueCreate(...scripts: ScriptedMessage[]): this {
    this.creates.push(...scripts);
    return this;
  }

  queueStream(...scripts: ScriptedMessage[]): this {
    this.streams.push(...scripts);
    return this;
  }

  /** Convenience: a triage `route` tool call. */
  queueTriage(input: Record<string, unknown>): this {
    return this.queueCreate({ toolUses: [{ name: 'route', input }] });
  }

  /** Convenience: a verifier `verdict` tool call. */
  queueVerdict(verdict: 'pass' | 'block', reason = 'test', ground = ''): this {
    return this.queueCreate({
      toolUses: [{ name: 'verdict', input: { verdict, ground, reason } }],
    });
  }

  readonly messages = {
    create: async (params: RecordedRequest): Promise<Anthropic.Message> => {
      this.createRequests.push(params);
      if (this.failCreateAt === this.createRequests.length) {
        throw new Error('fake network failure');
      }
      const script = this.creates.shift();
      if (!script) {
        throw new Error(
          `FakeAnthropic: unexpected messages.create call #${this.createRequests.length} — nothing queued`,
        );
      }
      return buildMessage(script);
    },

    stream: (params: RecordedRequest) => {
      this.streamRequests.push(params);
      const script = this.streams.shift();
      if (!script) {
        throw new Error(
          `FakeAnthropic: unexpected messages.stream call #${this.streamRequests.length} — nothing queued`,
        );
      }
      return buildStream(script);
    },
  };

  /** Tool names offered on the nth stream request, for scoping assertions. */
  toolsOfferedOn(index: number): string[] {
    return (this.streamRequests[index]?.tools ?? []).map((t) => t.name);
  }

  /** Flattened text of every user message on the nth stream request. */
  userTextOn(index: number): string {
    const messages = this.streamRequests[index]?.messages ?? [];
    return messages
      .filter((m) => m.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
  }
}
