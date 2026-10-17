// Claude Code 2.1.30x keeps its own session state in the recording file next to the transcript. Its writer files these
// record types as state ("last-wins" or "boundary-cleared"), not as transcript records: none carries a message, most
// carry no timestamp, and two repeat a prompt that a user record already holds (`last-prompt.lastPrompt`, written after
// every turn, and `queue-operation.content`). The index gives them no blocks, and the replay shows each as a note.
export const sessionStateTypes: ReadonlySet<string> = new Set([
  "last-prompt", "atis-latch", "queue-operation", "cost-state", "mode", "permission-mode", "worktree-state",
  "isolation-latch", "dev-mods", "memory-mode", "agent-name", "agent-color", "agent-setting", "tag",
  "attribution-snapshot", "file-history-delta", "api-request-shape", "relocated", "continued-in", "fork-context-ref",
  "observer-ref", "history-suppression", "ended-by-model", "content-replacement",
]);

export function isSessionState(type: string): boolean {
  return sessionStateTypes.has(type);
}

// Claude Code's own schema bounds every recorded duration and count as a finite non-negative number no greater than
// this, and its own loader rewrites a `durationMs` outside those bounds as 0.
const durationLimit = 1_000_000_000_000_000;

/** A recorded millisecond duration within Claude Code's own bounds, or null for anything else. */
export function recordedDuration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= durationLimit ? value : null;
}

/**
 * Claude Code 2.1.27x and later end each turn with a `system` record of subtype `turn_duration`, timestamped, whose
 * `durationMs` measures the turn from the prompt to the reply and `messageCount` the messages in memory at its end.
 * The sum over a recording is its active time: the time Claude Code worked, as opposed to the span between the first
 * and last timestamps, which counts the pauses between turns. Returns the measured milliseconds for such a record, 0
 * when its `durationMs` is outside Claude Code's own bounds, and null for any other record.
 */
export function turnDuration(raw: Record<string, unknown>): number | null {
  if (raw.type !== "system" || raw.subtype !== "turn_duration") return null;
  const duration = recordedDuration(raw.durationMs);
  return duration !== null && Number.isSafeInteger(duration) ? duration : 0;
}

/**
 * The time the model spent on a reasoning step, from the `thinkingDurationMs` Claude Code writes on the assistant
 * record that carries the thinking block, with the `thinking_tokens` the API reported for it when present. Claude Code
 * itself only trusts a safe integer of at least one millisecond. Null when the record measured nothing.
 */
export function thinkingMeasure(raw: Record<string, unknown>): { durationMs: number; tokens: number | null } | null {
  const durationMs = raw.thinkingDurationMs;
  if (typeof durationMs !== "number" || !Number.isSafeInteger(durationMs) || durationMs < 1) return null;
  const tokens = objectOf(objectOf(objectOf(raw.message).usage).output_tokens_details).thinking_tokens;
  return { durationMs, tokens: typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null };
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
