/**
 * Sales-side tools.
 *
 * `get_certification_process` returns bands with their drivers attached and no
 * single-figure field anywhere — see the note in data/certification.json. An
 * agent under pressure to "just give me a number" has no number available to
 * give, which is a stronger control than a prompt instruction competing with a
 * caller's insistence.
 */

import certificationData from '@data/certification.json';
import { fail, ok, type ToolResult } from './types';

type Complexity = 'simple' | 'moderate' | 'complex';

export interface CertificationProcessArgs {
  facilities?: number | string;
  products?: number | string;
  category?: string;
}

/**
 * Bucket an enquiry by complexity.
 *
 * Deliberately coarse. The point is to place the enquiry in a band wide enough
 * that it cannot be mistaken for a quote, then hand it to the department.
 */
function assessComplexity(facilities: number, products: number, category: string): Complexity {
  const cat = category.toLowerCase();
  const inherentlyComplex = /meat|poultry|slaughter|shechita|dairy|cheese|catering|restaurant|bakery/.test(
    cat,
  );

  if (facilities >= 3 || products >= 50) return 'complex';
  if (inherentlyComplex && (facilities >= 2 || products >= 10)) return 'complex';
  if (facilities >= 2 || products >= 12 || inherentlyComplex) return 'moderate';
  return 'simple';
}

export function getCertificationProcess(args: CertificationProcessArgs): ToolResult {
  const facilities = Number(args.facilities ?? 1) || 1;
  const products = Number(args.products ?? 1) || 1;
  const category = String(args.category ?? '').trim();

  const complexity = assessComplexity(facilities, products, category);
  const band = certificationData.annualRangeUsd[complexity];

  return ok({
    query: { facilities, products, category: category || null },
    assessedComplexity: complexity,
    process: certificationData.process.steps,
    timeline: {
      weeks: certificationData.process.timelineWeeks[complexity],
      drivers: certificationData.process.timelineDrivers,
    },
    // A range with its drivers, never a figure. There is deliberately no
    // single-number field on this object.
    indicativeAnnualRange: {
      currency: 'USD',
      low: band.low,
      high: band.high,
      describes: band.describes,
      drivers: certificationData.costDrivers,
    },
    quotingRule:
      'This is an indicative RANGE for scoping a conversation, not a quote and not a price. ' +
      'Give it as a range, name what drives it, and route to the certification department for ' +
      'real numbers. Never state a single figure, never present the low end as "the cost", and ' +
      'do not produce a narrower number if the caller pushes — including if they say they only ' +
      'need a ballpark for their boss.',
    nextStep:
      'Capture company name and a contact, then call transfer_to_certification_dept.',
    faq: certificationData.faq,
    dataNotice: certificationData._notice,
  });
}

// ---------------------------------------------------------------------------

export interface TransferArgs {
  company?: string;
  contact?: string;
  notes?: string;
}

/** Deterministic reference from the company name, so evals can assert on it. */
function referenceFor(company: string): string {
  let hash = 0;
  for (let i = 0; i < company.length; i++) {
    hash = (hash * 31 + company.charCodeAt(i)) % 100000;
  }
  return `CERT-${String(hash).padStart(5, '0')}`;
}

export function transferToCertificationDept(args: TransferArgs): ToolResult {
  const company = (args.company ?? '').trim();
  const contact = (args.contact ?? '').trim();

  if (!company || !contact) {
    return fail(
      'missing_required_detail',
      `Cannot route this without ${!company ? 'the company name' : ''}${!company && !contact ? ' and ' : ''}${!contact ? 'a contact name or number' : ''}. Ask for it before transferring.`,
      { have: { company: company || null, contact: contact || null } },
    );
  }

  return ok({
    routed: true,
    reference: referenceFor(company),
    company,
    contact,
    notes: args.notes?.trim() || null,
    department: certificationData.departmentContact,
    tellCaller:
      `Give the caller the reference and the callback window of ` +
      `${certificationData.departmentContact.callbackWindow}. Use the reference this tool ` +
      `returned — do not invent one.`,
  });
}
