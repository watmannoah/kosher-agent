/**
 * Token accounting.
 *
 * Rates live in config/agent.config.json next to the model ids, so a model
 * swap changes both together. Cached reads are billed at roughly a tenth of
 * the input rate; counting them at full price would overstate the cost of the
 * system prompt, which is the part most likely to be cached.
 */

import config from '@config/agent.config.json';
import type Anthropic from '@anthropic-ai/sdk';

export type ModelTier = 'triage' | 'specialist' | 'verifier' | 'judge';

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

export function modelConfig(tier: ModelTier) {
  return config.models[tier];
}

/** Convert an SDK usage object into tokens plus dollars for a given tier. */
export function priceUsage(tier: ModelTier, usage: Anthropic.Usage | undefined): Usage {
  if (!usage) return { ...EMPTY_USAGE };

  const rates = config.models[tier].usdPerMillion;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;

  const costUsd =
    (inputTokens * rates.input +
      cacheReadTokens * rates.input * CACHE_READ_MULTIPLIER +
      cacheWriteTokens * rates.input * CACHE_WRITE_MULTIPLIER +
      outputTokens * rates.output) /
    1_000_000;

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd: Number(costUsd.toFixed(8)),
  };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: Number((a.costUsd + b.costUsd).toFixed(8)),
  };
}

/** Render a cost for the UI, where sub-cent figures are the norm. */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0';
  if (amount < 0.01) return `$${amount.toFixed(5)}`;
  if (amount < 1) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
