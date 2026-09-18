/**
 * Assemble the downloadable telemetry payload.
 *
 * Merges the server's own event log — which arrives over the wire, so the
 * download is the real trace rather than something reconstructed from what the
 * UI happened to render — with the three things only the browser can measure:
 * how long STT took to finalise, when audio actually began, and whether the
 * caller interrupted.
 */

import type { TelemetryEvent } from '../telemetry/events';
import type { TurnView } from './types';

export interface TelemetryExport {
  note: string;
  callId: string;
  exportedAt: string;
  turnCount: number;
  totalCostUsd: number;
  events: TelemetryEvent[];
}

export function buildTelemetry(
  callId: string,
  turns: TurnView[],
  serverEvents: Map<number, TelemetryEvent[]>,
): TelemetryExport {
  const events: TelemetryEvent[] = [];

  events.push({
    event: 'call_start',
    call_id: callId,
    turn_id: 0,
    timestamp_ms: turns[0] ? Date.now() - 1 : Date.now(),
    detail: { source: 'browser' },
  });

  for (const turn of turns) {
    const fromServer = serverEvents.get(turn.id) ?? [];

    // Browser-measured STT, which the server never sees — it receives only the
    // finished transcript.
    if (turn.sttFinaliseMs !== null) {
      events.push({
        event: 'stt_raw',
        call_id: callId,
        turn_id: turn.id,
        timestamp_ms: Date.now(),
        duration_ms: turn.sttFinaliseMs,
        detail: { text: turn.callerRaw, source: 'browser' },
      });
    }

    events.push(...fromServer);

    if (turn.ttsFirstAudioMs !== null) {
      events.push({
        event: 'tts_start',
        call_id: callId,
        turn_id: turn.id,
        timestamp_ms: Date.now(),
        duration_ms: turn.ttsFirstAudioMs,
        detail: { source: 'browser', speak_mode: turn.speakMode },
      });
    }

    if (turn.interrupted) {
      events.push({
        event: 'interruption',
        call_id: callId,
        turn_id: turn.id,
        timestamp_ms: Date.now(),
        detail: { source: 'browser' },
      });
    }
  }

  events.sort((a, b) => a.turn_id - b.turn_id || a.timestamp_ms - b.timestamp_ms);

  return {
    note:
      'This is the payload you would ship to an observability stack. Server-side events come ' +
      'from the pipeline itself; events marked source=browser are measured client-side because ' +
      'the server never sees them.',
    callId,
    exportedAt: new Date().toISOString(),
    turnCount: turns.length,
    totalCostUsd: Number(
      events.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0).toFixed(6),
    ),
    events,
  };
}

/** Trigger a browser download of the payload. */
export function downloadTelemetry(payload: TelemetryExport): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kehilla-telemetry-${payload.callId}.json`;
  link.click();
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough for the click to be processed.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
