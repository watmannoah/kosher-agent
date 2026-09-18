/**
 * The live agent: microphone, text input, transcript.
 *
 * Text and voice get equal billing, not because it is tidy but because the
 * recipient opens this from an email on a phone, where speech recognition may
 * simply not exist. The capability line says what this browser actually has
 * rather than guessing from a user-agent table.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionState } from '@/lib/client/useSession';
import {
  detectCapability,
  startAnalyser,
  startRecognition,
  unlockAudio,
  type AnalyserHandle,
  type RecognitionHandle,
  type SpeechCapability,
} from '@/lib/client/voice';
import { Waveform } from './Waveform';
import { Label, Pill, SyntheticNotice } from './ui';

export function LiveAgent({
  session,
  onSend,
  onStopSpeaking,
  onReset,
}: {
  session: SessionState;
  onSend: (text: string, options?: { sttFinaliseMs?: number }) => void;
  onStopSpeaking: () => void;
  onReset: () => void;
}) {
  /**
   * Capability is resolved lazily on first render rather than in an effect.
   *
   * `detectCapability` reads `window`, so the initialiser guards for the server
   * pass. Doing it in an effect would work but triggers an immediate second
   * render, and the capability line is visible on first paint.
   */
  const [capability] = useState<SpeechCapability | null>(() =>
    typeof window === 'undefined' ? null : detectCapability(),
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  /**
   * State, not a ref: the analyser arrives asynchronously after getUserMedia
   * resolves, and the waveform has to re-render when it does. Held in a ref it
   * reads as null forever on the render path and the bars never move.
   */
  const [analyser, setAnalyser] = useState<AnalyserHandle | null>(null);

  const recognitionRef = useRef<RecognitionHandle | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [session.turns]);

  // Release the microphone if the component goes away mid-call.
  useEffect(
    () => () => {
      recognitionRef.current?.abort();
    },
    [],
  );

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setAnalyser((current) => {
      current?.stop();
      return null;
    });
    setListening(false);
    setInterim('');
  }, []);

  const startListening = useCallback(() => {
    // Synchronous, inside the tap, or iOS will not permit audio later.
    unlockAudio();
    setMicError(null);

    // Speaking while the agent speaks is a barge-in, which is how people
    // actually interrupt on a phone call.
    if (session.speaking) onStopSpeaking();

    const handle = startRecognition({
      onStart: () => setListening(true),
      onInterim: (text) => setInterim(text),
      onFinal: (text, finaliseMs) => {
        setInterim('');
        stopListening();
        if (text) onSend(text, { sttFinaliseMs: finaliseMs });
      },
      onError: (message) => {
        setMicError(message);
        stopListening();
      },
      onEnd: () => setListening(false),
    });

    if (!handle) return;
    recognitionRef.current = handle;

    // Non-essential; failure leaves a flat idle line rather than breaking the mic.
    void startAnalyser().then(setAnalyser);
  }, [onSend, onStopSpeaking, session.speaking, stopListening]);

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    const text = typed.trim();
    if (!text || session.busy) return;
    setTyped('');
    onSend(text);
  };

  const micAvailable = capability?.recognition ?? false;

  return (
    <div className="min-w-0">
      <div>
        <SyntheticNotice />

        {/* Transcript */}
        <div
          ref={transcriptRef}
          className="thin-scroll mt-4 h-[300px] overflow-y-auto border border-hairline bg-slate-panel p-4 sm:h-[360px]"
        >
          {session.turns.length === 0 && (
            <div className="text-sm leading-relaxed text-faint">
              <p>Ask about a product, a restaurant, an unfamiliar symbol on a package, or how to
                get certified. Try:</p>
              <ul className="mt-3 space-y-1.5 text-muted">
                <li>&ldquo;Is Emek Dairy whole milk under your hashgacha?&rdquo;</li>
                <li>&ldquo;Is Tzofim Honey Wafers kosher?&rdquo;</li>
                <li>&ldquo;Is Emek Dairy yogurt good for Pesach?&rdquo;</li>
                <li>&ldquo;There&rsquo;s a K in a square with a D on this box — whose is that?&rdquo;</li>
              </ul>
            </div>
          )}

          <div className="space-y-4">
            {session.turns.map((turn) => (
              <div key={turn.id} className="space-y-2">
                <div className="flex gap-2">
                  <Label>Caller</Label>
                  {turn.interrupted && <Pill tone="warn">interrupted</Pill>}
                </div>
                <p className="text-sm text-bone">{turn.callerRaw}</p>

                {turn.callerNormalised !== turn.callerRaw && (
                  <p className="telemetry text-[11px] text-info">
                    normalised → {turn.callerNormalised}
                  </p>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Label>{turn.agentLabel ?? 'Agent'}</Label>
                  {turn.status === 'running' && !turn.finalText && (
                    <Pill tone="live">working</Pill>
                  )}
                  {turn.speakMode === 'after_verify' && !turn.finalText && turn.streamingText && (
                    <Pill tone="warn" title="Audio is held until the verifier clears this draft">
                      unverified draft
                    </Pill>
                  )}
                  {turn.fallback && <Pill tone="warn">safe deflection</Pill>}
                </div>

                <p className="text-sm leading-relaxed text-bone">
                  {turn.finalText ?? turn.streamingText}
                  {!turn.finalText && turn.streamingText && (
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-live align-middle" />
                  )}
                </p>

                {turn.error && (
                  <p className="telemetry text-[11px] text-danger">{turn.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="mt-4 space-y-3">
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              disabled={!micAvailable || session.busy}
              aria-pressed={listening}
              className={`flex shrink-0 items-center gap-2 border px-4 py-3 text-sm font-medium transition-colors ${
                listening
                  ? 'border-live bg-live-dim text-live'
                  : 'border-hairline-bright bg-slate-raised text-bone hover:border-live hover:text-live'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  listening ? 'animate-pulse bg-live' : 'bg-faint'
                }`}
              />
              {listening ? 'Listening' : 'Speak'}
            </button>

            <form onSubmit={submitTyped} className="flex min-w-0 flex-1 gap-2">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="…or type your question"
                disabled={session.busy}
                maxLength={800}
                // 16px minimum or iOS Safari zooms the page on focus.
                className="min-w-0 flex-1 border border-hairline bg-slate-panel px-3 py-3 text-base text-bone outline-none placeholder:text-faint focus:border-hairline-bright disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={session.busy || !typed.trim()}
                className="shrink-0 border border-hairline-bright bg-slate-raised px-4 py-3 text-sm font-medium text-bone transition-colors hover:border-live hover:text-live disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </form>
          </div>

          <Waveform analyser={analyser} active={listening} />

          {interim && (
            <p className="telemetry text-[11px] text-faint">
              hearing: <span className="text-muted">{interim}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {session.speaking && (
              <button
                type="button"
                onClick={onStopSpeaking}
                className="telemetry text-[11px] text-warn underline decoration-dotted"
              >
                stop speaking (barge-in)
              </button>
            )}
            {session.turns.length > 0 && (
              <button
                type="button"
                onClick={onReset}
                className="telemetry text-[11px] text-faint underline decoration-dotted hover:text-muted"
              >
                new call
              </button>
            )}
            <span className="telemetry text-[11px] text-faint">
              session {session.turns.length} turn{session.turns.length === 1 ? '' : 's'} ·{' '}
              {session.sessionCostUsd > 0 ? `$${session.sessionCostUsd.toFixed(5)}` : '$0'}
            </span>
          </div>

          {micError && <p className="telemetry text-[11px] text-danger">{micError}</p>}

          {capability && (
            <p className="telemetry text-[11px] leading-relaxed text-faint">{capability.summary}</p>
          )}

          {session.notice && (
            <p
              className={`telemetry border px-3 py-2 text-[11px] leading-relaxed ${
                session.notice.kind === 'degraded'
                  ? 'border-warn/40 text-warn'
                  : 'border-danger/40 text-danger'
              }`}
            >
              {session.notice.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
