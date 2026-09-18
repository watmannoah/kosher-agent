/**
 * Tool result envelope.
 *
 * Two design decisions here carry real weight.
 *
 * First, every result that concerns certification status carries a `meaning`
 * field stating the interpretation in plain words — including, where it applies,
 * that absence from our database is NOT a statement about kashrus. The guardrail
 * therefore lives in the data the model reads, not only in the system prompt. A
 * prompt rule competes with the caller's pressure; a sentence sitting inside the
 * tool result the model just received does not. It also means the verifier and
 * the on-screen trace are checking against the same explicit text.
 *
 * Second, failures are typed rather than thrown. An agent recovering
 * conversationally from `ambiguous_match` is the behaviour being demonstrated, so
 * a miss has to arrive as data the model can reason about.
 */

export type ToolErrorCode =
  | 'product_not_found'
  | 'ambiguous_match'
  | 'establishment_not_found'
  | 'certification_expired'
  | 'alert_active'
  | 'symbol_unrecognised'
  | 'no_stores_found'
  | 'invalid_arguments'
  | 'missing_required_detail';

export interface ToolSuccess<T = unknown> {
  ok: true;
  data: T;
}

export interface ToolFailure {
  ok: false;
  error: ToolErrorCode;
  /** Written for the model to read aloud from, not for a log. */
  message: string;
  /** Present when a failure still carries usable information. */
  data?: unknown;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

export const ok = <T>(data: T): ToolSuccess<T> => ({ ok: true, data });

export const fail = (error: ToolErrorCode, message: string, data?: unknown): ToolFailure => ({
  ok: false,
  error,
  message,
  ...(data === undefined ? {} : { data }),
});

/**
 * The single most important string in the system.
 *
 * Attached to every result where we do not certify something. BRIEF 2b calls
 * this the classic naive-bot failure; stating the interpretation inside the
 * result is how it gets prevented rather than merely discouraged.
 */
export const ABSENCE_MEANING =
  'We do not certify this. This is NOT a statement that it is not kosher — it may well be ' +
  'certified by another agency whose symbol is on the package. Say that we do not certify it, ' +
  'never that it is not kosher, and offer to identify the symbol if the caller can describe it.';

/** Whether a tool's output can carry a certification claim, which gates the verifier. */
export const STATUS_BEARING_TOOLS = new Set([
  'lookup_product',
  'lookup_establishment',
  'verify_symbol',
  'lookup_alerts',
]);
