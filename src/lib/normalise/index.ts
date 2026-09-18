/**
 * Term normalisation: the layer between STT and the models.
 *
 * Runs longest-phrase-first over the token stream, trying three strategies in
 * descending confidence: exact dictionary hit, fuzzy match on the raw string,
 * phonetic match on the consonant skeleton. The first hit wins and consumes its
 * tokens, so "cholov yisroel" resolves as one two-word phrase rather than two
 * separate one-word guesses.
 *
 * Budget is 20ms. The dictionary is a few hundred entries and the phonetic index
 * is precomputed at module load, so the per-turn work is bounded by the input
 * length rather than the dictionary size for exact hits, and only falls through
 * to the O(dictionary) scans for tokens that miss.
 */

import { MAX_PHRASE_WORDS, TERMS, VARIANT_INDEX, type TermEntry, type TermKind } from './dictionary';
import { editDistance, letterMask, phoneticKey, popcount, similarity } from './phonetic';
import { BRAND_INDEX } from './brands';
import { isAllStopwords } from './stopwords';

export interface Substitution {
  /** Exactly as it appeared in the raw input. */
  from: string;
  /** What the models will see instead. */
  to: string;
  /** Character offsets into the raw string, for UI highlighting. */
  start: number;
  end: number;
  kind: TermKind;
  method: 'exact' | 'fuzzy' | 'phonetic';
  confidence: number;
  gloss: string;
}

export interface NormaliseResult {
  raw: string;
  normalised: string;
  substitutions: Substitution[];
  durationMs: number;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

/** Fuzzy matching below this similarity is noise, not a recovery. */
const FUZZY_THRESHOLD = 0.78;
/**
 * A phonetic skeleton shorter than three symbols matches far too much — at two,
 * `yoshon` (SN) collides with `is on`. Terms whose skeleton is that short are
 * still reachable via their exact variant list and fuzzy matching.
 */
const MIN_PHONETIC_KEY = 3;
/** Edit-distance ceiling; also the width of the length buckets scanned. */
const MAX_EDITS = 3;

/** Phonetic index over every dictionary spelling. Built once. */
const PHONETIC_INDEX: ReadonlyMap<string, TermEntry> = (() => {
  const m = new Map<string, TermEntry>();
  for (const entry of TERMS) {
    for (const spelling of [entry.canonical, ...entry.variants]) {
      const key = phoneticKey(spelling);
      if (key.length < MIN_PHONETIC_KEY) continue;
      // First spelling to claim a key keeps it; canonical forms are listed
      // first, so a collision resolves toward the canonical word.
      if (!m.has(key)) m.set(key, entry);
    }
  }
  return m;
})();

/**
 * Dictionary spellings bucketed by string length.
 *
 * Edit distance cannot exceed the length difference, so a phrase of length L
 * can only match spellings of length L±MAX_EDITS. Bucketing turns the length
 * gate from a per-candidate branch into an index lookup, which is what keeps a
 * long utterance inside the 20ms budget — the flat scan was 25ms on a 660-char
 * input because it computed the gate against all ~250 spellings per token span.
 */
interface FuzzyCandidate {
  spelling: string;
  entry: TermEntry;
  /** Precomputed letter bitmask, so the prefilter costs nothing at match time. */
  mask: number;
}

const FUZZY_BY_LENGTH: ReadonlyMap<number, readonly FuzzyCandidate[]> = (() => {
  const m = new Map<number, FuzzyCandidate[]>();
  for (const entry of TERMS) {
    for (const spelling of [entry.canonical, ...entry.variants]) {
      const lower = spelling.toLowerCase();
      const bucket = m.get(lower.length) ?? [];
      bucket.push({ spelling: lower, entry, mask: letterMask(lower) });
      m.set(lower.length, bucket);
    }
  }
  return m;
})();

/**
 * Memo over phrase -> match, shared across calls.
 *
 * Browser STT fires interim results continuously as someone speaks, each one a
 * longer prefix of the same utterance, so the same leading phrases get
 * normalised dozens of times in a single turn. Normalisation is pure, so the
 * result is cacheable. Bounded, and cleared wholesale rather than evicted
 * per-entry — the dictionary is fixed, so a stale entry is impossible and the
 * only risk is unbounded growth.
 */
const MEMO_LIMIT = 4000;
const memo = new Map<string, MatchHit | null>();

interface MatchHit {
  entry: TermEntry;
  confidence: number;
  method: Substitution['method'];
}

function tokenise(input: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}']+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/** Preserve the caller's capitalisation style when swapping a word in. */
function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function fuzzyLookup(phrase: string): { entry: TermEntry; confidence: number } | null {
  let best: { entry: TermEntry; confidence: number } | null = null;
  const phraseMask = letterMask(phrase);

  for (let len = phrase.length - MAX_EDITS; len <= phrase.length + MAX_EDITS; len++) {
    const bucket = FUZZY_BY_LENGTH.get(len);
    if (!bucket) continue;
    for (const cand of bucket) {
      // Letters in the phrase that the candidate lacks. Each costs at least one
      // edit, so more than MAX_EDITS of them rules the candidate out without
      // touching the DP table.
      if (popcount(phraseMask & ~cand.mask) > MAX_EDITS) continue;
      const d = editDistance(phrase, cand.spelling, MAX_EDITS);
      if (d > MAX_EDITS) continue;
      const confidence = 1 - d / Math.max(phrase.length, cand.spelling.length);
      if (confidence < FUZZY_THRESHOLD) continue;
      if (!best || confidence > best.confidence) best = { entry: cand.entry, confidence };
    }
  }
  return best;
}

/** Exact, then fuzzy, then phonetic — memoised, with the stopword guard. */
function lookupPhrase(phrase: string): MatchHit | null {
  const cached = memo.get(phrase);
  if (cached !== undefined) return cached;

  let hit: MatchHit | null = null;
  const exact = VARIANT_INDEX.get(phrase);
  if (exact) {
    hit = { entry: exact, confidence: 1, method: 'exact' };
  } else if (!isAllStopwords(phrase)) {
    // Inexact matching is skipped for spans made entirely of English function
    // words. See stopwords.ts — this is what stops "is on" becoming "yoshon".
    const fuzzy = fuzzyLookup(phrase);
    if (fuzzy) {
      hit = { ...fuzzy, method: 'fuzzy' };
    } else {
      const phonetic = phoneticLookup(phrase);
      if (phonetic) hit = { ...phonetic, method: 'phonetic' };
    }
  }

  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(phrase, hit);
  return hit;
}

function phoneticLookup(phrase: string): { entry: TermEntry; confidence: number } | null {
  const key = phoneticKey(phrase);
  if (key.length < MIN_PHONETIC_KEY) return null;
  const entry = PHONETIC_INDEX.get(key);
  if (!entry) return null;
  // Phonetic agreement alone is weaker evidence than a fuzzy string match, so
  // it is scored against the raw spelling similarity rather than asserted at 1.
  const confidence = Math.max(0.7, similarity(phrase, entry.canonical.toLowerCase()));
  return { entry, confidence };
}

/**
 * Normalise a raw utterance.
 *
 * `applyBrands` is separable because brand matching draws on the product
 * database, which the unit tests for the term layer should not need.
 */
export function normalise(raw: string, options: { brands?: boolean } = {}): NormaliseResult {
  const started = performance.now();
  const applyBrands = options.brands !== false;

  const tokens = tokenise(raw);
  const substitutions: Substitution[] = [];

  let i = 0;
  while (i < tokens.length) {
    let matched = false;

    // Longest phrase first, so multi-word terms win over their components.
    const maxSpan = Math.min(MAX_PHRASE_WORDS, tokens.length - i);
    for (let span = maxSpan; span >= 1 && !matched; span--) {
      const slice = tokens.slice(i, i + span);
      const phraseRaw = raw.slice(slice[0].start, slice[span - 1].end);
      const phrase = slice
        .map((t) => t.text)
        .join(' ')
        .toLowerCase();

      const hit = lookupPhrase(phrase);

      if (hit) {
        // An exact hit on the canonical spelling is not a substitution — the
        // caller already said it correctly. Record nothing and move on.
        const alreadyCanonical = phrase === hit.entry.canonical.toLowerCase();
        if (!alreadyCanonical) {
          substitutions.push({
            from: phraseRaw,
            to: matchCase(phraseRaw, hit.entry.canonical),
            start: slice[0].start,
            end: slice[span - 1].end,
            kind: hit.entry.kind,
            method: hit.method,
            confidence: Number(hit.confidence.toFixed(3)),
            gloss: hit.entry.gloss,
          });
        }
        i += span;
        matched = true;
      }
    }

    if (matched) continue;

    // Brand matching is separate: it draws on the product database and only
    // ever fires phonetically, because brand names have no canonical variants.
    if (applyBrands) {
      const maxBrandSpan = Math.min(3, tokens.length - i);
      let brandMatched = false;
      for (let span = maxBrandSpan; span >= 1 && !brandMatched; span--) {
        const slice = tokens.slice(i, i + span);
        const phraseRaw = raw.slice(slice[0].start, slice[span - 1].end);
        if (isAllStopwords(slice.map((t) => t.text).join(' '))) continue;
        const key = phoneticKey(phraseRaw);
        if (key.length < 3) continue;
        const brand = BRAND_INDEX.get(key);
        if (!brand || brand.toLowerCase() === phraseRaw.toLowerCase()) continue;
        substitutions.push({
          from: phraseRaw,
          to: brand,
          start: slice[0].start,
          end: slice[span - 1].end,
          kind: 'brand',
          method: 'phonetic',
          confidence: Number(Math.max(0.7, similarity(phraseRaw.toLowerCase(), brand.toLowerCase())).toFixed(3)),
          gloss: 'brand in our database',
        });
        i += span;
        brandMatched = true;
      }
      if (brandMatched) continue;
    }

    i += 1;
  }

  // Rebuild the string from the substitution offsets, back to front, so earlier
  // offsets stay valid as we splice.
  let normalised = raw;
  for (const sub of [...substitutions].sort((a, b) => b.start - a.start)) {
    normalised = normalised.slice(0, sub.start) + sub.to + normalised.slice(sub.end);
  }

  return {
    raw,
    normalised,
    substitutions,
    durationMs: Number((performance.now() - started).toFixed(2)),
  };
}
