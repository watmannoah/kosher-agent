import { describe, expect, it } from 'vitest';
import {
  REFERENCE_LOCATION,
  classifyDay,
  hebrewDate,
  localTime,
  sunset,
  yomTovFor,
} from './calendar';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('sunset', () => {
  // Published sunset times for New York City, cross-checked at both solstices
  // and both equinoxes — the four points where an error in the solar
  // calculation shows up most clearly. Anything outside a few minutes means the
  // implementation is wrong rather than imprecise.
  const cases: ReadonlyArray<[string, string]> = [
    ['2026-06-21', '20:31'], // summer solstice
    ['2026-12-21', '16:32'], // winter solstice
    ['2026-03-20', '19:08'], // March equinox
    ['2026-09-18', '19:02'], // near the September equinox
  ];

  for (const [date, expected] of cases) {
    it(`${date} in Brooklyn is about ${expected} local`, () => {
      const s = sunset(d(date), REFERENCE_LOCATION.latitude, REFERENCE_LOCATION.longitude);
      expect(s).not.toBeNull();

      const [eh, em] = expected.split(':').map(Number);
      const [ah, am] = localTime(s!).split(':').map(Number);
      const diff = Math.abs(eh * 60 + em - (ah * 60 + am));
      expect(diff).toBeLessThanOrEqual(3);
    });
  }

  it('returns null in polar night rather than a nonsense time', () => {
    // Longyearbyen in December: the sun does not set because it never rises.
    expect(sunset(d('2026-12-21'), 78.22, 15.63)).toBeNull();
  });
});

describe('hebrewDate', () => {
  it('gives the Hebrew date for the daytime of a civil date', () => {
    expect(hebrewDate(d('2026-09-18'))).toEqual({ year: 5787, month: 'Tishri', day: 7 });
  });

  it('finds Rosh Hashanah 5787', () => {
    expect(hebrewDate(d('2026-09-12'))).toEqual({ year: 5787, month: 'Tishri', day: 1 });
  });
});

describe('yomTovFor — diaspora', () => {
  it('observes both days of Rosh Hashanah', () => {
    expect(yomTovFor({ year: 5787, month: 'Tishri', day: 1 })?.name).toBe('Rosh Hashanah');
    expect(yomTovFor({ year: 5787, month: 'Tishri', day: 2 })?.name).toBe('Rosh Hashanah');
  });

  it('observes the second day of Yom Tov, as the diaspora does', () => {
    // A system built for Israel would return null for 16 Tishri and be wrong
    // for every caller this hotline actually has.
    expect(yomTovFor({ year: 5787, month: 'Tishri', day: 16 })?.isFullYomTov).toBe(true);
    expect(yomTovFor({ year: 5787, month: 'Nisan', day: 16 })?.isFullYomTov).toBe(true);
    expect(yomTovFor({ year: 5787, month: 'Sivan', day: 7 })?.isFullYomTov).toBe(true);
  });

  it('marks chol hamoed as not a full Yom Tov', () => {
    const ch = yomTovFor({ year: 5787, month: 'Tishri', day: 18 });
    expect(ch?.name).toContain('Chol HaMoed');
    expect(ch?.isFullYomTov).toBe(false);
  });

  it('returns nothing for an ordinary day', () => {
    expect(yomTovFor({ year: 5787, month: 'Cheshvan', day: 12 })).toBeNull();
  });
});

describe('classifyDay', () => {
  it('classifies a Friday as Erev Shabbos with a candle lighting time', () => {
    const c = classifyDay(d('2026-09-18'));
    expect(c.weekday).toBe('Friday');
    expect(c.isErevShabbos).toBe(true);
    expect(c.isShabbos).toBe(false);
    expect(c.erevOf).toBe('Shabbos');
    expect(c.candleLightingLocal).toMatch(/^\d{2}:\d{2}$/);
  });

  it('puts candle lighting 18 minutes before sunset', () => {
    const c = classifyDay(d('2026-09-18'));
    const [sh, sm] = c.sunsetLocal!.split(':').map(Number);
    const [ch, cm] = c.candleLightingLocal!.split(':').map(Number);
    expect(sh * 60 + sm - (ch * 60 + cm)).toBe(18);
  });

  it('classifies Saturday as Shabbos', () => {
    const c = classifyDay(d('2026-09-19'));
    expect(c.isShabbos).toBe(true);
    expect(c.isErevShabbos).toBe(false);
  });

  it('classifies Yom Kippur 5787 correctly', () => {
    // Monday 21 September 2026 = 10 Tishri 5787.
    const c = classifyDay(d('2026-09-21'));
    expect(c.isYomTov).toBe(true);
    expect(c.yomTovName).toBe('Yom Kippur');
    expect(c.weekday).toBe('Monday');
  });

  it('classifies the day before Yom Kippur as an erev', () => {
    const c = classifyDay(d('2026-09-20'));
    expect(c.isErevYomTov).toBe(true);
    expect(c.erevOf).toBe('Yom Kippur');
    expect(c.candleLightingLocal).not.toBeNull();
  });

  it('gives no candle lighting time on an ordinary weekday', () => {
    const c = classifyDay(d('2026-09-16')); // Wednesday
    expect(c.isErevShabbos).toBe(false);
    expect(c.isErevYomTov).toBe(false);
    expect(c.candleLightingLocal).toBeNull();
  });

  it('handles a Yom Tov that falls on Shabbos', () => {
    // 15 Tishri 5787 = Saturday 26 September 2026.
    const c = classifyDay(d('2026-09-26'));
    expect(c.isShabbos).toBe(true);
    expect(c.isYomTov).toBe(true);
    expect(c.yomTovName).toBe('Sukkos');
  });
});
