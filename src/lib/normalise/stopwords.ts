/**
 * English function words that must never be fuzzy- or phonetically matched.
 *
 * Without this guard the consonant skeleton is too permissive: `is on` reduces
 * to SN, and so does `yoshon` — every "is on the list" in an utterance came back
 * as "yoshon the list". Dropping vowels is what makes the matcher work across
 * transliterations, and it is also what makes short English function words
 * collide with kashrus terms.
 *
 * The guard applies only when EVERY word in a candidate span is a stopword, so
 * real phrases that contain a function word (`the sabbath`, `hex sure`) still
 * match normally.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // articles, determiners
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'any', 'all', 'some', 'no', 'every',
  // pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours',
  // be / have / do / modals
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'done',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  // prepositions, conjunctions
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'about', 'into',
  'over', 'under', 'onto', 'off', 'out', 'up', 'down', 'through', 'between',
  'and', 'or', 'but', 'if', 'then', 'than', 'so', 'because', 'as', 'while',
  // interrogatives, adverbs
  'what', 'when', 'where', 'who', 'whom', 'how', 'why', 'which', 'whether',
  'there', 'here', 'now', 'again', 'still', 'also', 'too', 'only', 'even',
  'just', 'very', 'much', 'more', 'most', 'less', 'back', 'well', 'not',
  // high-frequency verbs and fillers that collide
  'need', 'want', 'tell', 'know', 'get', 'got', 'give', 'take', 'make', 'made',
  'see', 'look', 'think', 'mean', 'say', 'said', 'ask', 'asked', 'call', 'called',
  'one', 'two', 'three', 'first', 'last', 'next', 'other', 'same',
  'please', 'thanks', 'thank', 'hi', 'hello', 'hey', 'ok', 'okay', 'yes', 'yeah',
  'yep', 'nope', 'um', 'uh', 'er', 'like', 'really', 'right', 'sorry',
  'good', 'bad', 'new', 'old', 'big', 'small',
]);

/** True when every word in the phrase is a stopword. */
export function isAllStopwords(phrase: string): boolean {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => STOPWORDS.has(w));
}

/** True when the phrase's first word is a stopword. */
export function startsWithStopword(phrase: string): boolean {
  const first = phrase.toLowerCase().trim().split(/\s+/)[0];
  return Boolean(first) && STOPWORDS.has(first);
}
