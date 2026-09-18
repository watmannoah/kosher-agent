/** Client-side turn model, accumulated from the SSE event stream. */

import type { GuardrailHit } from '../guardrails';
import type { SpeakMode, TurnEvent } from '../agents/protocol';
import type { ToolResult } from '../tools/types';

export interface SubstitutionView {
  from: string;
  to: string;
  start: number;
  end: number;
  kind: string;
  method: string;
  confidence: number;
  gloss: string;
}

export interface ToolCallView {
  name: string;
  input: Record<string, unknown>;
  result: ToolResult | null;
  ok: boolean | null;
  error: string | null;
  durationMs: number | null;
}

export interface TurnView {
  id: number;
  status: 'running' | 'done' | 'error';
  callerRaw: string;
  callerNormalised: string;
  substitutions: SubstitutionView[];
  normaliseMs: number | null;

  triage: {
    intent: string;
    isShailah: boolean;
    asksOtherAgency: boolean;
    urgency: string;
    entities: Record<string, string>;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
  } | null;

  agent: string | null;
  agentLabel: string | null;
  agentModel: string | null;
  toolCount: number | null;
  toolNames: string[];
  speakMode: SpeakMode | null;
  verifyReason: string | null;

  toolCalls: ToolCallView[];
  guardrails: Array<GuardrailHit & { stage: 'input' | 'output' }>;

  verifier: {
    verdict: 'pass' | 'block';
    ground: string | null;
    reason: string;
    model: string;
    costUsd: number;
    durationMs: number;
  } | null;

  blockedDrafts: Array<{ text: string; reason: string; by: 'verifier' | 'guardrail'; attempt: number }>;

  streamingText: string;
  finalText: string | null;
  fallback: boolean;

  firstTokenMs: number | null;
  /** Measured in the browser, unlike the rest, which come from the server. */
  sttFinaliseMs: number | null;
  ttsFirstAudioMs: number | null;
  interrupted: boolean;

  metrics: Extract<TurnEvent, { t: 'metrics' }> | null;
  error: string | null;
}

export function emptyTurn(id: number, callerRaw: string): TurnView {
  return {
    id,
    status: 'running',
    callerRaw,
    callerNormalised: callerRaw,
    substitutions: [],
    normaliseMs: null,
    triage: null,
    agent: null,
    agentLabel: null,
    agentModel: null,
    toolCount: null,
    toolNames: [],
    speakMode: null,
    verifyReason: null,
    toolCalls: [],
    guardrails: [],
    verifier: null,
    blockedDrafts: [],
    streamingText: '',
    finalText: null,
    fallback: false,
    firstTokenMs: null,
    sttFinaliseMs: null,
    ttsFirstAudioMs: null,
    interrupted: false,
    metrics: null,
    error: null,
  };
}

/**
 * Fold one event into a turn, returning a new object.
 *
 * Pure and exported separately from the hook so it can be unit tested without
 * a DOM, and reused by the recorded-call player, which replays the identical
 * event stream from a captured file.
 */
export function applyEvent(turn: TurnView, event: TurnEvent): TurnView {
  switch (event.t) {
    case 'normalised':
      return {
        ...turn,
        callerRaw: event.raw,
        callerNormalised: event.normalised,
        substitutions: event.substitutions,
        normaliseMs: event.durationMs,
      };

    case 'guardrail':
      return { ...turn, guardrails: [...turn.guardrails, { ...event.hit, stage: event.stage }] };

    case 'triage':
      return {
        ...turn,
        triage: {
          intent: event.intent,
          isShailah: event.isShailah,
          asksOtherAgency: event.asksOtherAgency,
          urgency: event.urgency,
          entities: event.entities as Record<string, string>,
          model: event.model,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          costUsd: event.costUsd,
          durationMs: event.durationMs,
        },
      };

    case 'plan':
      return {
        ...turn,
        agent: event.agent,
        agentLabel: event.label,
        agentModel: event.model,
        toolCount: event.toolCount,
        toolNames: event.toolNames,
        speakMode: event.speakMode,
        verifyReason: event.verifyReason,
      };

    case 'tool_call':
      return {
        ...turn,
        toolCalls: [
          ...turn.toolCalls,
          { name: event.name, input: event.input, result: null, ok: null, error: null, durationMs: null },
        ],
      };

    case 'tool_result': {
      // Attach to the most recent unresolved call of the same name, so parallel
      // calls to different tools do not overwrite each other's results.
      const index = turn.toolCalls.findIndex((c) => c.name === event.name && c.result === null);
      if (index === -1) return turn;
      const toolCalls = [...turn.toolCalls];
      toolCalls[index] = {
        ...toolCalls[index],
        result: event.result,
        ok: event.ok,
        error: event.error,
        durationMs: event.durationMs,
      };
      return { ...turn, toolCalls };
    }

    case 'first_token':
      return { ...turn, firstTokenMs: event.elapsedMs };

    case 'text':
      return { ...turn, streamingText: turn.streamingText + event.delta };

    case 'draft':
      return turn;

    case 'verifier':
      return {
        ...turn,
        verifier: {
          verdict: event.verdict,
          ground: event.ground,
          reason: event.reason,
          model: event.model,
          costUsd: event.costUsd,
          durationMs: event.durationMs,
        },
      };

    case 'blocked_draft':
      return {
        ...turn,
        blockedDrafts: [
          ...turn.blockedDrafts,
          { text: event.text, reason: event.reason, by: event.by, attempt: event.attempt },
        ],
      };

    case 'retry':
      // The blocked draft is preserved in blockedDrafts and shown in the rail;
      // the live transcript resets so the caller sees only the corrected reply.
      return { ...turn, streamingText: '' };

    case 'final':
      return { ...turn, finalText: event.text, fallback: event.fallback, status: 'done' };

    case 'metrics':
      return { ...turn, metrics: event };

    case 'error':
      return { ...turn, error: event.message, status: 'error' };

    case 'degraded':
      return { ...turn, error: event.reason, status: 'error' };

    default:
      return turn;
  }
}
