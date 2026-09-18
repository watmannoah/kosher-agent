/**
 * Wire protocol between the pipeline and the browser.
 *
 * A discriminated union on `t`, streamed as SSE. The client renders the trace
 * rail directly from these, so every event carries what the UI needs to display
 * it without a second request.
 */

import type { GuardrailHit } from '../guardrails';
import type { Intent, TriageEntities } from './triage';
import type { ToolResult } from '../tools/types';

/**
 * How the client should handle text-to-speech for this turn.
 *
 * This is the resolution of a real conflict in the requirements. The brief asks
 * for TTS to start at the first sentence boundary (BRIEF 4) and for the
 * verifier to hard-block bad drafts before they reach the caller (BRIEF 3).
 * Both are not simultaneously possible: speaking sentence one means a blocked
 * draft has already been read aloud, and an agent that interrupts itself to
 * retract a certification claim is worse than one that paused.
 *
 * So the choice is made per turn, from triage, before a token is generated:
 *
 *   'stream'       — speak at the first sentence boundary. Used when the turn
 *                    cannot carry a certification claim (greetings, hours), so
 *                    there is nothing for the verifier to catch.
 *   'after_verify' — stream text to the screen immediately, marked as an
 *                    unverified draft, and hold the audio until the verdict.
 *                    Used whenever a wrong answer would be a religious harm.
 *
 * The turns where correctness matters pay the latency; the turns where it does
 * not get the fast path. The latency strip reports which path ran, so the
 * tradeoff is visible rather than asserted.
 */
export type SpeakMode = 'stream' | 'after_verify';

export type TurnEvent =
  | {
      t: 'normalised';
      raw: string;
      normalised: string;
      substitutions: Array<{
        from: string;
        to: string;
        start: number;
        end: number;
        kind: string;
        method: string;
        confidence: number;
        gloss: string;
      }>;
      durationMs: number;
    }
  | { t: 'guardrail'; hit: GuardrailHit; stage: 'input' | 'output' }
  | {
      t: 'triage';
      intent: Intent;
      isShailah: boolean;
      asksOtherAgency: boolean;
      urgency: 'normal' | 'high';
      entities: TriageEntities;
      agent: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      durationMs: number;
    }
  | {
      t: 'plan';
      agent: string;
      label: string;
      model: string;
      toolCount: number;
      toolNames: string[];
      speakMode: SpeakMode;
      /** Why the verifier will or will not run — shown in the rail. */
      verifyReason: string;
    }
  | { t: 'tool_call'; name: string; input: Record<string, unknown> }
  | {
      t: 'tool_result';
      name: string;
      ok: boolean;
      error: string | null;
      result: ToolResult;
      durationMs: number;
    }
  | { t: 'first_token'; elapsedMs: number }
  | { t: 'text'; delta: string }
  | { t: 'draft'; text: string; attempt: number }
  | {
      t: 'verifier';
      verdict: 'pass' | 'block';
      ground: string | null;
      reason: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      durationMs: number;
    }
  | {
      t: 'blocked_draft';
      text: string;
      reason: string;
      by: 'verifier' | 'guardrail';
      attempt: number;
    }
  | { t: 'retry'; attempt: number; reason: string }
  | {
      t: 'final';
      text: string;
      speak: boolean;
      /** True when the safe deflection was used because retries were exhausted. */
      fallback: boolean;
    }
  | {
      t: 'metrics';
      turnTotalMs: number;
      normaliseMs: number;
      triageMs: number;
      specialistFirstTokenMs: number | null;
      specialistTotalMs: number;
      verifierMs: number | null;
      toolMs: number;
      turnCostUsd: number;
      sessionCostUsd: number;
      costByAgent: Record<string, number>;
      inputTokens: number;
      outputTokens: number;
    }
  | { t: 'error'; message: string; retryable: boolean }
  | { t: 'degraded'; reason: string };

/** Serialise one event as an SSE frame. */
export function sseFrame(event: TurnEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
