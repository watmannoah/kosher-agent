/**
 * Anthropic client and per-tier request shaping.
 *
 * The two tiers need genuinely different request bodies, and getting this wrong
 * is a 400 rather than a degradation:
 *
 *   Sonnet 5   — `temperature`, `top_p`, `top_k` and `budget_tokens` are all
 *                rejected. Thinking is configured with {type:'adaptive'} or
 *                {type:'disabled'}, and `output_config.effort` is supported.
 *   Haiku 4.5  — pre-4.6, so it is the mirror image: `temperature` is accepted
 *                and `output_config.effort` is rejected.
 *
 * So the shape is derived from capability flags in config rather than assumed,
 * which also means swapping a model id in config cannot silently produce an
 * invalid request.
 *
 * Specialists run with thinking disabled. This is a voice agent on a latency
 * budget and a hotline answer is a lookup plus two sentences, not a reasoning
 * task. The mitigations the SDK guidance recommends for thinking-off prompts —
 * permitting a brief sentence before a tool call, and a generic instruction
 * against emitting internal tags — are in the shared policy.
 */

import Anthropic from '@anthropic-ai/sdk';
import config from '@config/agent.config.json';
import type { ModelTier } from '../telemetry/cost';

let client: Anthropic | null = null;

export class MissingApiKeyError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set on the server.');
    this.name = 'MissingApiKeyError';
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * The shared client.
 *
 * Lazily constructed so that importing this module during a build, or in a
 * route that never calls a model, does not require the key to be present.
 */
export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingApiKeyError();
  client ??= new Anthropic({
    // Two retries by default; a voice turn cannot wait for more than one.
    maxRetries: 1,
    timeout: 30_000,
  });
  return client;
}

/** Request fields common to a tier, derived from its capability flags. */
export function tierParams(tier: ModelTier): {
  model: string;
  max_tokens: number;
  temperature?: number;
  thinking?: { type: 'disabled' };
  output_config?: { effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
} {
  const m = config.models[tier] as {
    id: string;
    maxTokens: number;
    temperature?: number;
    effort?: string;
    thinking?: string;
    supportsEffort: boolean;
    supportsTemperature: boolean;
  };

  const params: ReturnType<typeof tierParams> = {
    model: m.id,
    max_tokens: m.maxTokens,
  };

  // Rejected with a 400 on Sonnet 5 and every other 4.6+ model.
  if (m.supportsTemperature && typeof m.temperature === 'number') {
    params.temperature = m.temperature;
  }

  // Rejected with a 400 on Haiku 4.5, which predates the effort parameter.
  if (m.supportsEffort) {
    if (m.effort) {
      params.output_config = { effort: m.effort as 'low' };
    }
    if (m.thinking === 'disabled') {
      params.thinking = { type: 'disabled' };
    }
  }

  return params;
}

/** Turn an SDK error into something a hotline agent can say out loud. */
export function describeApiError(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof Anthropic.AuthenticationError) {
    return { message: 'The server is not configured with a valid API key.', retryable: false };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { message: 'The system is rate limited right now.', retryable: true };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { message: `Malformed request to the model: ${err.message}`, retryable: false };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { message: 'The model call timed out.', retryable: true };
  }
  if (err instanceof Anthropic.APIError) {
    return { message: `Model API error ${err.status}: ${err.message}`, retryable: (err.status ?? 0) >= 500 };
  }
  return {
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  };
}
