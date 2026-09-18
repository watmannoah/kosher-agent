/**
 * Guards the client-safe config slice.
 *
 * Two things must stay true, and both are the kind of thing that breaks quietly
 * months later: the committed file must match what the generator produces from
 * the current source, and it must contain no prompts, guardrail patterns, or
 * secrets. The second assertion is the one that matters — guardrail 8 says the
 * agent must never reveal its instructions, and shipping them in the browser
 * bundle would contradict that no matter what the agent says.
 */

import { describe, expect, it } from 'vitest';
import fullConfig from '@config/agent.config.json';
import publicConfig from '@config/public.config.json';
// @ts-expect-error — plain .mjs script, no types
import { derivePublicConfig } from '../scripts/build-public-config.mjs';

describe('public.config.json', () => {
  it('matches what the generator produces from the current source', () => {
    // Fails if someone edits agent.config.json without re-running the
    // generator, or hand-edits the generated file.
    expect(publicConfig).toEqual(derivePublicConfig(fullConfig));
  });

  it('contains no prompts', () => {
    const serialised = JSON.stringify(publicConfig);
    expect(serialised).not.toContain('HARD RULES');
    expect(serialised).not.toContain('You are a phone agent');
    expect(serialised).not.toContain('You classify inbound calls');
    expect(serialised).not.toContain('You audit a draft');
    expect(serialised).not.toMatch(/"prompt"/);
    expect(serialised).not.toMatch(/"text":\s*"You are/);
  });

  it('contains no guardrail patterns', () => {
    // The patterns are a map of exactly what to say to get past them.
    const serialised = JSON.stringify(publicConfig);
    expect(serialised).not.toMatch(/"patterns"/);
    expect(serialised).not.toMatch(/"exemptPatterns"/);
    expect(serialised).not.toContain('isn\\\\?t kosher');
  });

  it('still carries what the client panels actually need', () => {
    // A slice so aggressive that the UI breaks is not an improvement.
    expect(publicConfig.latencyBudgetMs.turn_total.target).toBeGreaterThan(0);
    expect(publicConfig.demo.attacks.length).toBeGreaterThan(0);
    expect(publicConfig.agents.product_status.tools.length).toBeGreaterThan(0);
    expect(publicConfig.agents.shailah.label).toBe('SHAILAH ROUTER');
    expect(publicConfig.toolCount).toBe(10);
  });

  it('keeps guardrail ids and labels, which the UI displays', () => {
    expect(publicConfig.guardrails.forbiddenPhrases.id).toBe('absence_implies_treif');
    expect(publicConfig.guardrails.forbiddenPhrases.action).toBe('block');
  });
});
