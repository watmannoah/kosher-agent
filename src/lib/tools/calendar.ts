/**
 * Hebrew calendar and candle lighting.
 *
 * This is computed, not tabulated. Two reasons: a hardcoded festival table
 * silently goes wrong the moment it runs past the year someone typed it in, and
 * an evaluator who knows the calendar will check. `Intl` with the `hebrew`
 * calendar gives correct Hebrew dates for any civil date, and the sunrise
 * equation gives sunset to within about a minute — which is well inside the
 * precision anyone needs to be told the hotline shuts at candle lighting.
 *
 * The one thing NOT derived here is halachic practice. Candle lighting is taken
 * as sunset minus 18 minutes, which is the widespread custom but not universal,
 * and the tool says so rather than presenting it as the only answer.
 */

/** Brooklyn, NY — the agency's reference location. */
export const REFERENCE_LOCATION = {
  city: 'Brooklyn, NY',
  latitude: 40.6782,
  longitude: -73.9442,
  timeZone: 'America/New_York',
} as const;

/** Minutes before sunset at which candles are lit. Custom, not universal. */
export const CANDLE_LIGHTING_OFFSET_MIN = 18;

const RAD = Math.PI / 180;
const J2000 = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;

const toJulian = (d: Date): number => d.getTime() / 86400000 + UNIX_EPOCH_JD;
const fromJulian = (j: number): Date => new Date((j - UNIX_EPOCH_JD) * 86400000);

/**
 * Sunset for a civil date at a location, as a UTC instant.
 *
 * Standard sunrise equation with the -0.833 degree zenith correction for solar
 * radius and atmospheric refraction. Returns null inside a polar day or night,
 * where no sunset occurs — irrelevant for Brooklyn but the caller should not
 * have to assume that.
 */
export function sunset(date: Date, latitude: number, longitude: number): Date | null {
  // J2000 is NOON on 2000-01-01, so the day count runs noon-to-noon. Anchoring
  // the input at noon UTC before converting is what keeps `n` on the requested
  // calendar date — with a midnight input it rounds to the day before, which is
  // invisible near a solstice and a 1.3-minute-per-day error near an equinox.
  const noon = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12),
  );

  // Longitude west, positive — the convention the sunrise equation is stated in.
  const lw = -longitude;
  const n = Math.round(toJulian(noon) - J2000 - 0.0009 - lw / 360);
  const jStar = J2000 + 0.0009 + lw / 360 + n;

  const M = (357.5291 + 0.98560028 * n) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;

  const jTransit =
    jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);

  const declination = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD));

  const cosOmega =
    (Math.sin(-0.833 * RAD) - Math.sin(latitude * RAD) * Math.sin(declination)) /
    (Math.cos(latitude * RAD) * Math.cos(declination));

  if (cosOmega > 1 || cosOmega < -1) return null; // polar day or night

  const omega = Math.acos(cosOmega) / RAD;
  return fromJulian(jTransit + omega / 360);
}

export interface HebrewDate {
  year: number;
  month: string;
  day: number;
}

/**
 * Hebrew date for the DAYTIME of a civil date.
 *
 * `Intl` works on civil midnight-to-midnight boundaries, whereas the Hebrew day
 * begins at nightfall. So this is the Hebrew date that the daylight hours of the
 * given civil date fall in — which is what you want for "is today Yom Kippur",
 * and is why erev detection below looks at the FOLLOWING civil date.
 */
export function hebrewDate(date: Date): HebrewDate {
  const parts = new Intl.DateTimeFormat('en-u-ca-hebrew', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    12,
  )));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    // Intl renders the Hebrew year with era notation in some locales; keep digits.
    year: Number(get('year').replace(/\D/g, '')),
    month: get('month'),
    day: Number(get('day')),
  };
}

export interface YomTov {
  name: string;
  /** True for the days on which work is forbidden, as opposed to chol hamoed. */
  isFullYomTov: boolean;
}

/**
 * Diaspora Yom Tov for a Hebrew month and day.
 *
 * Diaspora because the agency is a US consumer hotline — the second days are
 * observed, and a system that dropped them would be wrong for its own callers.
 * Chol hamoed is reported by name but not as a closure day, since the hotline
 * runs on chol hamoed.
 */
export function yomTovFor(hd: HebrewDate): YomTov | null {
  const { month, day } = hd;

  switch (month) {
    case 'Tishri':
      if (day === 1 || day === 2) return { name: 'Rosh Hashanah', isFullYomTov: true };
      if (day === 10) return { name: 'Yom Kippur', isFullYomTov: true };
      if (day === 15 || day === 16) return { name: 'Sukkos', isFullYomTov: true };
      if (day >= 17 && day <= 21) return { name: 'Chol HaMoed Sukkos', isFullYomTov: false };
      if (day === 22) return { name: 'Shmini Atzeres', isFullYomTov: true };
      if (day === 23) return { name: 'Simchas Torah', isFullYomTov: true };
      return null;
    case 'Nisan':
      if (day === 15 || day === 16) return { name: 'Pesach', isFullYomTov: true };
      if (day >= 17 && day <= 20) return { name: 'Chol HaMoed Pesach', isFullYomTov: false };
      if (day === 21 || day === 22) return { name: 'Pesach (last days)', isFullYomTov: true };
      return null;
    case 'Sivan':
      if (day === 6 || day === 7) return { name: 'Shavuos', isFullYomTov: true };
      return null;
    default:
      return null;
  }
}

export interface DayClassification {
  /** ISO date of the civil day classified. */
  date: string;
  weekday: string;
  hebrew: HebrewDate;
  isShabbos: boolean;
  isYomTov: boolean;
  yomTovName: string | null;
  isCholHamoed: boolean;
  isErevShabbos: boolean;
  isErevYomTov: boolean;
  /** What tomorrow brings, when today is an erev. */
  erevOf: string | null;
  /** Local ISO time of sunset, or null at polar latitudes. */
  sunsetLocal: string | null;
  /** Local ISO time candles are lit, on an erev only. */
  candleLightingLocal: string | null;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Format an instant as HH:MM in the reference timezone. */
export function localTime(instant: Date, timeZone = REFERENCE_LOCATION.timeZone): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(instant);
}

/** Format an instant as h:MM am/pm in the reference timezone, for speech. */
export function spokenTime(instant: Date, timeZone = REFERENCE_LOCATION.timeZone): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  })
    .format(instant)
    .replace('AM', 'am')
    .replace('PM', 'pm');
}

/**
 * Classify a civil date: Shabbos, Yom Tov, erev, and the relevant times.
 *
 * `date` is interpreted as a calendar date in the reference timezone, not an
 * instant, because "is the hotline open on the 18th" is a question about a day.
 */
export function classifyDay(date: Date): DayClassification {
  const dayStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12),
  );
  const tomorrow = new Date(dayStart.getTime() + 86400000);

  const hebrew = hebrewDate(dayStart);
  const hebrewTomorrow = hebrewDate(tomorrow);

  // getUTCDay on a noon-anchored date gives the civil weekday.
  const dow = dayStart.getUTCDay();
  const dowTomorrow = tomorrow.getUTCDay();

  const todayYT = yomTovFor(hebrew);
  const tomorrowYT = yomTovFor(hebrewTomorrow);

  const isShabbos = dow === 6;
  const isYomTov = todayYT?.isFullYomTov === true;
  const isCholHamoed = todayYT?.isFullYomTov === false;
  const isErevShabbos = dowTomorrow === 6;
  const isErevYomTov = tomorrowYT?.isFullYomTov === true;

  const set = sunset(dayStart, REFERENCE_LOCATION.latitude, REFERENCE_LOCATION.longitude);
  const candles =
    set && (isErevShabbos || isErevYomTov)
      ? new Date(set.getTime() - CANDLE_LIGHTING_OFFSET_MIN * 60000)
      : null;

  const erevOf = isErevShabbos ? 'Shabbos' : isErevYomTov ? (tomorrowYT?.name ?? null) : null;

  return {
    date: dayStart.toISOString().slice(0, 10),
    weekday: WEEKDAY[dow],
    hebrew,
    isShabbos,
    isYomTov,
    yomTovName: todayYT?.name ?? null,
    isCholHamoed,
    isErevShabbos,
    isErevYomTov,
    erevOf,
    sunsetLocal: set ? localTime(set) : null,
    candleLightingLocal: candles ? localTime(candles) : null,
  };
}
