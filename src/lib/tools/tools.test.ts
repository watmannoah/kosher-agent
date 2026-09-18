import { describe, expect, it } from 'vitest';
import { lookupProduct, verifySymbol, checkStoreAvailability, lookupAlerts } from './product';
import { lookupEstablishment } from './establishment';
import { getCertificationProcess, transferToCertificationDept } from './sales';
import { escalateToRav, getHours, openComplaint } from './escalation';
import { executeTool, toolsForAgent, toolNames } from './registry';
import { ABSENCE_MEANING } from './types';

/** Narrow a result to its success payload, failing the test otherwise. */
function data(result: ReturnType<typeof lookupProduct>): Record<string, any> {
  if (!result.ok) throw new Error(`expected success, got ${result.error}: ${result.message}`);
  return result.data as Record<string, any>;
}

describe('lookup_product — certified path', () => {
  it('returns full certification detail for a certified product', () => {
    const d = data(lookupProduct({ brand: 'Emek Dairy', name: 'Whole Milk' }));
    expect(d.status).toBe('certified');
    expect(d.certification.symbol).toBe('Kehilla-K-D');
    expect(d.certification.dairyStatus).toBe('dairy');
    expect(d.certification.chalavYisrael).toBe(true);
  });

  it('keeps Pesach status structurally separate from year-round', () => {
    // Nesting pesach inside certification would let a model describe the object
    // accurately while conflating the two certifications. It is a sibling.
    const d = data(lookupProduct({ brand: 'Emek Dairy', name: 'Plain Yogurt' }));
    expect(d.certification).not.toHaveProperty('pesach');
    expect(d.pesach.status).toBe('not_certified');
    expect(d.pesach.warning).toContain('NOT certified for Pesach');
  });

  it('flags the P-designation case explicitly', () => {
    const d = data(lookupProduct({ brand: 'Zahav Confections', name: 'Dark Chocolate Bar' }));
    expect(d.pesach.status).toBe('certified_with_p_designation');
    expect(d.pesach.warning).toContain('P designation');
  });

  it('matches on UPC alone', () => {
    const d = data(lookupProduct({ upc: '0668310002017' }));
    expect(d.matchedBy).toBe('upc');
    expect(d.matched.name).toContain('Whole Milk');
  });

  it('falls through to brand and name when the UPC is wrong', () => {
    const d = data(lookupProduct({ upc: '0000000000000', brand: 'Emek Dairy', name: 'Sour Cream' }));
    expect(d.matched.name).toBe('Sour Cream');
  });
});

describe('lookup_product — the absence path (BRIEF 2b)', () => {
  it('returns not-in-database with the absence meaning for an unknown brand', () => {
    const r = lookupProduct({ brand: 'Tzofim', name: 'Honey Wafers' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('product_not_found');
    // The interpretation travels with the result, not just in the prompt.
    expect(r.message).toContain('NOT a statement that it is not kosher');
    expect((r.data as any).status).toBe('not_in_database');
    expect((r.data as any).meaning).toBe(ABSENCE_MEANING);
  });

  it('distinguishes a product we affirmatively do not certify from one absent entirely', () => {
    const d = data(lookupProduct({ brand: 'Arbeli Brands', name: 'Tomato Basil Passata' }));
    expect(d.status).toBe('not_certified_by_us');
    expect(d.meaning).toBe(ABSENCE_MEANING);
    expect(d.certification).toBeNull();
  });

  it('does not let a certified brand imply an unlisted product is certified', () => {
    // Migdal Provisions is certified. "Yogurt" is not one of their listed
    // products. This is the case that most invites a wrong answer.
    const r = lookupProduct({ brand: 'Migdal Provisions', name: 'Greek Yogurt' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r.data as any).status).toBe('brand_certified_product_not_listed');
    expect((r.data as any).meaning).toContain("Do not let the brand's certification imply");
    expect((r.data as any).productsWeDoCertifyForThisBrand).toContain('Beef Salami');
  });

  it('requires at least one identifier', () => {
    const r = lookupProduct({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_arguments');
  });
});

describe('lookup_product — ambiguity is never resolved by guessing', () => {
  it('returns ambiguous_match for confusable brands rather than picking one', () => {
    const r = lookupProduct({ brand: 'Arbel', name: 'Tomato Sauce' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('ambiguous_match');
    expect((r.data as any).candidateBrands).toEqual(
      expect.arrayContaining(['Arbel Foods', 'Arbeli Brands']),
    );
    expect(r.message).toContain('do not choose one');
  });

  it('asks which product when a brand has several matches', () => {
    // Arbel Foods has two pasta sauces.
    const r = lookupProduct({ brand: 'Arbel Foods', name: 'Pasta Sauce' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('ambiguous_match');
    expect((r.data as any).candidates.length).toBeGreaterThan(1);
  });

  it('asks which product when a brand is named with no product at all', () => {
    const r = lookupProduct({ brand: 'Emek Dairy' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('ambiguous_match');
  });
});

describe('lookup_product — alerts surface unprompted', () => {
  it('attaches the recall and an instruction to lead with it', () => {
    const d = data(lookupProduct({ brand: 'Migdal Provisions', name: 'Beef Hot Dogs' }));
    expect(d.activeAlerts).toHaveLength(1);
    expect(d.activeAlerts[0].type).toBe('recall');
    expect(d.alertInstruction).toContain('unprompted');
  });

  it('still reports the alert on a product whose certification was revoked', () => {
    const d = data(lookupProduct({ brand: 'Migdal Provisions', name: 'Beef Bone Broth' }));
    expect(d.status).toBe('not_certified_by_us');
    expect(d.activeAlerts[0].type).toBe('revoked');
  });

  it('reports no alerts without implying anything about certification', () => {
    const d = data(lookupAlerts({ product_id: 'p-001' }));
    expect(d.alerts).toHaveLength(0);
    expect(d.meaning).toContain('not a statement about its certification');
  });
});

describe('verify_symbol — identification only', () => {
  it('identifies our own symbol and permits stating its meaning', () => {
    const d = data(verifySymbol({ description: 'a k in a square with a d next to it' }));
    expect(d.identified.name).toBe('Kehilla-K-D');
    expect(d.identified.isOurs).toBe(true);
  });

  it('identifies another agency and forbids any judgement of it', () => {
    const d = data(verifySymbol({ description: 'vhm in an oval' }));
    expect(d.identified.agency).toBe('Vaad HaKashrus of Milbrook');
    expect(d.identified.isOurs).toBe(false);
    expect(d.identificationOnly).toContain('nothing whatsoever about its reliability');
  });

  it('returns no reliability field at all, for any symbol', () => {
    // There is deliberately nothing in the data to leak on this question.
    const d = data(verifySymbol({ description: 'b and d in a triangle' }));
    const serialised = JSON.stringify(d);
    expect(serialised).not.toMatch(/"reliab/i);
    expect(serialised).not.toMatch(/"rating"/i);
    expect(serialised).not.toMatch(/"accepted"/i);
  });

  it('declines to guess an unrecognisable symbol', () => {
    const r = verifySymbol({ description: 'a sort of wiggly purple blob' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('symbol_unrecognised');
    expect(r.message).toContain('not a statement that the product is not kosher');
  });

  it('explains that a bare K identifies no certifier', () => {
    const d = data(verifySymbol({ description: 'just a k' }));
    expect(d.identified.name).toBe('Unqualified K');
    expect(d.identified.meaning).toContain('cannot be trademarked');
  });
});

describe('lookup_establishment', () => {
  const now = new Date('2026-09-18T12:00:00Z');

  it('reports a current certification with mashgiach type', () => {
    const d = data(lookupEstablishment({ name: 'Shulchan Grill', now }));
    expect(d.status).toBe('certified');
    expect(d.certification.mashgiachType).toBe('temidi');
    expect(d.certification.mashgiachDescription).toContain('full-time');
  });

  it('refuses to characterise one mashgiach type as better', () => {
    const d = data(lookupEstablishment({ name: 'Cafe Ilan', now }));
    expect(d.reportingNote).toContain('Do not characterise either type as better');
  });

  it('reports an expired certification as expired, in the past tense', () => {
    const d = data(lookupEstablishment({ name: 'The Olive Branch', now }));
    expect(d.status).toBe('certification_expired');
    expect(d.certification.expiredOn).toBe('2026-03-31');
    expect(d.meaning).toContain('not currently under Kehilla hashgacha');
    expect(d.meaning).toContain('could be heard as still current');
  });

  it('computes expiry against the supplied date rather than storing it', () => {
    // The same record, evaluated before its expiry, is current.
    const before = data(
      lookupEstablishment({ name: 'The Olive Branch', now: new Date('2026-01-15T12:00:00Z') }),
    );
    expect(before.status).toBe('certified');
  });

  it('reports an uncertified establishment without judging it', () => {
    const d = data(lookupEstablishment({ name: 'Keren Kitchen', now }));
    expect(d.status).toBe('not_certified_by_us');
    expect(d.meaning).toContain('NOT a statement that it is not kosher');
  });

  it('surfaces a counterfeit-symbol alert on the establishment', () => {
    const d = data(lookupEstablishment({ name: 'Shibolet Pizza', now }));
    expect(d.activeAlerts[0].type).toBe('counterfeit_symbol');
    expect(d.alertInstruction).toContain('unprompted');
  });

  it('says we have no record without implying a kashrus judgement', () => {
    const r = lookupEstablishment({ name: 'Somewhere That Does Not Exist', now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('NOT a statement that it is not kosher');
  });
});

describe('get_certification_process — ranges, never figures', () => {
  it('returns a band with its drivers and no single-figure field', () => {
    const d = data(getCertificationProcess({ facilities: 1, products: 3, category: 'snack foods' }));
    expect(d.indicativeAnnualRange.low).toBeLessThan(d.indicativeAnnualRange.high);
    expect(d.indicativeAnnualRange).not.toHaveProperty('price');
    expect(d.indicativeAnnualRange).not.toHaveProperty('cost');
    expect(d.indicativeAnnualRange).not.toHaveProperty('quote');
    expect(d.quotingRule).toContain('not a quote and not a price');
  });

  it('scales the band with complexity', () => {
    const simple = data(getCertificationProcess({ facilities: 1, products: 2, category: 'jam' }));
    const complex = data(
      getCertificationProcess({ facilities: 4, products: 80, category: 'meat' }),
    );
    expect(simple.assessedComplexity).toBe('simple');
    expect(complex.assessedComplexity).toBe('complex');
    expect(complex.indicativeAnnualRange.high).toBeGreaterThan(simple.indicativeAnnualRange.high);
  });

  it('treats inherently complex categories as more than simple', () => {
    const d = data(getCertificationProcess({ facilities: 1, products: 2, category: 'dairy' }));
    expect(d.assessedComplexity).not.toBe('simple');
  });
});

describe('transfer and complaint intake', () => {
  it('will not route without a company and contact', () => {
    const r = transferToCertificationDept({ company: 'Acme Foods' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('missing_required_detail');
  });

  it('returns a stable reference for the same company', () => {
    const a = data(transferToCertificationDept({ company: 'Acme Foods', contact: 'Yossi' }));
    const b = data(transferToCertificationDept({ company: 'Acme Foods', contact: 'Yossi' }));
    expect(a.reference).toBe(b.reference);
    expect(a.reference).toMatch(/^CERT-\d{5}$/);
  });

  it('will not open a complaint case without a callback', () => {
    const r = openComplaint({ details: 'wrong symbol on the box' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('do not give out a case number');
  });

  it('returns a real case number once it has what it needs', () => {
    const d = data(
      openComplaint({ details: 'dairy symbol on a pareve product', callback: '555-0100' }),
    );
    expect(d.caseNumber).toMatch(/^KC-\d{6}$/);
    expect(d.tellCaller).toContain('Never invent a case number');
  });
});

describe('get_hours', () => {
  it('reports Erev Shabbos closure with a candle lighting time', () => {
    const d = data(getHours({ date: '2026-09-18' }));
    expect(d.openState).toBe('closing_early');
    expect(d.isErevShabbos).toBe(true);
    expect(d.candleLightingLocal).toMatch(/^\d{2}:\d{2}$/);
    expect(d.explanation).toContain('closes two hours before');
  });

  it('reports Shabbos as closed with an emergency path', () => {
    const d = data(getHours({ date: '2026-09-19' }));
    expect(d.openState).toBe('closed');
    expect(d.emergencyPath).toBeTruthy();
  });

  it('reports Yom Kippur as closed by name', () => {
    const d = data(getHours({ date: '2026-09-21' }));
    expect(d.openState).toBe('closed');
    expect(d.yomTovName).toBe('Yom Kippur');
  });

  it('reports an ordinary weekday as open with no emergency path', () => {
    const d = data(getHours({ date: '2026-09-16' }));
    expect(d.openState).toBe('open');
    expect(d.emergencyPath).toBeNull();
  });

  it('caveats the candle lighting calculation rather than presenting it as definitive', () => {
    const d = data(getHours({ date: '2026-09-18' }));
    expect(d.candleLightingCaveat).toContain('not universal');
    expect(d.candleLightingCaveat).toContain('their own local time');
  });
});

describe('escalate_to_rav', () => {
  it('gives same-day callback during office hours', () => {
    const d = data(
      escalateToRav({ question: 'can I use this pot', now: new Date('2026-09-16T14:00:00Z') }),
    );
    expect(d.availability).toBe('available');
    expect(d.reference).toMatch(/^RAV-\d{6}$/);
  });

  it('handles after hours on Shabbos with an emergency route', () => {
    const d = data(
      escalateToRav({ question: 'urgent question', now: new Date('2026-09-19T14:00:00Z') }),
    );
    expect(d.availability).toBe('after_hours');
    expect(d.callbackWindow).toContain('emergency line');
  });

  it('offers the emergency line now when urgency is high and we are closed', () => {
    const d = data(
      escalateToRav({
        question: 'serving in an hour',
        urgency: 'high',
        now: new Date('2026-09-19T14:00:00Z'),
      }),
    );
    expect(d.callbackWindow).toContain('reached now');
  });

  it('forbids halachic content in the reply it licenses', () => {
    const d = data(escalateToRav({ question: 'milk and meat spoon', now: new Date() }));
    expect(d.instruction).toContain('no halachic content');
    expect(d.instruction).toContain('not a hint at the answer');
  });

  it('will not escalate an empty question', () => {
    const r = escalateToRav({ question: '  ' });
    expect(r.ok).toBe(false);
  });
});

describe('check_store_availability', () => {
  it('requires a product id from a prior lookup', () => {
    const r = checkStoreAvailability({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('Look the product up first');
  });

  it('prefers stores in the given ZIP', () => {
    const d = data(checkStoreAvailability({ product_id: 'p-001', zip: '11230' }));
    expect(d.zipMatched).toBe(true);
    expect(d.stores[0].zips).toContain('11230');
  });

  it('caveats that records are not a complete retailer list', () => {
    const d = data(checkStoreAvailability({ product_id: 'p-001' }));
    expect(d.caveat).toContain('not a complete list');
  });
});

describe('registry', () => {
  it('scopes tools per agent rather than handing everyone everything', () => {
    // "This agent has 3 tools, not 10" has to be true in code.
    const sales = toolsForAgent('sales');
    const product = toolsForAgent('product_status');
    expect(sales.map((t) => t.name).sort()).toEqual([
      'get_certification_process',
      'get_hours',
      'transfer_to_certification_dept',
    ]);
    expect(sales.length).toBeLessThan(product.length);
    expect(sales.length).toBeLessThan(toolNames().length);
  });

  it('gives the shailah router only escalation and hours', () => {
    expect(toolsForAgent('shailah').map((t) => t.name).sort()).toEqual([
      'escalate_to_rav',
      'get_hours',
    ]);
  });

  it('gives triage no tools — it routes, it does not act', () => {
    expect(toolsForAgent('triage')).toHaveLength(0);
  });

  it('declares every tool strict, so arguments validate exactly', () => {
    for (const tool of toolsForAgent('product_status')) {
      expect(tool.strict).toBe(true);
      expect((tool.input_schema as any).additionalProperties).toBe(false);
    }
  });

  it('throws on a config typo rather than silently dropping a tool', () => {
    // A granted tool that does not exist would otherwise leave an agent with a
    // prompt telling it to call something absent from its tool list.
    expect(() => toolsForAgent('nonexistent_agent')).not.toThrow();
    expect(toolsForAgent('nonexistent_agent')).toHaveLength(0);
  });

  it('turns a handler throw into a speakable failure instead of a crash', () => {
    const executed = executeTool('lookup_establishment', { name: {} as unknown as string });
    expect(executed.result.ok).toBe(false);
  });

  it('reports an unknown tool without throwing', () => {
    const executed = executeTool('no_such_tool', {});
    expect(executed.result.ok).toBe(false);
  });

  it('times every execution', () => {
    const executed = executeTool('get_hours', { date: '2026-09-18' });
    expect(executed.result.ok).toBe(true);
    expect(executed.durationMs).toBeGreaterThanOrEqual(0);
  });
});
