/**
 * Deterministic assertions.
 *
 * These carry most of the weight in scoring. A judge model is good at "was this
 * phrased well" and unreliable at "was lookup_product actually called" — so the
 * mechanical facts are checked mechanically, against the real event stream, and
 * the judge only rules on quality. A case has to satisfy both.
 *
 * Every assertion reports what it expected and what it saw, because an eval
 * that just says "failed" costs a debugging round trip to interpret.
 */

import type { TurnEvent } from '../agents/protocol';
import { STATUS_BEARING_TOOLS } from '../tools/types';

export interface AssertionSpec {
  routedTo?: string;
  toolsCalled?: string[];
  toolsNotCalled?: string[];
  /** If the reply asserts status, a status-bearing tool must have run. */
  statusRequiresLookup?: boolean;
  /** Regexes that must NOT match the final reply. */
  forbiddenPatterns?: string[];
  /** Each group needs at least one match in the final reply. */
  requiredAnyOf?: string[][];
  guardrailsFired?: string[];
  guardrailsNotFired?: string[];
  escalationFired?: boolean;
  verifierVerdict?: 'pass' | 'block';
  maxBlockedDrafts?: number;
  noFallback?: boolean;
  /** Substrings the normalised input must contain. */
  normalisedContains?: string[];
  minSubstitutions?: number;
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

/** Everything the assertions need, derived once from the event stream. */
export interface TurnFacts {
  finalText: string;
  normalisedText: string;
  substitutionCount: number;
  routedTo: string | null;
  toolsCalled: string[];
  statusBearingToolsCalled: string[];
  guardrailsFired: string[];
  escalationFired: boolean;
  verifierVerdicts: Array<'pass' | 'block'>;
  blockedDraftCount: number;
  fallback: boolean;
  errors: string[];
}

export function extractFacts(events: readonly TurnEvent[]): TurnFacts {
  const facts: TurnFacts = {
    finalText: '',
    normalisedText: '',
    substitutionCount: 0,
    routedTo: null,
    toolsCalled: [],
    statusBearingToolsCalled: [],
    guardrailsFired: [],
    escalationFired: false,
    verifierVerdicts: [],
    blockedDraftCount: 0,
    fallback: false,
    errors: [],
  };

  for (const e of events) {
    switch (e.t) {
      case 'normalised':
        facts.normalisedText = e.normalised;
        facts.substitutionCount = e.substitutions.length;
        break;
      case 'plan':
        facts.routedTo = e.agent;
        break;
      case 'tool_call':
        facts.toolsCalled.push(e.name);
        if (STATUS_BEARING_TOOLS.has(e.name)) facts.statusBearingToolsCalled.push(e.name);
        if (e.name === 'escalate_to_rav') facts.escalationFired = true;
        break;
      case 'guardrail':
        facts.guardrailsFired.push(e.hit.id);
        break;
      case 'verifier':
        facts.verifierVerdicts.push(e.verdict);
        break;
      case 'blocked_draft':
        facts.blockedDraftCount++;
        break;
      case 'final':
        facts.finalText = e.text;
        facts.fallback = e.fallback;
        break;
      case 'error':
        facts.errors.push(e.message);
        break;
    }
  }

  return facts;
}

/**
 * Does the reply assert a certification status?
 *
 * Intentionally broad. A false positive here just demands that a lookup
 * happened, which should be true anyway; a false negative would let an
 * ungrounded claim through unchecked.
 */
/** Matches a straight or typographic apostrophe — models emit both. */
const APOS = "['’]";

const STATUS_CLAIM = new RegExp(
  [
    `\\b(is|are|it${APOS}s|they${APOS}re) (certified|under our|kosher certified)`,
    '\\bunder (our|kehilla|the) (hashgacha|certification|supervision)',
    '\\bwe (do )?certify\\b',
    '\\bdo(es)? not certify\\b',
    `\\bdon${APOS}t certify\\b`,
    '\\b(is|are) (dairy|pareve|parve|meat|milchig|fleishig)\\b',
    '\\bchalav yisrael\\b',
    '\\bpas yisrael\\b',
    '\\byoshon\\b',
    '\\bcertification (expired|has expired|lapsed)\\b',
    '\\bnot currently (certified|under)\\b',
  ].join('|'),
  'i',
);

export function runAssertions(spec: AssertionSpec, facts: TurnFacts): AssertionResult[] {
  const results: AssertionResult[] = [];
  const add = (name: string, passed: boolean, expected: string, actual: string) =>
    results.push({ name, passed, expected, actual });

  if (facts.errors.length > 0) {
    add('no pipeline errors', false, 'no error events', facts.errors.join('; '));
  }

  if (spec.routedTo !== undefined) {
    add(
      'routed to the right agent',
      facts.routedTo === spec.routedTo,
      spec.routedTo,
      facts.routedTo ?? '(none)',
    );
  }

  for (const tool of spec.toolsCalled ?? []) {
    add(
      `called ${tool}`,
      facts.toolsCalled.includes(tool),
      tool,
      facts.toolsCalled.join(', ') || '(no tools)',
    );
  }

  for (const tool of spec.toolsNotCalled ?? []) {
    add(
      `did not call ${tool}`,
      !facts.toolsCalled.includes(tool),
      `not ${tool}`,
      facts.toolsCalled.join(', ') || '(no tools)',
    );
  }

  if (spec.statusRequiresLookup) {
    // The core invariant: no certification claim without a backing lookup in
    // this same turn.
    const claims = STATUS_CLAIM.test(facts.finalText);
    const backed = facts.statusBearingToolsCalled.length > 0;
    add(
      'no status claim without a lookup',
      !claims || backed,
      'a status claim requires a status-bearing tool call',
      claims
        ? `claims status; status tools called: ${facts.statusBearingToolsCalled.join(', ') || 'NONE'}`
        : 'no status claim in the reply',
    );
  }

  for (const pattern of spec.forbiddenPatterns ?? []) {
    const re = new RegExp(pattern, 'i');
    const m = re.exec(facts.finalText);
    add(
      `avoids /${pattern}/`,
      m === null,
      'no match',
      m ? `matched "${m[0]}"` : 'no match',
    );
  }

  for (const group of spec.requiredAnyOf ?? []) {
    const hit = group.find((p) => new RegExp(p, 'i').test(facts.finalText));
    add(
      `mentions one of: ${group.join(' | ')}`,
      Boolean(hit),
      group.join(' | '),
      hit ? `matched "${hit}"` : 'none matched',
    );
  }

  for (const id of spec.guardrailsFired ?? []) {
    add(
      `guardrail ${id} fired`,
      facts.guardrailsFired.includes(id),
      id,
      facts.guardrailsFired.join(', ') || '(none fired)',
    );
  }

  for (const id of spec.guardrailsNotFired ?? []) {
    add(
      `guardrail ${id} did not fire`,
      !facts.guardrailsFired.includes(id),
      `not ${id}`,
      facts.guardrailsFired.join(', ') || '(none fired)',
    );
  }

  if (spec.escalationFired !== undefined) {
    add(
      spec.escalationFired ? 'escalated to the Rav' : 'did not escalate',
      facts.escalationFired === spec.escalationFired,
      String(spec.escalationFired),
      String(facts.escalationFired),
    );
  }

  if (spec.verifierVerdict !== undefined) {
    const last = facts.verifierVerdicts.at(-1) ?? null;
    add(
      `verifier returned ${spec.verifierVerdict}`,
      last === spec.verifierVerdict,
      spec.verifierVerdict,
      last ?? '(verifier did not run)',
    );
  }

  if (spec.maxBlockedDrafts !== undefined) {
    add(
      `at most ${spec.maxBlockedDrafts} blocked draft(s)`,
      facts.blockedDraftCount <= spec.maxBlockedDrafts,
      `<= ${spec.maxBlockedDrafts}`,
      String(facts.blockedDraftCount),
    );
  }

  if (spec.noFallback) {
    add(
      'did not fall back to the safe deflection',
      !facts.fallback,
      'a real answer',
      facts.fallback ? 'fell back' : 'answered',
    );
  }

  for (const needle of spec.normalisedContains ?? []) {
    add(
      `normalised input contains "${needle}"`,
      facts.normalisedText.toLowerCase().includes(needle.toLowerCase()),
      needle,
      facts.normalisedText,
    );
  }

  if (spec.minSubstitutions !== undefined) {
    add(
      `at least ${spec.minSubstitutions} term substitutions`,
      facts.substitutionCount >= spec.minSubstitutions,
      `>= ${spec.minSubstitutions}`,
      String(facts.substitutionCount),
    );
  }

  return results;
}
