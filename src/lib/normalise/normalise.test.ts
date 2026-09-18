import { describe, expect, it } from 'vitest';
import { normalise } from './index';
import { editDistance, phoneticKey } from './phonetic';

/** Convenience: just the normalised string. */
const n = (s: string) => normalise(s).normalised;

describe('phoneticKey', () => {
  it('collapses transliteration variants of the same word', () => {
    // The whole reason this exists: these are one word in Hebrew.
    expect(phoneticKey('chalav')).toBe(phoneticKey('cholov'));
    expect(phoneticKey('chalav')).toBe(phoneticKey('kholov'));
    expect(phoneticKey('yisrael')).toBe(phoneticKey('yisroel'));
  });

  it('survives STT splitting a word into English words', () => {
    expect(phoneticKey('Osem')).toBe(phoneticKey('oh some'));
    expect(phoneticKey('hashgacha')).toBe(phoneticKey('hash gotcha'));
  });

  it('keeps genuinely different words apart', () => {
    expect(phoneticKey('milchig')).not.toBe(phoneticKey('fleishig'));
    expect(phoneticKey('pareve')).not.toBe(phoneticKey('treif'));
  });

  it('folds digraphs to a single symbol', () => {
    expect(phoneticKey('shabbos')).toBe('SBS');
    expect(phoneticKey('tzimmes')).toBe('ZMS');
  });
});

describe('editDistance', () => {
  it('counts a transposition as one edit, not two', () => {
    expect(editDistance('yisroel', 'yisreol')).toBe(1);
  });

  it('bails out past the cap instead of computing the true distance', () => {
    expect(editDistance('a'.repeat(40), 'b'.repeat(40), 3)).toBeGreaterThan(3);
  });
});

describe('normalise — the terms from the brief', () => {
  // Every mapping BRIEF 2e names explicitly.
  const cases: ReadonlyArray<[string, string]> = [
    ['hash gotcha', 'hashgacha'],
    ['hashgocho', 'hashgacha'],
    ['heck share', 'hechsher'],
    ['hex sure', 'hechsher'],
    ['holov yisroel', 'chalav yisrael'],
    ['chalev yisroel', 'chalav yisrael'],
    ['shy la', 'shailah'],
    ['pas yisroel', 'pas yisrael'],
    ['milk hig', 'milchig'],
    ['flay shig', 'fleishig'],
    ['par eve', 'pareve'],
    ['yoshen', 'yoshon'],
    ['mash giach', 'mashgiach'],
    ['bishul yisroel', 'bishul yisrael'],
    ['treyf', 'treif'],
  ];

  for (const [raw, expected] of cases) {
    it(`${raw} -> ${expected}`, () => {
      expect(n(raw).toLowerCase()).toContain(expected);
    });
  }
});

describe('normalise — Ashkenazi/Sefardi variants collapse', () => {
  it('collapses Shabbos and Shabbat onto one form', () => {
    expect(n('shabbat')).toBe('Shabbos');
  });

  it('collapses Pesach, Peisach and Passover', () => {
    expect(n('passover')).toBe('Pesach');
    expect(n('peisach')).toBe('Pesach');
  });

  it('collapses Sukkos and Sukkot', () => {
    expect(n('sukkot')).toBe('Sukkos');
  });
});

describe('normalise — in real sentences', () => {
  it('handles a heavily mangled utterance end to end', () => {
    const r = normalise(
      'is the milk hig one holov yisroel or do i need a heck share for par eve',
    );
    expect(r.normalised).toContain('milchig');
    expect(r.normalised).toContain('chalav yisrael');
    expect(r.normalised).toContain('hechsher');
    expect(r.normalised).toContain('pareve');
    expect(r.substitutions).toHaveLength(4);
  });

  it('prefers the longer phrase over its component words', () => {
    const r = normalise('cholov yisroel');
    // One two-word substitution, not two one-word ones.
    expect(r.substitutions).toHaveLength(1);
    expect(r.substitutions[0].from).toBe('cholov yisroel');
    expect(r.substitutions[0].to).toBe('chalav yisrael');
  });

  it('records offsets that actually index the raw string', () => {
    const raw = 'i need a heck share';
    const r = normalise(raw);
    const sub = r.substitutions[0];
    expect(raw.slice(sub.start, sub.end)).toBe(sub.from);
  });

  it('leaves already-correct terminology alone', () => {
    const r = normalise('is this pareve or milchig');
    expect(r.substitutions).toHaveLength(0);
    expect(r.normalised).toBe('is this pareve or milchig');
  });

  it('leaves ordinary English alone', () => {
    const raw = 'can you tell me if this product is on the list please';
    const r = normalise(raw);
    expect(r.normalised).toBe(raw);
    expect(r.substitutions).toHaveLength(0);
  });

  it('preserves capitalisation style', () => {
    expect(n('Hash gotcha')).toBe('Hashgacha');
  });

  it('stays inside the 20ms budget on a realistic utterance, cold', () => {
    // Deliberately novel tokens so the shared memo cannot be carrying this;
    // a warm-cache number would not tell us anything about the budget.
    const utterance =
      'hello i wanted to check whether the zorbex quillam brand pretzels are ' +
      'pas yisroel and also if the milk hig version is holov yisroel because ' +
      'my daughter asked me and i could not remember what the heck share said';
    const r = normalise(utterance);
    expect(r.raw.length).toBeGreaterThan(150);
    expect(r.durationMs).toBeLessThan(20);
  });

  it('degrades acceptably on a pathologically long input', () => {
    // Far longer than any single STT utterance. Not in the 20ms budget, but it
    // should not fall off a cliff either.
    const long = 'is the milk hig one holov yisroel and is it pas yisroel '.repeat(12);
    const r = normalise(long);
    expect(r.durationMs).toBeLessThan(50);
  });
});

describe('normalise — brand matching', () => {
  it('recovers a brand from its phonetic mangling', () => {
    const r = normalise('do you certify name on bakery challah');
    const brand = r.substitutions.find((s) => s.kind === 'brand');
    expect(brand?.to).toBe("Ne'eman Bakery");
  });

  it('does not resolve a brand whose phonetics collide with another', () => {
    // Arbel Foods and Arbeli Brands share a consonant skeleton. Picking one
    // here would hide the ambiguity from lookup_product, which is the component
    // that should be asking the caller which they meant.
    const r = normalise('arbel');
    expect(r.substitutions.filter((s) => s.kind === 'brand')).toHaveLength(0);
  });

  it('can be switched off for term-only normalisation', () => {
    const r = normalise('name on bakery', { brands: false });
    expect(r.substitutions.filter((s) => s.kind === 'brand')).toHaveLength(0);
  });
});
