/**
 * How Claude Code files a record type: `transcript` for the conversation, `bookkeeping` for the records it keeps to
 * rebuild a session (its "boundary-cleared" and "accumulate" types), and `state` for its session state, where only the
 * latest record of a type counts (its "last-wins" types).
 */
export type RecordFiling = "transcript" | "bookkeeping" | "state";

// Claude Code 2.1.302 prunes a recording by these filings, and treats a type it does not list as "accumulate".
// `progress` is boundary-cleared there and never persisted, but older versions wrote it beside the conversation, so it
// is read as transcript. A `summary` record is last-wins per `leafUuid`. Bookkeeping and state records carry no message,
// most carry no timestamp, and two repeat a prompt a user record already holds (`last-prompt.lastPrompt`, written after
// every turn, and `queue-operation.content`).
const filings: ReadonlyArray<readonly [RecordFiling, readonly string[]]> = [
  ["transcript", ["user", "assistant", "system", "attachment", "progress"]],
  ["bookkeeping", [
    "file-history-snapshot", "file-history-delta", "last-prompt", "continued-in", "api-request-shape", "api-request-blob",
    "api-request", "content-replacement", "fork-context-ref", "frame-link", "artifact-comment-monitor", "memory-mode",
  ]],
  ["state", [
    "summary", "custom-title", "ended-by-model", "ai-title", "tag", "relocated", "agent-name", "agent-color",
    "agent-setting", "pr-link", "artifact-autoreact-ledger", "bridge-session", "history-suppression", "attribution-snapshot",
    "mode", "permission-mode", "isolation-latch", "dev-mods", "atis-latch", "worktree-state", "cost-state",
    "queue-operation", "observer-ref",
  ]],
];

/** The filing of every record type Claude Code 2.1.302 writes, keyed by type. This build does not recognize any other. */
export const recordPolicy: ReadonlyMap<string, RecordFiling> = new Map(filings.flatMap(([filing, types]) => types.map(type => [type, filing] as const)));

// An API request and the message copies stored just before it are bookkeeping, but the replay folds the copies into the
// request's card, so neither reads as a note.
const requestTypes: ReadonlySet<string> = new Set(["api-request", "api-request-blob"]);

/**
 * The filing of a record that the index gives no blocks, and so no message or tool count, and that the replay shows as a
 * one-line note: every bookkeeping and state record but an API request and its message copies. Null for any other.
 */
export function noteFiling(type: string): "bookkeeping" | "state" | null {
  const filing = recordPolicy.get(type);
  return (filing === "bookkeeping" || filing === "state") && !requestTypes.has(type) ? filing : null;
}

/** The `system` subtypes Claude Code 2.1.302 knows. It writes all but `api_error`, which it only shows on screen. */
export const systemSubtypes: ReadonlySet<string> = new Set([
  "informational", "permission_retry", "bridge_status", "cloud_session_status", "scheduled_task_fire", "stop_hook_summary",
  "turn_duration", "away_summary", "memory_saved", "agents_killed", "local_command", "compact_boundary", "file_snapshot",
  "rewind_stand_in", "model_refusal_fallback", "model_refusal_no_fallback", "model_fallback", "model_consent_fallback",
  "api_error",
]);

/** The `attachment.type` values Claude Code 2.1.302 knows. */
export const attachmentTypes: ReadonlySet<string> = new Set([
  "poll_events", "directory", "edited_text_file", "at_mention_reference", "compact_file_reference", "pdf_reference",
  "selected_lines_in_ide", "selected_lines_in_diff", "opened_file_in_ide", "plan_file_reference", "nested_memory",
  "withheld_memory", "read_truncation_notice", "dir_sync_notice", "bash_output_audience_note", "unknown_command_fallback",
  "agent_mention", "peer_mention", "skill_mention", "skill_listing", "dynamic_skill", "output_style",
  "critical_system_reminder", "plan_mode_exit", "auto_mode_exit", "token_usage", "total_tokens_reminder",
  "output_limit_note", "silent_turn_reminder", "elapsed_time_reminder", "batching_reminder", "secondary_reminder",
  "budget_usd", "output_token_usage", "hook_blocking_error", "hook_additional_context", "inlined_image_paths",
  "hook_stopped_continuation", "prefix_delta", "thread_state", "date_change", "sandbox_instructions",
  "artifact_opening_prefetch", "environment", "model", "output_style_instructions", "session_context",
  "coordinator_context", "context_sections", "prompt_snapshot", "prompt_render_point", "thinking_stripped",
  "advisor_stripped", "thinking_drop", "credential_org", "deferred_tools_record", "instructions", "date", "fork_briefing",
  "language", "ultrathink_effort", "workflow_keyword_request", "ultra_effort_enter", "ultra_effort_exit",
  "tool_host_result_lines", "tool_hosts_correction", "tool_hosts_notice", "remote_session_change", "advisor_tool",
  "workflow_size_guideline_change", "cowork_memory_context", "account_memory_recall", "already_read_file",
  "async_hook_response_batch", "batching_reminder_sent", "secondary_reminder_sent", "command_permissions",
  "edited_image_file", "hook_cancelled", "hook_error_during_execution", "hook_non_blocking_error", "hook_system_message",
  "hook_permission_decision", "hook_deferred_tool", "goal_status", "session_cron_carry", "structured_output",
  "max_turns_reached", "teammate_shutdown_batch", "file", "invoked_skills", "todo_reminder", "task_reminder",
  "tool_search_usage_reminder", "relevant_memories", "queued_command", "diagnostics", "plan_mode", "plan_mode_reentry",
  "attention_budget", "auto_mode", "mcp_resource", "task_status", "async_hook_response", "hook_success",
  "context_efficiency", "deferred_tools_delta", "agent_listing_delta", "memory_update", "mcp_instructions_delta",
  "mcp_dropped_tools_delta", "teammate_mailbox", "team_context", "proactivity",
]);

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
