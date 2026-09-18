/**
 * Product-side tools.
 *
 * Note the shape of what `lookup_product` returns: `pesach` is a sibling of
 * `certification`, never a field inside it. Year-round and Pesach certification
 * are separate certifications (BRIEF 2e / guardrail 5), and nesting one inside
 * the other invites exactly the conflation the hotline spends its spring
 * correcting. Keeping them structurally apart means a model reading the result
 * has to mention them separately to describe it accurately.
 */

import productsData from '@data/products.json';
import alertsData from '@data/alerts.json';
import storesData from '@data/stores.json';
import symbolsData from '@data/symbols.json';
import { ABSENCE_MEANING, fail, ok, type ToolResult } from './types';
import { resolveName, resolveProductName } from './matching';
import { similarity } from '../normalise/phonetic';

type Product = (typeof productsData.products)[number];
type Alert = (typeof alertsData.alerts)[number];

const PRODUCTS = productsData.products;
const ALERTS = alertsData.alerts;
const DATA_NOTICE = productsData._notice;

const BRANDS = [...new Set(PRODUCTS.map((p) => p.brand))];

function alertsFor(ids: readonly string[]): Alert[] {
  return ids.map((id) => ALERTS.find((a) => a.id === id)).filter((a): a is Alert => Boolean(a));
}

/** The caller-facing view of a product. */
function describe(product: Product) {
  const activeAlerts = alertsFor(product.alerts);

  if (!product.certified) {
    return {
      matched: { id: product.id, brand: product.brand, name: product.name, upc: product.upc },
      status: 'not_certified_by_us' as const,
      meaning: ABSENCE_MEANING,
      certification: null,
      // Still reported, because a revoked or withdrawn certification is
      // precisely the case where the caller most needs to hear the alert.
      activeAlerts,
      dataNotice: DATA_NOTICE,
    };
  }

  return {
    matched: { id: product.id, brand: product.brand, name: product.name, upc: product.upc },
    status: 'certified' as const,
    meaning:
      'This product is under Kehilla certification for year-round use. Pesach status is a ' +
      'SEPARATE certification, reported separately below — year-round certification says nothing ' +
      'about Pesach.',
    certification: {
      symbol: product.symbol,
      dairyStatus: product.dairyStatus,
      chalavYisrael: product.chalavYisrael,
      pasYisrael: product.pasYisrael,
      yoshon: product.yoshon,
      certifiedSince: product.certifiedSince,
    },
    pesach: {
      year: productsData._pesachYear,
      status: product.pesach,
      note: product.pesachNote,
      warning:
        product.pesach === 'not_certified'
          ? 'NOT certified for Pesach. Must be stated explicitly and not left to inference.'
          : product.pesach === 'certified_with_p_designation'
            ? 'Pesach-certified ONLY in packaging bearing the P designation. The same product ' +
              'without the P is year-round only. State this distinction explicitly.'
            : 'Pesach-certified for the year shown.',
    },
    activeAlerts,
    alertInstruction:
      activeAlerts.length > 0
        ? 'There is an active alert on this product. Raise it immediately and unprompted, before ' +
          'anything else, even though the caller did not ask about it.'
        : null,
    dataNotice: DATA_NOTICE,
  };
}

export interface LookupProductArgs {
  brand?: string;
  name?: string;
  upc?: string;
}

export function lookupProduct(args: LookupProductArgs): ToolResult {
  const { brand = '', name = '', upc = '' } = args;

  if (!brand.trim() && !name.trim() && !upc.trim()) {
    return fail(
      'invalid_arguments',
      'No brand, product name, or UPC was given. Ask the caller what is on the package.',
    );
  }

  // A UPC is unambiguous when it hits, so it short-circuits everything else.
  if (upc.trim()) {
    const digits = upc.replace(/\D/g, '');
    const byUpc = PRODUCTS.find((p) => p.upc.replace(/\D/g, '') === digits);
    if (byUpc) return ok({ query: args, matchedBy: 'upc', ...describe(byUpc) });
    // Fall through — a wrong UPC should not stop a brand/name lookup.
  }

  // --- Brand ---------------------------------------------------------------
  const brandMatch = brand.trim() ? resolveName(brand, BRANDS) : null;

  if (brandMatch?.kind === 'ambiguous') {
    return fail(
      'ambiguous_match',
      `More than one brand we certify sounds like "${brand}". Ask the caller which one is on the ` +
        `package — do not choose one. Candidates: ${brandMatch.candidates.join(', ')}.`,
      { query: args, candidateBrands: brandMatch.candidates, dataNotice: DATA_NOTICE },
    );
  }

  // No brand named, or a brand we hold nothing for. Try the whole catalogue on
  // name alone before concluding we have nothing.
  if (!brandMatch || brandMatch.kind === 'none') {
    if (name.trim()) {
      const acrossAll = resolveProductName(name, PRODUCTS);
      if (acrossAll.kind === 'ambiguous') {
        return fail(
          'ambiguous_match',
          `Several products match "${name}". Ask which brand the caller has in front of them.`,
          {
            query: args,
            candidates: acrossAll.candidates.map((p) => ({ brand: p.brand, name: p.name })),
            dataNotice: DATA_NOTICE,
          },
        );
      }
      if (acrossAll.best) {
        return ok({ query: args, matchedBy: 'name_only', ...describe(acrossAll.best) });
      }
    }

    return fail(
      'product_not_found',
      `Nothing matching "${[brand, name].filter(Boolean).join(' ')}" is in our database. ` +
        ABSENCE_MEANING,
      {
        query: args,
        status: 'not_in_database',
        meaning: ABSENCE_MEANING,
        nextStep:
          'Offer to identify the symbol on the package using verify_symbol if the caller can ' +
          'describe it.',
        dataNotice: DATA_NOTICE,
      },
    );
  }

  const resolvedBrand = brandMatch.best!;
  const catalogue = PRODUCTS.filter((p) => p.brand === resolvedBrand);

  // --- Product within the brand -------------------------------------------
  const productMatch = resolveProductName(name, catalogue);

  if (productMatch.kind === 'ambiguous') {
    return fail(
      'ambiguous_match',
      `${resolvedBrand} has more than one product matching that. Ask the caller which one — do ` +
        `not choose.`,
      {
        query: args,
        resolvedBrand,
        candidates: productMatch.candidates.map((p) => ({ name: p.name, upc: p.upc })),
        dataNotice: DATA_NOTICE,
      },
    );
  }

  if (!productMatch.best) {
    // The brand is known but this product is not listed under it. Distinct from
    // an unknown brand, and a genuinely common call: a certified brand with one
    // uncertified line is exactly what confuses people.
    const brandIsCertified = catalogue.some((p) => p.certified);
    return fail(
      'product_not_found',
      `We do certify ${resolvedBrand}, but "${name}" is not one of the products listed under ` +
        `that certification. ${ABSENCE_MEANING}`,
      {
        query: args,
        resolvedBrand,
        status: 'brand_certified_product_not_listed',
        brandIsCertified,
        meaning:
          `Some ${resolvedBrand} products are under our certification, but this one is not among ` +
          `them. Do not let the brand's certification imply this product's. ${ABSENCE_MEANING}`,
        productsWeDoCertifyForThisBrand: catalogue
          .filter((p) => p.certified)
          .map((p) => p.name),
        dataNotice: DATA_NOTICE,
      },
    );
  }

  return ok({
    query: args,
    matchedBy: brandMatch.kind === 'exact' ? 'brand_exact' : 'brand_fuzzy',
    ...describe(productMatch.best),
  });
}

// ---------------------------------------------------------------------------

export interface VerifySymbolArgs {
  description?: string;
}

/**
 * Identify a symbol from a spoken description.
 *
 * Returns no reliability, rating, or acceptability field — and symbols.json
 * holds none either, so there is nothing here to leak even under pressure. The
 * result carries an explicit instruction saying so, because "identify but do
 * not judge" is a distinction a model under caller pressure can otherwise blur.
 */
export function verifySymbol(args: VerifySymbolArgs): ToolResult {
  const description = (args.description ?? '').trim();
  if (!description) {
    return fail(
      'invalid_arguments',
      'No description given. Ask the caller to describe the symbol — the letters, and any shape ' +
        'around them.',
    );
  }

  const q = description.toLowerCase();

  const scored = symbolsData.symbols
    .map((sym) => {
      let score = 0;
      let via = '';
      for (const d of sym.descriptors) {
        // Substring containment is strong evidence for a spoken description,
        // and a longer contained descriptor is a more specific reading of it.
        const s = q.includes(d) || d.includes(q) ? 0.85 + 0.14 * (Math.min(d.length, q.length) / Math.max(d.length, q.length)) : similarity(q, d);
        if (s > score) {
          score = s;
          via = d;
        }
      }
      return { sym, score, via };
    })
    .sort((a, b) => b.score - a.score);

  const leader = scored[0];

  if (!leader || leader.score < 0.55) {
    return fail(
      'symbol_unrecognised',
      `We cannot identify a symbol from that description. Say so plainly — an unidentified symbol ` +
        `is not a statement that the product is not kosher. Ask for the letters and the shape ` +
        `around them, and offer to have someone look at a photo.`,
      {
        query: description,
        identificationInstruction:
          'Do not guess a symbol. Do not comment on whether an unidentified symbol is acceptable.',
        dataNotice: symbolsData._notice,
      },
    );
  }

  // A candidate whose matched descriptor is contained in the leader's is a
  // less specific reading of the same description, not a competing one:
  // "k in a square with a d" refines "k in a square" rather than rivalling it.
  // Without this, every K-D description ties with plain K and comes back
  // ambiguous.
  const near = scored
    .filter((s) => leader.score - s.score <= 0.08)
    .filter((s) => s === leader || !(leader.via.includes(s.via) && leader.via !== s.via));

  if (near.length > 1) {
    return fail(
      'ambiguous_match',
      'That description fits more than one symbol. Ask the caller for the exact letters and the ' +
        'shape around them.',
      {
        query: description,
        candidates: near.map((s) => ({ name: s.sym.name, mark: s.sym.mark })),
        dataNotice: symbolsData._notice,
      },
    );
  }

  const { sym } = leader;
  return ok({
    query: description,
    identified: {
      name: sym.name,
      mark: sym.mark,
      agency: sym.agency,
      isOurs: sym.isOurs,
      meaning: sym.meaning,
    },
    identificationOnly:
      'This is an identification, not an endorsement. ' +
      (sym.isOurs
        ? 'This is our own symbol, so its meaning may be stated fully.'
        : 'This symbol belongs to another agency. State what it is and whose it is, and say ' +
          'nothing whatsoever about its reliability, standards, or acceptability — in either ' +
          'direction. A question about another agency\'s standards goes to the caller\'s own Rav.'),
    dataNotice: symbolsData._notice,
  });
}

// ---------------------------------------------------------------------------

export interface StoreAvailabilityArgs {
  product_id?: string;
  zip?: string;
}

export function checkStoreAvailability(args: StoreAvailabilityArgs): ToolResult {
  const productId = (args.product_id ?? '').trim();
  const zip = (args.zip ?? '').trim();

  if (!productId) {
    return fail(
      'invalid_arguments',
      'No product id. Look the product up first — availability is only meaningful for a product ' +
        'we have actually identified.',
    );
  }

  const product = PRODUCTS.find((p) => p.id === productId);
  if (!product) {
    return fail('product_not_found', `No product with id ${productId}.`);
  }

  const stocking = storesData.stores.filter((s) => s.stocks.includes(productId));
  const inZip = zip ? stocking.filter((s) => s.zips.includes(zip)) : stocking;
  const matched = inZip.length > 0 ? inZip : stocking;

  if (matched.length === 0) {
    return fail(
      'no_stores_found',
      `We have no distribution record for ${product.brand} ${product.name}. Our records cover ` +
        `where it has been reported stocked, not everywhere it is sold — say that rather than ` +
        `implying it is unavailable.`,
      { query: args, dataNotice: storesData._notice },
    );
  }

  return ok({
    query: args,
    product: { id: product.id, brand: product.brand, name: product.name },
    zipMatched: zip ? inZip.length > 0 : null,
    stores: matched.map((s) => ({
      name: s.name,
      city: s.city,
      state: s.state,
      zips: s.zips,
    })),
    caveat:
      'Distribution records only. Stock is not guaranteed and this is not a complete list of ' +
      'retailers.',
    dataNotice: storesData._notice,
  });
}

// ---------------------------------------------------------------------------

export interface LookupAlertsArgs {
  product_id?: string;
  since?: string;
}

export function lookupAlerts(args: LookupAlertsArgs): ToolResult {
  const productId = (args.product_id ?? '').trim();
  const since = (args.since ?? '').trim();

  let matched: Alert[] = [...ALERTS];

  if (productId) {
    matched = matched.filter((a) => a.productId === productId || a.establishmentId === productId);
  }

  if (since) {
    const cutoff = Date.parse(since);
    if (!Number.isNaN(cutoff)) {
      matched = matched.filter((a) => Date.parse(a.issued) >= cutoff);
    }
  }

  matched.sort((a, b) => b.issued.localeCompare(a.issued));

  if (matched.length === 0) {
    return ok({
      query: args,
      alerts: [],
      meaning:
        productId
          ? 'No active alert on record for that item. This is not a statement about its ' +
            'certification status — look that up separately.'
          : 'No active alerts matching that filter.',
      dataNotice: alertsData._notice,
    });
  }

  return ok({
    query: args,
    alerts: matched,
    alertInstruction:
      'Surface high-severity alerts immediately and unprompted, before anything else, even if ' +
      'the caller did not ask about them.',
    dataNotice: alertsData._notice,
  });
}
