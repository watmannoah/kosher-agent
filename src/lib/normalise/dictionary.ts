/**
 * Kashrus term dictionary.
 *
 * Variants are the actual shapes browser STT produces for these words, not
 * hypothetical misspellings. `webkitSpeechRecognition` has no kashrus
 * vocabulary, so it reaches for the nearest English it knows: `hashgacha`
 * becomes "hash gotcha", `hechsher` becomes "heck share". Those are the strings
 * that arrive, so those are the strings listed.
 *
 * `canonical` is what the models see. `kind` drives the UI colour coding.
 */

export type TermKind = 'term' | 'variant' | 'brand';

export interface TermEntry {
  canonical: string;
  variants: string[];
  kind: TermKind;
  /** Shown in the normalisation panel so the reader learns the word. */
  gloss: string;
}

export const TERMS: readonly TermEntry[] = [
  {
    canonical: 'hashgacha',
    kind: 'term',
    gloss: 'kosher supervision / certification',
    variants: [
      'hash gotcha',
      'hashgotcha',
      'hashgocho',
      'hash gocho',
      'hashgachah',
      'hasgacha',
      'hashgaha',
      'hash gacha',
      'hash ganja',
      'hash garcia',
      'hashgocha',
      'hasgocho',
    ],
  },
  {
    canonical: 'hechsher',
    kind: 'term',
    gloss: 'a certification / the symbol denoting it',
    variants: [
      'heck share',
      'heckshare',
      'hex sure',
      'hexsure',
      'hecksher',
      'hechshare',
      'hekhsher',
      'heksher',
      'hech sher',
      'heck sure',
      'hey chsher',
      'exure',
    ],
  },
  {
    canonical: 'hechsherim',
    kind: 'term',
    gloss: 'plural of hechsher',
    variants: ['heck sharem', 'hechsherim', 'heksherim', 'hex sharim', 'hechshayrim'],
  },
  {
    canonical: 'chalav yisrael',
    kind: 'term',
    gloss: 'milk supervised from milking',
    variants: [
      'holov yisroel',
      'chalev yisroel',
      'cholov yisroel',
      'cholov yisrael',
      'chalav yisroel',
      'halav yisrael',
      'kholov yisroel',
      'chollov yisroel',
      'hollow yisroel',
      'hollow israel',
      'chalov yisroel',
      'cholev yisroel',
      'chalav israel',
      'cholov yisborach',
    ],
  },
  {
    canonical: 'pas yisrael',
    kind: 'term',
    gloss: 'bread baked with Jewish involvement',
    variants: [
      'pas yisroel',
      'pass yisroel',
      'pas israel',
      'pass israel',
      'posse yisroel',
      'pas yisroeil',
      'pat yisrael',
      'pas yisruel',
    ],
  },
  {
    canonical: 'bishul yisrael',
    kind: 'term',
    gloss: 'food cooked with Jewish involvement',
    variants: [
      'bishul yisroel',
      'bishul israel',
      'bishel yisroel',
      'bee shul yisroel',
      'bishool yisroel',
      'bishul yisruel',
    ],
  },
  {
    canonical: 'shailah',
    kind: 'term',
    gloss: 'a halachic question for a Rav',
    variants: [
      'shy la',
      'shyla',
      'sheila',
      'shaila',
      'shaylah',
      'sheilah',
      'shy lah',
      'she la',
      'shailoh',
      'shyloh',
    ],
  },
  {
    canonical: 'shailos',
    kind: 'term',
    gloss: 'plural of shailah',
    variants: ['shylos', 'sheilos', 'shailot', 'shy los', 'sheilot'],
  },
  {
    canonical: 'milchig',
    kind: 'term',
    gloss: 'dairy',
    variants: ['milk hig', 'milkhig', 'milchik', 'milchiq', 'mil chig', 'milky g', 'milchug'],
  },
  {
    canonical: 'fleishig',
    kind: 'term',
    gloss: 'meat',
    variants: [
      'flay shig',
      'flayshig',
      'fleishik',
      'flei shig',
      'flesh ig',
      'flay shik',
      'fleishug',
      'flashing',
    ],
  },
  {
    canonical: 'pareve',
    kind: 'term',
    gloss: 'neither dairy nor meat',
    variants: ['par eve', 'pareven', 'parev', 'parve', 'par ve', 'pah reve', 'parave', 'pair eve'],
  },
  {
    canonical: 'yoshon',
    kind: 'term',
    gloss: 'grain from before last Pesach',
    variants: ['yoshen', 'yashan', 'yoshan', 'yo shon', 'yushon', 'joshon', 'yoshin'],
  },
  {
    canonical: 'chodosh',
    kind: 'term',
    gloss: 'new-crop grain — the opposite of yoshon',
    variants: ['chodesh', 'khodosh', 'chadash', 'ho dosh', 'chodush'],
  },
  {
    canonical: 'mashgiach',
    kind: 'term',
    gloss: 'kashrus supervisor',
    variants: [
      'mash giach',
      'mashgiah',
      'mashgiack',
      'mash gee ach',
      'mashgiyach',
      'mash key ach',
      'mashkiach',
      'mask jack',
    ],
  },
  {
    canonical: 'mashgiach temidi',
    kind: 'term',
    gloss: 'full-time supervisor on premises',
    variants: [
      'mashgiach temeedee',
      'mash giach temidi',
      'mashgiach tmidi',
      'mashgiach temedi',
      'mashgiach to meedee',
    ],
  },
  {
    canonical: "yotzei v'nichnas",
    kind: 'term',
    gloss: 'supervisor who visits periodically',
    variants: [
      'yotzei venichnas',
      'yotze vnichnas',
      'yoytzei venichnas',
      'yotzei ve nichnas',
      'yoitzei vnichnas',
      'yotzeh vnichnas',
    ],
  },
  {
    canonical: 'treif',
    kind: 'term',
    gloss: 'not kosher',
    variants: ['treyf', 'trayf', 'traif', 'tref', 'try f', 'trafe'],
  },
  {
    canonical: 'kashrus',
    kind: 'term',
    gloss: 'the field of kosher law and practice',
    variants: ['kashrut', 'kashruth', 'cashrus', 'kash rus', 'kosher us', 'kashrous'],
  },
  {
    canonical: 'kasher',
    kind: 'term',
    gloss: 'to make a vessel kosher',
    variants: ['kosher it', 'kashering', 'kashered', 'cashier it', 'kasher it'],
  },
  {
    canonical: 'tevilas keilim',
    kind: 'term',
    gloss: 'immersing new vessels',
    variants: [
      'tevilas kelim',
      'tvilas keilim',
      'toivel it',
      'tevilat kelim',
      'te vilas keilim',
      'devilas keilim',
    ],
  },
  {
    canonical: 'kitniyos',
    kind: 'term',
    gloss: 'legumes, avoided by some on Pesach',
    variants: ['kitniyot', 'kitnios', 'kit nee yos', 'kitniyois', 'kitnyos'],
  },
  {
    canonical: 'chametz',
    kind: 'term',
    gloss: 'leaven, forbidden on Pesach',
    variants: ['chometz', 'khametz', 'homitz', 'hometz', 'cha metz', 'chumitz', 'chomitz'],
  },
  {
    canonical: 'mevushal',
    kind: 'term',
    gloss: 'wine or juice that has been heated',
    variants: ['mevushol', 'mevooshal', 'me vushal', 'mvushal', 'mevushall'],
  },
  {
    canonical: 'shechita',
    kind: 'term',
    gloss: 'kosher slaughter',
    variants: ['shchita', 'shechitah', 'shehita', 'she cheetah', 'shchitah', 'she cheater'],
  },
  {
    canonical: 'glatt',
    kind: 'term',
    gloss: 'a stricter standard for meat',
    variants: ['glat', 'glott', 'gluten free glatt', 'glaat'],
  },

  // --- Ashkenazi / Sefardi variants collapsed onto one canonical form -------
  {
    canonical: 'Shabbos',
    kind: 'variant',
    gloss: 'the Sabbath',
    variants: ['shabbat', 'shabat', 'shabos', 'shabbas', 'shabbus', 'shabbes', 'the sabbath'],
  },
  {
    canonical: 'Erev Shabbos',
    kind: 'variant',
    gloss: 'Friday, before the Sabbath',
    variants: [
      'erev shabbat',
      'erev shabbos',
      'air ev shabbos',
      'erev shabat',
      'erav shabbos',
      'friday before shabbos',
    ],
  },
  {
    canonical: 'Pesach',
    kind: 'variant',
    gloss: 'Passover',
    variants: ['passover', 'peisach', 'pesah', 'paysach', 'pay sach', 'pesac', 'pessach'],
  },
  {
    canonical: 'Sukkos',
    kind: 'variant',
    gloss: 'the festival of booths',
    variants: ['sukkot', 'succos', 'sukot', 'sukkoth', 'sukos', 'tabernacles'],
  },
  {
    canonical: 'Shavuos',
    kind: 'variant',
    gloss: 'the festival of weeks',
    variants: ['shavuot', 'shavuos', 'shvuos', 'shavuoth', 'shavuois'],
  },
  {
    canonical: 'Yom Tov',
    kind: 'variant',
    gloss: 'a festival day',
    variants: ['yom tov', 'yontif', 'yom toiv', 'yontiff', 'yomtov', 'yum tov'],
  },
  {
    canonical: 'Rosh Hashanah',
    kind: 'variant',
    gloss: 'the new year',
    variants: ['rosh hashana', 'rosh hashono', 'rosh ha shana', 'roshashana', 'rosh hashonah'],
  },
  {
    canonical: 'Yom Kippur',
    kind: 'variant',
    gloss: 'the day of atonement',
    variants: ['yom kipur', 'yom kippor', 'yonkipper', 'yom kipper', 'yoim kippur'],
  },
  {
    canonical: 'Rav',
    kind: 'variant',
    gloss: 'rabbi / halachic authority',
    variants: ['rov', 'rabbi on call', 'the rav', 'rabbonim', 'rabbanim'],
  },
];

/** Exact-match index: variant (lowercased) -> entry. Built once at module load. */
export const VARIANT_INDEX: ReadonlyMap<string, TermEntry> = (() => {
  const m = new Map<string, TermEntry>();
  for (const entry of TERMS) {
    m.set(entry.canonical.toLowerCase(), entry);
    for (const v of entry.variants) m.set(v.toLowerCase(), entry);
  }
  return m;
})();

/** Longest phrase in the dictionary, in words — bounds the n-gram window. */
export const MAX_PHRASE_WORDS = (() => {
  let max = 1;
  for (const key of VARIANT_INDEX.keys()) {
    const n = key.split(/\s+/).length;
    if (n > max) max = n;
  }
  return max;
})();
