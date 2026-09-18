/**
 * Phonetic index over brand names in the product database.
 *
 * Brands are the other half of the STT problem: `Osem` comes back as "oh some",
 * `Ne'eman` as "name on". Unlike kashrus terms, brands have no canonical variant
 * list to enumerate — a new brand in the data should become matchable without
 * anyone editing a dictionary. So this index is derived from the data itself and
 * matching is purely phonetic.
 *
 * Keys that two different brands share are dropped rather than arbitrated.
 * `Arbel Foods` and `Arbeli Brands` both reduce to RBL, and silently picking one
 * is exactly the guess that BRIEF 2b and eval case 10 exist to prevent — the
 * ambiguity has to reach `lookup_product`, which is equipped to ask.
 */

import productsData from '@data/products.json';
import establishmentsData from '@data/establishments.json';
import { phoneticKey } from './phonetic';

function buildIndex(names: Iterable<string>): Map<string, string> {
  const byKey = new Map<string, Set<string>>();
  for (const name of names) {
    const key = phoneticKey(name);
    if (key.length < 3) continue;
    const bucket = byKey.get(key) ?? new Set<string>();
    bucket.add(name);
    byKey.set(key, bucket);
  }

  const index = new Map<string, string>();
  for (const [key, bucket] of byKey) {
    // Colliding keys are omitted. See the note above — a phonetic collision is
    // information, and resolving it here would destroy it.
    if (bucket.size === 1) index.set(key, [...bucket][0]);
  }
  return index;
}

const brandNames = new Set(productsData.products.map((p) => p.brand));
const establishmentNames = new Set(establishmentsData.establishments.map((e) => e.name));

/** Phonetic key -> brand name, collisions excluded. */
export const BRAND_INDEX: ReadonlyMap<string, string> = buildIndex(brandNames);

/** Phonetic key -> establishment name, collisions excluded. */
export const ESTABLISHMENT_INDEX: ReadonlyMap<string, string> = buildIndex(establishmentNames);

/** Every brand phonetic key, including the colliding ones, for ambiguity checks. */
export const BRAND_KEY_GROUPS: ReadonlyMap<string, readonly string[]> = (() => {
  const byKey = new Map<string, string[]>();
  for (const name of brandNames) {
    const key = phoneticKey(name);
    if (key.length < 3) continue;
    const bucket = byKey.get(key) ?? [];
    bucket.push(name);
    byKey.set(key, bucket);
  }
  return byKey;
})();

export const ALL_BRANDS: readonly string[] = [...brandNames].sort();
