/**
 * Phonetic keying and edit distance for kashrus terminology.
 *
 * Standard Soundex is close to useless here: it keeps vowels' positional
 * information and treats `ch` as C+H, so `chalav` and `cholov` — the same word
 * in two transliteration conventions — key differently. What actually varies
 * between Ashkenazi and Sefardi transliteration, and between one STT engine's
 * guess and another's, is almost entirely the vowels. The consonant skeleton is
 * the stable part.
 *
 * So the key here drops vowels entirely, folds the digraphs that transliterate
 * a single Hebrew letter to one symbol, and collapses runs. `Osem` and the STT
 * output `oh some` both reduce to `SM`.
 */

/** Digraphs that render a single Hebrew letter. Order matters — longest first. */
const DIGRAPHS: ReadonlyArray<readonly [string, string]> = [
  // `tch` folds onto the same symbol as `ch`, not its own. English has no ches,
  // so STT reaches for the nearest sound it has: `hashgacha` comes back as
  // "hash gotcha". Giving `tch` its own symbol makes that the one mangling the
  // matcher cannot recover, which defeats the purpose.
  ['tch', 'K'],
  ['sch', 'S'],
  ['ch', 'K'], // ches/chaf — chalav, milchig, hashgacha
  ['kh', 'K'], // same sound, other convention
  ['sh', 'S'], // shin — shailah, mashgiach
  ['tz', 'Z'], // tzadi
  ['ts', 'Z'], // tzadi, other convention
  ['th', 'T'],
  ['ph', 'F'],
  ['ck', 'K'],
  ['qu', 'K'],
];

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/** Single letters folded onto a shared symbol. */
const FOLD: Readonly<Record<string, string>> = {
  c: 'K',
  q: 'K',
  k: 'K',
  g: 'G',
  j: 'Y',
  s: 'S',
  z: 'Z',
  v: 'V',
  w: 'V',
  b: 'B',
  p: 'P',
  f: 'F',
  d: 'D',
  t: 'T',
  m: 'M',
  n: 'N',
  l: 'L',
  r: 'R',
  x: 'X',
};

/**
 * Reduce a word or phrase to its consonant skeleton.
 *
 * `h` is dropped unless it formed a digraph — a bare `h` in transliteration is
 * usually a vowel carrier (`hashgacha`, the `oh` in `oh some`) rather than a
 * consonant, and keeping it splits spellings that should match.
 */
export function phoneticKey(input: string): string {
  let s = input.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return '';

  for (const [digraph, symbol] of DIGRAPHS) {
    s = s.split(digraph).join(symbol);
  }

  let out = '';
  for (const ch of s) {
    if (ch >= 'A' && ch <= 'Z') {
      out += ch; // already-folded digraph symbol
      continue;
    }
    if (VOWELS.has(ch) || ch === 'h') continue;
    out += FOLD[ch] ?? '';
  }

  // Collapse runs: `shabbos` -> SBS, not SBBS.
  return out.replace(/(.)\1+/g, '$1');
}

/**
 * Damerau-Levenshtein distance, capped.
 *
 * Transposition matters more than usual here because transliterated words get
 * their letters swapped constantly (`yisroel`/`yisreol`, `hechsher`/`hecsher`).
 * Bailing out at `max` keeps this cheap enough to run against the whole
 * dictionary inside the 20ms budget.
 */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: bl + 1 }, (_, i) => i);
  let curr: number[] = new Array(bl + 1);

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];

    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1); // transposition
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }

    if (rowMin > max) return max + 1;

    prev2 = prev;
    prev = curr;
    curr = new Array(bl + 1);
  }

  return prev[bl];
}

/**
 * Bitmask of which letters a-z occur in a string.
 *
 * Used as a prefilter before edit distance. A single edit can reconcile at most
 * one letter type that appears in one string and not the other, so if more than
 * `max` letter types are present in the phrase but absent from the candidate,
 * the distance necessarily exceeds `max`. That makes the check sound — it never
 * rejects a real match — and it costs one XOR and a popcount instead of a full
 * DP table.
 */
export function letterMask(s: string): number {
  let mask = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i) | 32; // lowercase
    if (c >= 97 && c <= 122) mask |= 1 << (c - 97);
  }
  return mask;
}

/** Number of set bits. */
export function popcount(n: number): number {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  n = (n + (n >> 4)) & 0x0f0f0f0f;
  return (n * 0x01010101) >> 24;
}

/** Edit distance scaled by length, so short words aren't unfairly matched. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  const d = editDistance(a, b, Math.ceil(longest / 2));
  return 1 - d / longest;
}
