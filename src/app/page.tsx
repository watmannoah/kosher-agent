/**
 * The page.
 *
 * Section order follows the brief: live agent first, because the recipient's
 * first instinct is to find out whether this is real, and the fastest way to
 * answer that is to let them talk to it. Everything below exists to corroborate
 * what they just saw.
 */

'use client';

import { useCallback } from 'react';
import { useSession } from '@/lib/client/useSession';
import { LiveAgent } from '@/components/LiveAgent';
import { TraceRail } from '@/components/TraceRail';
import { LatencyStrip } from '@/components/LatencyStrip';
import { BreakIt } from '@/components/BreakIt';
import { EvalRunner } from '@/components/EvalRunner';
import { NormalisePanel } from '@/components/NormalisePanel';
import { RecordedCalls } from '@/components/RecordedCalls';
import { Architecture } from '@/components/Architecture';
import { Section } from '@/components/ui';

export default function Page() {
  const { state, send, reset, stopSpeaking, exportTelemetry } = useSession();
  const latest = state.turns.at(-1) ?? null;

  const handleSend = useCallback(
    (text: string, options?: { sttFinaliseMs?: number }) => {
      void send(text, options);
    },
    [send],
  );

  // Attacks are muted: the point of that panel is reading what got blocked,
  // and six refusals read aloud in a row would be unusable.
  const handleAttack = useCallback(
    (text: string, attackId: string) => {
      void send(text, { attackId, mute: true });
    },
    [send],
  );

  return (
    <>
      <header className="px-5 py-8 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="telemetry text-[11px] uppercase tracking-[0.18em] text-faint">
            Kehilla Kosher Certification — consumer hotline
          </p>
          <h1 className="mt-2 max-w-3xl text-base leading-relaxed text-bone sm:text-lg">
            A multi-agent voice system that will not tell you a product is certified unless it
            just looked it up.
          </h1>
        </div>
      </header>

      <Section
        index="01"
        id="live"
        title="Live agent"
        blurb="Real model calls, real tool lookups, real guardrails. Speak or type — text works in every browser, the microphone does not."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <LiveAgent
            session={state}
            onSend={handleSend}
            onStopSpeaking={stopSpeaking}
            onReset={reset}
          />
          <TraceRail turn={latest} />
        </div>
        <div className="mt-6">
          <LatencyStrip turn={latest} />
        </div>
      </Section>

      <Section
        index="02"
        id="break-it"
        title="Break it"
        blurb="Real attacks against the live system. Nothing here is scripted — each button sends the same request the microphone would, and the result is whatever actually came back."
      >
        <BreakIt onAttack={handleAttack} turns={state.turns} busy={state.busy} />
      </Section>

      <Section
        index="03"
        id="evals"
        title="Run the evals"
        blurb="Twelve cases against the real pipeline, scored by deterministic assertions and an LLM judge that must both agree. The timestamp comes from the server when you click."
      >
        <EvalRunner />
      </Section>

      <Section
        index="04"
        id="normalisation"
        title="Term normalisation"
        blurb="Hebrew and Yiddish terminology destroys off-the-shelf speech recognition. This layer sits between the transcript and the models."
      >
        <NormalisePanel turn={latest} />
      </Section>

      <Section
        index="05"
        id="recorded"
        title="Recorded calls"
        blurb="Four sessions captured from real runs, replayed at their original pacing with annotations that fire from the events that actually occurred."
      >
        <RecordedCalls />
      </Section>

      <Section
        index="06"
        id="architecture"
        title="Architecture and cost"
        blurb="Why supervisor-and-specialists rather than one prompt with ten tools, and what each turn actually costs."
      >
        <Architecture />
      </Section>

      <footer className="border-t border-hairline px-5 py-8 sm:px-8">
        <div className="mx-auto max-w-6xl space-y-3">
          <p className="telemetry text-[11px] leading-relaxed text-warn">
            Kehilla Kosher Certification is a fictional agency. Every product, brand,
            establishment, symbol, alert and status in this system is synthetic demonstration
            data. It is not a kosher certification reference and must not be relied on for any
            purpose.
          </p>
          <p className="telemetry text-[10px] leading-relaxed text-faint">
            No product, symbol, or trade dress of any real certifying body is used or
            represented. Halachic questions are never answered by this system — they are routed
            to a Rav, which is the correct handling for a shailah.
          </p>
          <button
            type="button"
            onClick={exportTelemetry}
            disabled={state.turns.length === 0}
            className="telemetry inline-block text-[10px] text-info underline decoration-dotted disabled:text-faint disabled:no-underline"
          >
            {state.turns.length === 0
              ? 'telemetry download — make a call first'
              : `download this session's telemetry as JSON (${state.turns.length} turn${state.turns.length === 1 ? '' : 's'})`}
          </button>
        </div>
      </footer>
    </>
  );
}
