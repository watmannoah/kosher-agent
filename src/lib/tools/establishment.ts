/**
 * Establishment lookup.
 *
 * Expiry is computed against the real current date rather than stored, so a
 * record cannot drift into claiming to be current. The expired establishment in
 * the dataset is expired because its date is genuinely in the past, not because
 * a flag says so.
 */

import establishmentsData from '@data/establishments.json';
import alertsData from '@data/alerts.json';
import { fail, ok, type ToolResult } from './types';
import { resolveName } from './matching';

type Establishment = (typeof establishmentsData.establishments)[number];
type Alert = (typeof alertsData.alerts)[number];

const ESTABLISHMENTS = establishmentsData.establishments;
const NAMES = ESTABLISHMENTS.map((e) => e.name);
const DATA_NOTICE = establishmentsData._notice;

const MASHGIACH_DESCRIPTIONS: Record<string, string> = {
  temidi: 'mashgiach temidi — a full-time mashgiach present on the premises',
  yotzei_vnichnas:
    "yotzei v'nichnas — a mashgiach who visits periodically rather than being present full time",
};

function alertsFor(e: Establishment): Alert[] {
  return alertsData.alerts.filter((a) => a.establishmentId === e.id);
}

function describe(e: Establishment, now: Date) {
  const activeAlerts = alertsFor(e);

  if (!e.certified) {
    return {
      matched: { id: e.id, name: e.name, city: e.city, state: e.state, type: e.type },
      status: 'not_certified_by_us' as const,
      meaning:
        'We do not certify this establishment. This is NOT a statement that it is not kosher — it ' +
        'may hold certification from another agency. Say that it is not under our hashgacha, and ' +
        'nothing more than that.',
      certification: null,
      activeAlerts,
      dataNotice: DATA_NOTICE,
    };
  }

  const expiry = e.certifiedUntil ? new Date(`${e.certifiedUntil}T23:59:59Z`) : null;
  const isExpired = expiry !== null && expiry.getTime() < now.getTime();
  const daysUntilExpiry = expiry
    ? Math.round((expiry.getTime() - now.getTime()) / 86400000)
    : null;

  if (isExpired) {
    return {
      matched: { id: e.id, name: e.name, city: e.city, state: e.state, type: e.type },
      status: 'certification_expired' as const,
      meaning:
        `Our certification of this establishment EXPIRED on ${e.certifiedUntil} and it is not ` +
        `currently under Kehilla hashgacha. State the expiry plainly and as a past fact. Do not ` +
        `phrase it in any way that could be heard as still current, do not say "was certified ` +
        `until" without saying it is not certified now, and do not speculate about renewal.`,
      certification: {
        expiredOn: e.certifiedUntil,
        daysSinceExpiry: daysUntilExpiry === null ? null : Math.abs(daysUntilExpiry),
        previously: {
          kashrusType: e.kashrusType,
          mashgiachType: e.mashgiachType,
        },
      },
      activeAlerts,
      dataNotice: DATA_NOTICE,
    };
  }

  return {
    matched: { id: e.id, name: e.name, city: e.city, state: e.state, type: e.type },
    status: 'certified' as const,
    meaning: 'Currently under Kehilla hashgacha.',
    certification: {
      address: e.address,
      kashrusType: e.kashrusType,
      certifiedSince: e.certifiedSince,
      certifiedUntil: e.certifiedUntil,
      daysUntilExpiry,
      mashgiachType: e.mashgiachType,
      mashgiachDescription: e.mashgiachType
        ? MASHGIACH_DESCRIPTIONS[e.mashgiachType] ?? e.mashgiachType
        : null,
      pasYisrael: e.pasYisrael,
      bishulYisrael: e.bishulYisrael,
    },
    reportingNote:
      'Report the mashgiach type as a fact. Do not characterise either type as better or more ' +
      'reliable than the other — that is a question for the caller\'s own Rav.',
    activeAlerts,
    alertInstruction:
      activeAlerts.length > 0
        ? 'There is an active alert concerning this establishment. Raise it immediately and ' +
          'unprompted.'
        : null,
    dataNotice: DATA_NOTICE,
  };
}

export interface LookupEstablishmentArgs {
  name?: string;
  city?: string;
  /** Injected by the pipeline so results are reproducible in evals. */
  now?: Date;
}

export function lookupEstablishment(args: LookupEstablishmentArgs): ToolResult {
  const name = (args.name ?? '').trim();
  const city = (args.city ?? '').trim();
  const now = args.now ?? new Date();

  if (!name) {
    return fail(
      'invalid_arguments',
      'No establishment name given. Ask the caller for the name, and the town if they know it.',
    );
  }

  // Narrow by city first when given — two establishments can share a name
  // across towns, and the counterfeit-symbol alert in the data is exactly that.
  const pool = city
    ? ESTABLISHMENTS.filter((e) => e.city.toLowerCase() === city.toLowerCase())
    : ESTABLISHMENTS;
  const poolNames = pool.length > 0 ? pool.map((e) => e.name) : NAMES;

  const match = resolveName(name, poolNames);

  if (match.kind === 'ambiguous') {
    return fail(
      'ambiguous_match',
      `More than one establishment matches "${name}". Ask the caller which — including which town ` +
        `— rather than choosing.`,
      {
        query: args,
        candidates: match.candidates.map((n) => {
          const e = ESTABLISHMENTS.find((x) => x.name === n)!;
          return { name: e.name, city: e.city, state: e.state, type: e.type };
        }),
        dataNotice: DATA_NOTICE,
      },
    );
  }

  if (!match.best) {
    return fail(
      'establishment_not_found',
      `We have no record of "${name}"${city ? ` in ${city}` : ''}. We do not certify it. That is ` +
        `NOT a statement that it is not kosher — it may be certified by another agency. Offer to ` +
        `check a different spelling or town.`,
      {
        query: args,
        status: 'not_in_database',
        meaning:
          'Absence from our database means only that the establishment is not under our ' +
          'hashgacha. Never present it as a kashrus judgement.',
        dataNotice: DATA_NOTICE,
      },
    );
  }

  const found = ESTABLISHMENTS.find((e) => e.name === match.best)!;
  return ok({ query: args, ...describe(found, now) });
}
