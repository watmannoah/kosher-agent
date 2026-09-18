/**
 * Resolving what the caller said to a record.
 *
 * The important property is that ambiguity survives. A lookup that guesses
 * between `Arbel Foods` and `Arbeli Brands` will sometimes tell a caller the
 * wrong product is certified, which is the religious-harm failure the whole
 * system exists to prevent. So every resolver here can return `ambiguous` with
 * its candidates, and the tools turn that into a question rather than a pick.
 */

import { editDistance, phoneticKey, similarity } from '../normalise/phonetic';

export type MatchKind = 'exact' | 'single' | 'ambiguous' | 'none';

export interface MatchOutcome<T> {
  kind: MatchKind;
  /** Set for `exact` and `single` only. */
  best: T | null;
  /** Set for `ambiguous`; the options to put to the caller. */
  candidates: T[];
}

const none = <T>(): MatchOutcome<T> => ({ kind: 'none', best: null, candidates: [] });

/** Similarity floor for treating a fuzzy hit as a real match. */
const NAME_THRESHOLD = 0.72;
/**
 * Two candidates within this much of each other are not distinguishable enough
 * to choose between. Deliberately generous — a false ambiguity costs one
 * clarifying question, a false confidence costs a wrong certification answer.
 */
const AMBIGUITY_MARGIN = 0.12;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Generic words in a trading name that carry no identifying information.
 *
 * Callers say "Arbel", not "Arbel Foods", and "Migdal", not "Migdal
 * Provisions" — the same way nobody says "Osem Ltd" out loud. Matching only
 * against full catalogue names means the most natural thing a caller can say
 * scores worst: `similarity('arbel', 'arbel foods')` is 0.45, well under any
 * usable threshold.
 */
const GENERIC_NAME_WORDS = new Set([
  'foods', 'food', 'brands', 'brand', 'co', 'company', 'inc', 'llc', 'ltd',
  'provisions', 'mills', 'mill', 'confections', 'beverages', 'snacks',
  'products', 'kosher', 'grain', 'the',
]);

/** The forms of a name a caller might plausibly say. */
function aliasesFor(name: string): string[] {
  const tokens = norm(name).split(' ').filter(Boolean);
  const aliases = new Set<string>([norm(name)]);

  const significant = tokens.filter((t) => !GENERIC_NAME_WORDS.has(t));
  if (significant.length > 0 && significant.length < tokens.length) {
    aliases.add(significant.join(' '));
  }
  // The leading word alone, which is how brands are usually spoken.
  if (tokens.length > 1) aliases.add(tokens[0]);

  return [...aliases];
}

/**
 * Resolve a spoken name against a set of known names.
 *
 * Matching runs over aliases (see above), and the phonetic-group check runs
 * BEFORE the exact check. That ordering is deliberate: when two names in the
 * database are phonetically indistinguishable, the answer is to ask, even if
 * the caller's words exactly matched the shorter one. `Arbel` and `Arbeli`
 * differ by one unstressed vowel, which is not a distinction a phone line
 * reliably carries, and picking the exact match would be a guess wearing
 * confidence. A false ambiguity costs one clarifying question; a false
 * confidence tells someone the wrong product is certified.
 */
export function resolveName(query: string, known: readonly string[]): MatchOutcome<string> {
  const q = norm(query);
  if (!q) return none();

  const entries = known.map((name) => ({ name, aliases: aliasesFor(name) }));

  // Phonetic group first — see the note above on ordering.
  const qKey = phoneticKey(q);
  if (qKey.length >= 3) {
    const group = entries.filter((e) => e.aliases.some((a) => phoneticKey(a) === qKey));
    if (group.length === 1) {
      return { kind: 'single', best: group[0].name, candidates: [group[0].name] };
    }
    if (group.length > 1) {
      return { kind: 'ambiguous', best: null, candidates: group.map((e) => e.name) };
    }
  }

  const exact = entries.find((e) => e.aliases.includes(q));
  if (exact) return { kind: 'exact', best: exact.name, candidates: [exact.name] };

  // Fuzzy over aliases, keeping everything close to the leader rather than just
  // the leader, so near-ties surface as ambiguity.
  const scored = entries
    .map((e) => ({
      name: e.name,
      score: Math.max(...e.aliases.map((a) => similarity(q, a))),
    }))
    .filter((s) => s.score >= NAME_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return none();

  const leader = scored[0];
  const contenders = scored.filter((s) => leader.score - s.score <= AMBIGUITY_MARGIN);

  if (contenders.length > 1) {
    return { kind: 'ambiguous', best: null, candidates: contenders.map((c) => c.name) };
  }
  return { kind: 'single', best: leader.name, candidates: [leader.name] };
}

/**
 * Score a spoken product name against a catalogue name.
 *
 * Token-coverage weighted rather than whole-string distance, because callers
 * say "the tomato sauce" for "Tomato & Basil Pasta Sauce" — a short correct
 * subset should beat a long near-miss. Each query token counts if it matches
 * any catalogue token exactly, as a prefix, or within one edit.
 */
export function scoreProductName(query: string, candidate: string): number {
  const qTokens = norm(query).split(' ').filter(Boolean);
  const cTokens = norm(candidate).split(' ').filter(Boolean);
  if (qTokens.length === 0 || cTokens.length === 0) return 0;

  let hits = 0;
  for (const qt of qTokens) {
    // Single-letter and very short tokens carry no signal.
    if (qt.length < 2) {
      hits += 0.25;
      continue;
    }
    const matched = cTokens.some(
      (ct) =>
        ct === qt ||
        (qt.length >= 4 && ct.startsWith(qt)) ||
        (ct.length >= 4 && qt.startsWith(ct)) ||
        editDistance(qt, ct, 1) <= 1,
    );
    if (matched) hits += 1;
  }

  const coverage = hits / qTokens.length;
  // Mild preference for candidates the query covers a good share of, so
  // "chocolate" prefers "Dark Chocolate Bar" over "Chocolate-Covered
  // Marshmallows With Extra Words".
  const brevity = Math.min(1, qTokens.length / cTokens.length);
  return coverage * 0.85 + brevity * 0.15;
}

/** Resolve a product name within an already-resolved brand's catalogue. */
export function resolveProductName<T extends { name: string }>(
  query: string,
  items: readonly T[],
): MatchOutcome<T> {
  if (items.length === 0) return none();
  if (!norm(query)) {
    // No product named at all. Every item in the brand is a candidate, which
    // the caller has to narrow — the tool must not answer for the whole brand.
    return items.length === 1
      ? { kind: 'single', best: items[0], candidates: [items[0]] }
      : { kind: 'ambiguous', best: null, candidates: [...items] };
  }

  const scored = items
    .map((item) => ({ item, score: scoreProductName(query, item.name) }))
    .sort((a, b) => b.score - a.score);

  const leader = scored[0];
  if (leader.score < 0.5) return none();

  const contenders = scored.filter((s) => leader.score - s.score <= AMBIGUITY_MARGIN);
  if (contenders.length > 1) {
    return { kind: 'ambiguous', best: null, candidates: contenders.map((c) => c.item) };
  }
  return {
    kind: leader.score >= 0.99 ? 'exact' : 'single',
    best: leader.item,
    candidates: [leader.item],
  };
}
