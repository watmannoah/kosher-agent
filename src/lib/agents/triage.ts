/**
 * Triage — classification and routing.
 *
 * Runs on Haiku with a forced tool call, so the output is a validated object
 * rather than JSON-in-a-string that has to be parsed and defended against. Its
 * latency is on the critical path for every turn, so it gets a tight prompt,
 * 400 max tokens, temperature 0, and no tools other than the one it is forced
 * to call.
 *
 * The routing it produces is not advisory. `is_shailah` overrides the intent
 * entirely and hard-stops the normal pipeline — a halachic question wearing a
 * product-status costume ("is this cheese OK to eat with my chicken?") must not
 * reach the product agent.
 */

import type Anthropic from '@anthropic-ai/sdk';
import config from '@config/agent.config.json';
import { anthropic, tierParams } from './client';
import { priceUsage, type Usage } from '../telemetry/cost';

export type Intent =
  | 'product_status'
  | 'establishment'
  | 'sales'
  | 'complaint'
  | 'hours'
  | 'other';

export const INTENTS: readonly Intent[] = [
  'product_status',
  'establishment',
  'sales',
  'complaint',
  'hours',
  'other',
];

export interface TriageEntities {
  brand?: string;
  product?: string;
  establishment?: string;
  city?: string;
  symbol?: string;
  company?: string;
  contact?: string;
  zip?: string;
  upc?: string;
}

export interface TriageDecision {
  intent: Intent;
  isShailah: boolean;
  asksOtherAgency: boolean;
  urgency: 'normal' | 'high';
  entities: TriageEntities;
  /** Which agent this routes to once the shailah override is applied. */
  agent: string;
  usage: Usage;
  durationMs: number;
  model: string;
}

const ROUTE_TOOL: Anthropic.Tool = {
  name: 'route',
  description: 'Classify the caller turn and route it. Call this exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: [...INTENTS],
        description: 'The queue this turn belongs to.',
      },
      is_shailah: {
        type: 'boolean',
        description:
          'True when the caller asks what the halacha IS or what they SHOULD DO, rather than ' +
          'asking a factual question about our certification.',
      },
      asks_other_agency: {
        type: 'boolean',
        description:
          "True when the caller asks about another certification agency's reliability, " +
          'standards, or acceptability.',
      },
      urgency: {
        type: 'string',
        enum: ['normal', 'high'],
        description:
          'high when the caller is in a store, cooking, about to serve, or otherwise time-critical.',
      },
      entities: {
        type: 'object',
        description: 'What the caller named, verbatim. Omit anything absent.',
        properties: {
          brand: { type: 'string' },
          product: { type: 'string' },
          establishment: { type: 'string' },
          city: { type: 'string' },
          symbol: { type: 'string' },
          company: { type: 'string' },
          contact: { type: 'string' },
          zip: { type: 'string' },
          upc: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    required: ['intent', 'is_shailah', 'asks_other_agency', 'urgency', 'entities'],
    additionalProperties: false,
  },
  strict: true,
};

/** Map a decision to the agent that will handle it. */
export function agentFor(decision: {
  intent: Intent;
  isShailah: boolean;
}): string {
  // A shailah hard-stops everything else, from any state. BRIEF 2c.
  if (decision.isShailah) return 'shailah';
  return decision.intent;
}

export async function triage(
  text: string,
  history: Anthropic.MessageParam[] = [],
): Promise<TriageDecision> {
  const started = performance.now();
  const params = tierParams('triage');

  const response = await anthropic().messages.create({
    ...params,
    system: [
      {
        type: 'text',
        text: config.agents.triage.prompt,
        // The prompt is fixed and every turn re-sends it, so it is the one
        // thing worth a cache breakpoint on a call this small.
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [ROUTE_TOOL],
    tool_choice: { type: 'tool', name: 'route' },
    messages: [...history, { role: 'user', content: text }],
  });

  const usage = priceUsage('triage', response.usage);
  const durationMs = Number((performance.now() - started).toFixed(1));

  const call = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'route',
  );

  // tool_choice forces the call, so this is unreachable short of an API change.
  // Falling back to `other` keeps a caller talking to something rather than
  // seeing an error, and the intent is the least harmful default: it holds only
  // get_hours and lookup_alerts, so it cannot assert a certification status.
  if (!call) {
    return {
      intent: 'other',
      isShailah: false,
      asksOtherAgency: false,
      urgency: 'normal',
      entities: {},
      agent: 'other',
      usage,
      durationMs,
      model: params.model,
    };
  }

  const input = call.input as {
    intent?: string;
    is_shailah?: boolean;
    asks_other_agency?: boolean;
    urgency?: string;
    entities?: TriageEntities;
  };

  const intent = INTENTS.includes(input.intent as Intent) ? (input.intent as Intent) : 'other';
  const isShailah = input.is_shailah === true;

  // Strip empty strings the model may emit for absent entities, so downstream
  // tools see an absent field rather than a blank one they would search on.
  const entities: TriageEntities = {};
  for (const [key, value] of Object.entries(input.entities ?? {})) {
    if (typeof value === 'string' && value.trim()) {
      entities[key as keyof TriageEntities] = value.trim();
    }
  }

  return {
    intent,
    isShailah,
    asksOtherAgency: input.asks_other_agency === true,
    urgency: input.urgency === 'high' ? 'high' : 'normal',
    entities,
    agent: agentFor({ intent, isShailah }),
    usage,
    durationMs,
    model: params.model,
  };
}
