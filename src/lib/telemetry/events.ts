/**
 * Telemetry event schema.
 *
 * One flat event type with optional fields rather than a discriminated union of
 * fifteen shapes, because the point of this log is to be exported and queried
 * by something else — a union would force the consumer to handle fifteen cases
 * to compute "total cost by agent". This is the payload you would ship to an
 * observability stack, so it is shaped for that rather than for the type
 * checker's comfort.
 *
 * Some events originate in the browser (`stt_raw`, `tts_start`, `interruption`)
 * and some on the server. Both land in the same session log via /api/telemetry
 * so the download is one coherent trace rather than two halves to reconcile.
 */

export type EventName =
  | 'call_start'
  | 'stt_raw'
  | 'stt_normalised'
  | 'triage_decision'
  | 'agent_handoff'
  | 'llm_first_token'
  | 'tool_call'
  | 'tool_result'
  | 'verifier_verdict'
  | 'guardrail_hit'
  | 'hallucination_block'
  | 'tts_start'
  | 'interruption'
  | 'escalation'
  | 'call_end';

/** Events the browser is allowed to submit. Anything else is rejected. */
export const CLIENT_SUBMITTABLE: ReadonlySet<EventName> = new Set([
  'call_start',
  'stt_raw',
  'tts_start',
  'interruption',
  'call_end',
]);

export interface TelemetryEvent {
  event: EventName;
  call_id: string;
  turn_id: number;
  timestamp_ms: number;
  /** Which agent the event belongs to, where one applies. */
  agent?: string;
  model?: string;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cost_usd?: number;
  /** Event-specific payload. Deliberately loose — see the note above. */
  detail?: Record<string, unknown>;
}

/**
 * Per-call event collector.
 *
 * Holds the call id and turn number so individual emit sites do not have to,
 * which is what stops a turn's events from being silently mislabelled.
 */
export class EventLog {
  private events: TelemetryEvent[] = [];

  constructor(
    readonly callId: string,
    private turnId = 0,
  ) {}

  nextTurn(): number {
    return ++this.turnId;
  }

  get currentTurn(): number {
    return this.turnId;
  }

  emit(event: EventName, fields: Omit<Partial<TelemetryEvent>, 'event'> = {}): TelemetryEvent {
    const record: TelemetryEvent = {
      event,
      call_id: this.callId,
      turn_id: this.turnId,
      timestamp_ms: Date.now(),
      ...fields,
    };
    this.events.push(record);
    return record;
  }

  all(): readonly TelemetryEvent[] {
    return this.events;
  }

  /** Total spend across every event carrying a cost. */
  totalCostUsd(): number {
    return Number(
      this.events.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0).toFixed(6),
    );
  }

  /** Spend broken down by agent, for the cost panel. */
  costByAgent(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.events) {
      if (!e.cost_usd || !e.agent) continue;
      out[e.agent] = Number(((out[e.agent] ?? 0) + e.cost_usd).toFixed(6));
    }
    return out;
  }
}
