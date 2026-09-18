/**
 * Guardrails.
 *
 * These are string and structure checks in code, running before and after the
 * model. That is deliberate rather than lazy: the failure modes here are
 * specific phrasings ("it's not kosher", "that's fine", "the cost is $X") and a
 * regex catches those more reliably and 200ms faster than asking another model
 * whether the draft was acceptable. The verifier handles what regexes cannot —
 * whether a claim is actually supported by the tool results.
 *
 * Every pattern lives in config/agent.config.json, so tightening a guardrail is
 * a config change with an eval to prove it. That is what the deliberate
 * regression commit exercises.
 */

import config from '@config/agent.config.json';

export type GuardrailAction = 'flag' | 'block' | 'transfer';

export interface GuardrailHit {
  id: string;
  label: string;
  action: GuardrailAction;
  /** The substring that tripped it, for the UI. */
  matched: string;
  /** Character offset in the checked text. */
  index: number;
}

interface CompiledRule {
  id: string;
  label: string;
  action: GuardrailAction;
  patterns: RegExp[];
  exemptPatterns: RegExp[];
}

/**
 * Patterns are compiled once at module load.
 *
 * An invalid regex in config must fail loudly here rather than silently
 * disabling a guardrail at request time — a guardrail that quietly stops
 * existing is worse than one that never existed.
 */
function compile(
  key: string,
  raw: { id: string; label: string; action: string; patterns?: string[]; exemptPatterns?: string[] },
): CompiledRule {
  const build = (sources: string[] | undefined, kind: string) =>
    (sources ?? []).map((p) => {
      try {
        return new RegExp(p, 'i');
      } catch (err) {
        throw new Error(
          `Guardrail "${key}" has an invalid ${kind} pattern ${JSON.stringify(p)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });

  return {
    id: raw.id,
    label: raw.label,
    action: raw.action as GuardrailAction,
    patterns: build(raw.patterns, 'pattern'),
    exemptPatterns: build(raw.exemptPatterns, 'exempt'),
  };
}

const G = config.guardrails;

export const INJECTION_RULE = compile('injection', G.injection);

/** Rules applied to a drafted reply, in the order they are reported. */
export const OUTPUT_RULES: readonly CompiledRule[] = [
  compile('forbiddenPhrases', G.forbiddenPhrases),
  compile('paskening', G.paskening),
  compile('otherAgency', G.otherAgency),
  compile('pricing', G.pricing),
];

function check(text: string, rule: CompiledRule): GuardrailHit | null {
  for (const pattern of rule.patterns) {
    const m = pattern.exec(text);
    if (!m) continue;

    // An exemption clears the whole rule for this text, not just this pattern.
    // "this does not mean it's not kosher" contains "it's not kosher", and the
    // sentence that says so correctly is the one the system is trying to
    // produce — matching it would block the right answer.
    if (rule.exemptPatterns.some((ex) => ex.test(text))) return null;

    return {
      id: rule.id,
      label: rule.label,
      action: rule.action,
      matched: m[0],
      index: m.index,
    };
  }
  return null;
}

/** Screen caller input before it reaches any model. */
export function checkInput(text: string): GuardrailHit | null {
  return check(text, INJECTION_RULE);
}

/** Screen a drafted reply before it reaches the caller. */
export function checkOutput(text: string): GuardrailHit[] {
  const hits: GuardrailHit[] = [];
  for (const rule of OUTPUT_RULES) {
    const hit = check(text, rule);
    if (hit) hits.push(hit);
  }
  return hits;
}

/** The blocking subset of output hits. */
export function blockingHits(hits: readonly GuardrailHit[]): GuardrailHit[] {
  return hits.filter((h) => h.action === 'block');
}

/**
 * Corrective instruction fed back to the specialist on a blocked draft.
 *
 * Names the rule and quotes the offending text, because "your draft was
 * rejected" produces another draft with the same problem. The retry has to know
 * which words caused it.
 */
export function correctionFor(hits: readonly GuardrailHit[]): string {
  const lines = hits.map((h) => {
    switch (h.id) {
      case 'absence_implies_treif':
        return `You wrote "${h.matched}". Absence from our database means only that WE do not certify it — it may well be certified by another agency. Say that we do not certify it, never that it is not kosher, and offer to identify the symbol on the package.`;
      case 'no_paskening':
        return `You wrote "${h.matched}", which is halachic guidance. You must give none at all — not a principle, not a hint, not whether it is likely to be fine. Decline explicitly and route to the Rav on call.`;
      case 'no_agency_judgement':
        return `You wrote "${h.matched}", which characterises another agency's standards. Say only that you can speak to Kehilla's own certification, and that a question about another agency goes to the caller's own Rav.`;
      case 'no_binding_quote':
        return `You wrote "${h.matched}", which a caller could hear as a quote. Give the range as a range with what drives it, and route to the certification department.`;
      default:
        return `You wrote "${h.matched}", which broke the ${h.label} rule.`;
    }
  });

  return `Your previous draft was BLOCKED before it reached the caller. ${lines.join(' ')} Rewrite it. Keep everything that was correct; fix only what was flagged.`;
}
