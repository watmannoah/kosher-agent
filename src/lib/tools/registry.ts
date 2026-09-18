/**
 * Tool registry: schemas, dispatch, and per-agent scoping.
 *
 * Every tool is declared `strict` with `additionalProperties: false`, so
 * arguments validate exactly rather than arriving as something the handler has
 * to defend against. The per-agent `tools` lists in agent.config.json index into
 * this registry — that is what makes "this agent has 3 tools, not 10" true in
 * code rather than a claim in the UI.
 */

import type Anthropic from '@anthropic-ai/sdk';
import config from '@config/agent.config.json';
import type { ToolResult } from './types';
import { checkStoreAvailability, lookupAlerts, lookupProduct, verifySymbol } from './product';
import { lookupEstablishment } from './establishment';
import { getCertificationProcess, transferToCertificationDept } from './sales';
import { escalateToRav, getHours, openComplaint } from './escalation';

/** Extra context the pipeline injects; never model-supplied. */
export interface ToolContext {
  /** Pinned by evals so date-dependent tools are reproducible. */
  now?: Date;
}

type Handler = (args: Record<string, unknown>, ctx: ToolContext) => ToolResult;

interface ToolDefinition {
  name: string;
  description: string;
  schema: Anthropic.Tool['input_schema'];
  handler: Handler;
}

const str = (description: string) => ({ type: 'string' as const, description });
const num = (description: string) => ({ type: 'number' as const, description });

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'lookup_product',
    description:
      'Look up a product in the Kehilla certification database. Returns certification status, ' +
      'symbol, dairy/meat/pareve, chalav yisrael, pas yisrael, yoshon, Pesach status as a ' +
      'separate field, and any active alerts. Distinguishes "we do not certify it" from "it is ' +
      'not kosher". Call this before saying anything about a product\'s status.',
    schema: {
      type: 'object',
      properties: {
        brand: str('Brand name as the caller said it. Misspellings and mishearings are handled.'),
        name: str('Product name as the caller said it.'),
        upc: str('UPC/barcode if the caller reads one off the package.'),
      },
      required: [],
      additionalProperties: false,
    },
    handler: (a) =>
      lookupProduct({
        brand: a.brand as string | undefined,
        name: a.name as string | undefined,
        upc: a.upc as string | undefined,
      }),
  },
  {
    name: 'verify_symbol',
    description:
      'Identify a kosher certification symbol from the caller\'s spoken description of what is ' +
      'printed on a package. Identification ONLY — returns which symbol it is and whose it is, ' +
      'and never any judgement about reliability or acceptability.',
    schema: {
      type: 'object',
      properties: {
        description: str(
          'The caller\'s description of the symbol — the letters, and any shape around them.',
        ),
      },
      required: ['description'],
      additionalProperties: false,
    },
    handler: (a) => verifySymbol({ description: a.description as string }),
  },
  {
    name: 'lookup_establishment',
    description:
      'Look up a restaurant, bakery, caterer, butcher, or catering hall. Returns current status, ' +
      'expiry, mashgiach type, pas yisrael and bishul yisrael. Expiry is evaluated against ' +
      'today, so an expired certification comes back as expired.',
    schema: {
      type: 'object',
      properties: {
        name: str('Establishment name as the caller said it.'),
        city: str('Town or city, if the caller knows it. Helps when a name is shared.'),
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: (a, ctx) =>
      lookupEstablishment({
        name: a.name as string,
        city: a.city as string | undefined,
        now: ctx.now,
      }),
  },
  {
    name: 'check_store_availability',
    description:
      'Find where a product has been reported stocked. Requires a product_id from a prior ' +
      'lookup_product call — availability is only meaningful for a product already identified.',
    schema: {
      type: 'object',
      properties: {
        product_id: str('The `matched.id` value from a previous lookup_product result.'),
        zip: str('Caller\'s ZIP code, to prefer nearby stores.'),
      },
      required: ['product_id'],
      additionalProperties: false,
    },
    handler: (a) =>
      checkStoreAvailability({
        product_id: a.product_id as string,
        zip: a.zip as string | undefined,
      }),
  },
  {
    name: 'lookup_alerts',
    description:
      'List active kashrus alerts — recalls, mislabelling, revoked certifications, counterfeit ' +
      'symbol reports. Optionally filtered to one product or establishment, or to alerts issued ' +
      'since a date.',
    schema: {
      type: 'object',
      properties: {
        product_id: str('Product or establishment id to filter to. Omit for all active alerts.'),
        since: str('ISO date; only alerts issued on or after it.'),
      },
      required: [],
      additionalProperties: false,
    },
    handler: (a) =>
      lookupAlerts({
        product_id: a.product_id as string | undefined,
        since: a.since as string | undefined,
      }),
  },
  {
    name: 'get_certification_process',
    description:
      'Get the certification process, timeline, and an indicative annual cost RANGE with the ' +
      'factors that drive it, for a company asking to become certified. Returns bands only — ' +
      'there is no single-figure cost available from this tool by design.',
    schema: {
      type: 'object',
      properties: {
        facilities: num('Number of production facilities.'),
        products: num('Number of distinct products or SKUs.'),
        category: str('What they make — e.g. "snack foods", "dairy", "meat", "catering".'),
      },
      required: [],
      additionalProperties: false,
    },
    handler: (a) =>
      getCertificationProcess({
        facilities: a.facilities as number | undefined,
        products: a.products as number | undefined,
        category: a.category as string | undefined,
      }),
  },
  {
    name: 'transfer_to_certification_dept',
    description:
      'Route a certification enquiry to the certification department. Requires a company name ' +
      'and a contact; returns a reference to give the caller.',
    schema: {
      type: 'object',
      properties: {
        company: str('Company name.'),
        contact: str('Contact name, phone, or email.'),
        notes: str('Anything relevant captured on the call.'),
      },
      required: ['company', 'contact'],
      additionalProperties: false,
    },
    handler: (a) =>
      transferToCertificationDept({
        company: a.company as string,
        contact: a.contact as string,
        notes: a.notes as string | undefined,
      }),
  },
  {
    name: 'open_complaint',
    description:
      'Open a consumer complaint case. Requires what the caller observed and a callback. Returns ' +
      'the real case number — never state a case number this tool has not returned.',
    schema: {
      type: 'object',
      properties: {
        product_id: str('Product id if the complaint concerns an identified product.'),
        details: str('What the caller observed, in their own terms.'),
        callback: str('Callback phone number or email.'),
      },
      required: ['details', 'callback'],
      additionalProperties: false,
    },
    handler: (a) =>
      openComplaint({
        product_id: a.product_id as string | undefined,
        details: a.details as string,
        callback: a.callback as string,
      }),
  },
  {
    name: 'get_hours',
    description:
      'Whether the hotline is open, including Erev Shabbos and Yom Tov closure and the ' +
      'candle-lighting-relative closing time. Always call this rather than stating hours from ' +
      'memory — closure moves weekly.',
    schema: {
      type: 'object',
      properties: {
        date: str('ISO date to check. Defaults to today.'),
      },
      required: [],
      additionalProperties: false,
    },
    handler: (a, ctx) => getHours({ date: a.date as string | undefined, now: ctx.now }),
  },
  {
    name: 'escalate_to_rav',
    description:
      'Route a halachic question to the Rav on call. Returns availability and the callback ' +
      'window, with after-hours handling derived from the same calendar as get_hours.',
    schema: {
      type: 'object',
      properties: {
        question: str("The caller's question, in their own words."),
        urgency: {
          type: 'string' as const,
          enum: ['normal', 'high'],
          description: 'high if the caller is mid-cooking, about to serve, or otherwise urgent.',
        },
      },
      required: ['question'],
      additionalProperties: false,
    },
    handler: (a, ctx) =>
      escalateToRav({
        question: a.question as string,
        urgency: a.urgency as string | undefined,
        now: ctx.now,
      }),
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

/** Anthropic tool definitions for a named agent, per its config grant. */
export function toolsForAgent(agentKey: string): Anthropic.Tool[] {
  const agent = (config.agents as Record<string, { tools?: string[] }>)[agentKey];
  const granted = agent?.tools ?? [];

  return granted.map((name) => {
    const def = BY_NAME.get(name);
    if (!def) {
      // A typo in the config must fail loudly at startup, not silently remove a
      // tool an agent's prompt tells it to call.
      throw new Error(
        `Agent "${agentKey}" is granted unknown tool "${name}". Known: ${toolNames().join(', ')}`,
      );
    }
    return {
      name: def.name,
      description: def.description,
      input_schema: def.schema,
      strict: true,
    } satisfies Anthropic.Tool;
  });
}

/** How many tools an agent holds — surfaced in the UI. */
export function toolCountForAgent(agentKey: string): number {
  const agent = (config.agents as Record<string, { tools?: string[] }>)[agentKey];
  return agent?.tools?.length ?? 0;
}

export interface ExecutedTool {
  name: string;
  input: Record<string, unknown>;
  result: ToolResult;
  durationMs: number;
}

/**
 * Run a tool.
 *
 * A handler throwing is a bug in this codebase, not a model error, but it must
 * not take the call down — the caller is mid-conversation. It comes back as a
 * typed failure the agent can speak from.
 */
export function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext = {},
): ExecutedTool {
  const started = performance.now();
  const def = BY_NAME.get(name);

  if (!def) {
    return {
      name,
      input,
      result: {
        ok: false,
        error: 'invalid_arguments',
        message: `No such tool: ${name}.`,
      },
      durationMs: 0,
    };
  }

  let result: ToolResult;
  try {
    result = def.handler(input, ctx);
  } catch (err) {
    result = {
      ok: false,
      error: 'invalid_arguments',
      message:
        `The ${name} lookup failed. Tell the caller the system could not complete the lookup and ` +
        `offer to take a number — do not answer from memory. (${
          err instanceof Error ? err.message : String(err)
        })`,
    };
  }

  return {
    name,
    input,
    result,
    durationMs: Number((performance.now() - started).toFixed(1)),
  };
}
