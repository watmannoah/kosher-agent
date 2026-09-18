/**
 * Session hook: sends turns, consumes the SSE stream, drives TTS.
 *
 * The TTS branch here is where the SpeakMode decision made on the server
 * actually takes effect. See protocol.ts for why the decision exists — briefly,
 * a verifier that blocks bad drafts and audio that starts at the first sentence
 * are mutually exclusive, so turns that can carry a certification claim hold
 * their audio until the verdict and everything else speaks immediately.
 */

'use client';

import { useCallback, useRef, useState } from 'react';
import type { TurnEvent } from '../agents/protocol';
import type { TelemetryEvent } from '../telemetry/events';
import { applyEvent, emptyTurn, type TurnView } from './types';
import { buildTelemetry, downloadTelemetry } from './telemetry';
import { cancelSpeech, speak, takeSentences } from './voice';

export interface SessionState {
  callId: string;
  turns: TurnView[];
  busy: boolean;
  sessionCostUsd: number;
  /** Set when the server refuses — rate limit, spend cap, passcode. */
  notice: { message: string; kind: 'limit' | 'degraded' | 'error' } | null;
  speaking: boolean;
}

export interface SendOptions {
  /** Marks the turn for the public adversarial log. */
  attackId?: string;
  /** Suppress audio — used by the Break It panel, where reading is the point. */
  mute?: boolean;
  sttFinaliseMs?: number;
}

function newCallId(): string {
  return `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function useSession() {
  const [state, setState] = useState<SessionState>({
    callId: newCallId(),
    turns: [],
    busy: false,
    sessionCostUsd: 0,
    notice: null,
    speaking: false,
  });

  // Refs rather than state: read inside the stream loop, where a stale closure
  // over state would send the wrong history.
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const costRef = useRef(0);
  const turnCounter = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const spokenRef = useRef('');
  /** Server-side telemetry per turn, kept for the download. */
  const telemetryRef = useRef<Map<number, TelemetryEvent[]>>(new Map());

  const updateTurn = useCallback((id: number, fn: (t: TurnView) => TurnView) => {
    setState((prev) => ({
      ...prev,
      turns: prev.turns.map((t) => (t.id === id ? fn(t) : t)),
    }));
  }, []);

  /** Cancel audio and tell the server what the caller already heard. */
  const bargeIn = useCallback(() => {
    cancelSpeech();
    setState((prev) => ({ ...prev, speaking: false }));
    const heard = spokenRef.current;
    spokenRef.current = '';
    return heard;
  }, []);

  const send = useCallback(
    async (text: string, options: SendOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // A new turn while the agent is talking is a barge-in, which is the
      // normal way people interrupt on a phone call.
      const interruptedAfter = bargeIn();

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const id = ++turnCounter.current;
      setState((prev) => ({
        ...prev,
        busy: true,
        notice: null,
        turns: [
          ...prev.turns,
          {
            ...emptyTurn(id, trimmed),
            sttFinaliseMs: options.sttFinaliseMs ?? null,
            interrupted: Boolean(interruptedAfter),
          },
        ],
      }));

      let speakBuffer = '';
      let ttsStarted = false;
      let speakMode: 'stream' | 'after_verify' | null = null;
      const turnStarted = performance.now();

      const speakChunk = (chunk: string) => {
        if (options.mute) return;
        spokenRef.current += chunk;
        setState((prev) => ({ ...prev, speaking: true }));
        speak(chunk, {
          onStart: () => {
            if (ttsStarted) return;
            ttsStarted = true;
            const elapsed = Number((performance.now() - turnStarted).toFixed(1));
            updateTurn(id, (t) => ({ ...t, ttsFirstAudioMs: elapsed }));
          },
          onEnd: () => setState((prev) => ({ ...prev, speaking: false })),
        });
      };

      try {
        const response = await fetch('/api/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text: trimmed,
            callId: state.callId,
            turnId: id,
            history: historyRef.current,
            priorSessionCostUsd: costRef.current,
            interruptedAfter: interruptedAfter || undefined,
            attackId: options.attackId,
            logAttempt: Boolean(options.attackId),
          }),
        });

        if (!response.ok) {
          const json = (await response.json().catch(() => ({}))) as {
            message?: string;
            error?: string;
            degraded?: boolean;
          };
          const kind = json.degraded ? 'degraded' : response.status === 429 ? 'limit' : 'error';
          const message =
            json.message ??
            (response.status === 401
              ? 'The session expired. Reload and enter the passcode again.'
              : `The server refused the request (${response.status}).`);
          setState((prev) => ({ ...prev, busy: false, notice: { message, kind } }));
          updateTurn(id, (t) => ({ ...t, status: 'error', error: message }));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body.');
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;

            let event: TurnEvent;
            try {
              event = JSON.parse(line.slice(6)) as TurnEvent;
            } catch {
              continue;
            }

            updateTurn(id, (t) => applyEvent(t, event));

            if (event.t === 'plan') {
              speakMode = event.speakMode;
            }

            if (event.t === 'text' && speakMode === 'stream') {
              // Fast path: speak sentence by sentence as it arrives.
              speakBuffer += event.delta;
              const { sentences, rest } = takeSentences(speakBuffer);
              speakBuffer = rest;
              for (const sentence of sentences) speakChunk(sentence);
            }

            if (event.t === 'retry') {
              // Anything buffered belonged to a draft that was rejected.
              speakBuffer = '';
            }

            if (event.t === 'final') {
              if (speakMode === 'stream') {
                // Flush whatever did not end in a sentence boundary.
                const tail = speakBuffer.trim();
                speakBuffer = '';
                if (tail) speakChunk(tail);
              } else {
                // Verified path: the whole reply is spoken now that it cleared.
                speakChunk(event.text);
              }

              historyRef.current = [
                ...historyRef.current,
                { role: 'user' as const, content: trimmed },
                { role: 'assistant' as const, content: event.text },
              ].slice(-12);
            }

            if (event.t === 'metrics') {
              costRef.current = event.sessionCostUsd;
              setState((prev) => ({ ...prev, sessionCostUsd: event.sessionCostUsd }));
            }

            if (event.t === 'telemetry') {
              telemetryRef.current.set(id, event.events);
            }
          }
        }

        setState((prev) => ({ ...prev, busy: false }));
      } catch (err) {
        if (controller.signal.aborted) {
          setState((prev) => ({ ...prev, busy: false }));
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, busy: false, notice: { message, kind: 'error' } }));
        updateTurn(id, (t) => ({ ...t, status: 'error', error: message }));
      }
    },
    [bargeIn, state.callId, updateTurn],
  );

  const exportTelemetry = useCallback(() => {
    downloadTelemetry(buildTelemetry(state.callId, state.turns, telemetryRef.current));
  }, [state.callId, state.turns]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    cancelSpeech();
    historyRef.current = [];
    costRef.current = 0;
    turnCounter.current = 0;
    spokenRef.current = '';
    telemetryRef.current = new Map();
    setState({
      callId: newCallId(),
      turns: [],
      busy: false,
      sessionCostUsd: 0,
      notice: null,
      speaking: false,
    });
  }, []);

  const stopSpeaking = useCallback(() => {
    bargeIn();
  }, [bargeIn]);

  return { state, send, reset, bargeIn, stopSpeaking, exportTelemetry };
}
