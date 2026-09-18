/**
 * Recorded calls.
 *
 * Replays captured event streams at their real pacing, using the `atMs`
 * arrival times recorded during capture — so a slow turn replays slowly. The
 * trace rail is driven by the same `applyEvent` reducer the live agent uses, so
 * a replay and a live call render through identical code.
 *
 * Two things this panel is explicit about rather than quiet about: the audio is
 * browser speech synthesis over a captured transcript, not a recording of a
 * microphone; and when nothing has been captured yet it says so instead of
 * showing invented data.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import recorded from '@data/recorded-sessions.json';
import type { TurnEvent } from '@/lib/agents/protocol';
import { applyEvent, emptyTurn, type TurnView } from '@/lib/client/types';
import { cancelSpeech, speak, unlockAudio } from '@/lib/client/voice';
import { TraceRail } from './TraceRail';
import { Label, Pill } from './ui';

interface Session {
  id: string;
  title: string;
  subtitle: string;
  why: string;
  capturedAt: string;
  events: Array<TurnEvent & { atMs: number }>;
  annotations: Array<{ index: number; text: string }>;
}

const SESSIONS = (recorded.sessions ?? []) as unknown as Session[];

export function RecordedCalls() {
  const [activeId, setActiveId] = useState<string | null>(SESSIONS[0]?.id ?? null);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [turn, setTurn] = useState<TurnView | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [withAudio, setWithAudio] = useState(false);

  const session = SESSIONS.find((s) => s.id === activeId) ?? null;
  const finished = session ? cursor >= session.events.length : false;

  const reset = useCallback(() => {
    cancelSpeech();
    setPlaying(false);
    setCursor(0);
    setNotes([]);
    setTurn(null);
  }, []);

  /**
   * Playback.
   *
   * The effect only schedules; every state update happens inside the timer
   * callback. Applying the event synchronously in the effect body works but
   * cascades a render per event, and React's lint rules are right to object —
   * with one effect per cursor value that is a render for every frame of the
   * replay.
   *
   * The delay is the real gap between this event's captured arrival and the
   * previous one, so a turn that genuinely took 1.8s replays taking 1.8s.
   * Clamped at both ends: a floor keeps single-token text frames watchable, and
   * a ceiling stops a long pause looking like a hang.
   */
  useEffect(() => {
    if (!playing || !session || finished) return;

    const event = session.events[cursor];
    const previousAt = cursor > 0 ? session.events[cursor - 1].atMs : 0;
    const delay = cursor === 0 ? 0 : Math.min(1800, Math.max(50, event.atMs - previousAt));

    const timer = setTimeout(() => {
      setTurn((prev) => applyEvent(prev ?? emptyTurn(1, ''), event));

      const forHere = session.annotations.filter((a) => a.index === cursor);
      if (forHere.length > 0) setNotes((prev) => [...prev, ...forHere.map((a) => a.text)]);

      if (withAudio && event.t === 'final') speak(event.text);

      setCursor((c) => c + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [playing, cursor, session, withAudio, finished]);

  if (SESSIONS.length === 0) {
    return (
      <div className="border border-hairline bg-slate-panel p-4">
        <Label>Not captured yet</Label>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          These are captured by running the four scenarios against the live deployment and
          committing the resulting traces, so a replay is a real run rather than a mock-up. Until
          that has been done this panel shows nothing — it will not show invented data in place of
          a real capture.
        </p>
        <p className="telemetry mt-3 text-[10px] leading-relaxed text-faint">
          npm run capture -- --url &lt;deployed-url&gt; --passcode &lt;passcode&gt;
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          In the meantime the live agent above takes typed input, which covers the same ground for
          anyone who would rather not use a microphone.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SESSIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              if (s.id === activeId) return;
              reset();
              setActiveId(s.id);
            }}
            className={`border px-3 py-2 text-left transition-colors ${
              activeId === s.id
                ? 'border-live bg-live-dim/30'
                : 'border-hairline bg-slate-panel hover:border-hairline-bright'
            }`}
          >
            <span className="block text-[13px] text-bone">{s.title}</span>
            <span className="telemetry block text-[10px] text-faint">{s.subtitle}</span>
          </button>
        ))}
      </div>

      {session && (
        <>
          <p className="max-w-3xl text-sm leading-relaxed text-muted">{session.why}</p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                // Inside the gesture, or iOS refuses audio for the session.
                if (withAudio) unlockAudio();
                if (finished) reset();
                setPlaying((p) => !p);
              }}
              className="border border-hairline-bright bg-slate-raised px-4 py-2 text-sm font-medium text-bone transition-colors hover:border-live hover:text-live"
            >
              {playing ? 'Pause' : finished ? 'Play again' : cursor === 0 ? 'Play' : 'Resume'}
            </button>

            <button
              type="button"
              onClick={reset}
              className="telemetry text-[11px] text-faint underline decoration-dotted hover:text-muted"
            >
              restart
            </button>

            <label className="telemetry flex items-center gap-2 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={withAudio}
                onChange={(e) => {
                  setWithAudio(e.target.checked);
                  if (!e.target.checked) cancelSpeech();
                }}
                className="accent-live"
              />
              speak the replies
            </label>

            <span className="telemetry text-[10px] text-faint">
              {cursor}/{session.events.length} events · captured{' '}
              {new Date(session.capturedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
            </span>
          </div>

          <div className="h-0.5 w-full bg-hairline">
            <div
              className="h-full bg-live transition-all"
              style={{ width: `${(cursor / session.events.length) * 100}%` }}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="min-w-0 space-y-3">
              <div className="min-h-[200px] border border-hairline bg-slate-panel p-4">
                {turn ? (
                  <>
                    <Label>Caller</Label>
                    <p className="mt-1 text-sm text-bone">{turn.callerRaw}</p>
                    {turn.callerNormalised !== turn.callerRaw && (
                      <p className="telemetry mt-1 text-[11px] text-info">
                        normalised → {turn.callerNormalised}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <Label>{turn.agentLabel ?? 'Agent'}</Label>
                      {turn.fallback && <Pill tone="warn">safe deflection</Pill>}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-bone">
                      {turn.finalText ?? turn.streamingText}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-faint">Press play.</p>
                )}
              </div>

              {/* Annotations, appearing at the moment the event fired */}
              <div className="space-y-1.5">
                {notes.map((note, i) => (
                  <p
                    key={i}
                    className="telemetry border-l-2 border-live/50 pl-2 text-[11px] leading-relaxed text-live"
                  >
                    {note}
                  </p>
                ))}
              </div>
            </div>

            <TraceRail turn={turn} />
          </div>

          <p className="telemetry text-[10px] leading-relaxed text-faint">
            Replayed from a real captured trace at its original pacing. The voice is browser
            speech synthesis reading the captured transcript — it is not a recording of a
            microphone.
          </p>
        </>
      )}
    </div>
  );
}
