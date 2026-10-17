import type { ContentBlock } from "./types";

/**
 * What a `tool_result` that Claude Code marked `is_error` records when the tool never ran, or never finished, because of
 * a decision rather than a failure: `denied` for a permission the user, a permission rule, a non-interactive mode, or a
 * safety check refused; `blocked` for a PreToolUse hook that stopped the call; `auto-denied` for a call the auto mode
 * classifier refused, and `unreviewed` for one it could not review; `interrupted` for a call the user interrupted or a
 * turn ended under; `cancelled` for a call dropped before it ran, such as one whose approval request expired. Claude Code
 * itself counts the last two as aborts rather than denials.
 */
export type Decision = "denied" | "blocked" | "auto-denied" | "unreviewed" | "interrupted" | "cancelled";

export const decisionLabels: Record<Decision, string> = {
  denied: "Permission denied", blocked: "Stopped by hook", "auto-denied": "Blocked by auto mode", unreviewed: "Not reviewed by auto mode",
  interrupted: "Interrupted", cancelled: "Cancelled",
};

// The messages Claude Code itself writes into these results, matched as prefixes because a denial may carry the user's
// reason after it and a hook stop its own reason. A rejection with feedback starts with a newline, so leading
// whitespace is skipped first. Anything else marked `is_error`, including the `<tool_use_error>` wrapper, a non-zero
// exit, or a file system "Permission denied", is a failure. The auto mode classifier names itself, or the tool, inside
// the message it writes when it cannot review a call, so that rule allows a bounded lead before its own words.
const rules: ReadonlyArray<readonly [Decision, RegExp]> = [
  ["interrupted", /^\[(?:Request interrupted by user(?: for tool use)?\]|Tool call (?:did not complete|interrupted|result not in this copy):)/],
  ["cancelled", /^(?:The user doesn't want to take this action right now\b|\[Tool call (?:skipped|not completed):)/],
  ["blocked", /^(?:Execution stopped by (?:\S+ )?hook\b|PreToolUse(?::\S+)? hook error: |Hook PreToolUse(?::\S+)? denied this tool\b)/],
  ["auto-denied", /^Permission for this action was denied by the Claude Code auto mode classifier\b/],
  ["unreviewed", /^(?:The API told auto mode's safety classifier\b|[^\n]{1,200}?, so auto mode cannot determine the safety of |\S{1,200} was not reviewed(?::| and did not run:))/],
  ["denied", /^(?:The user doesn't want to proceed with this tool use\b|Permission (?:for this (?:tool use|command) was|for this action has been|to use [^\n]{1,200}? has been) denied\b)/],
];

// Claude Code 2.1.30x files each decision by kind in the `toolDenialKind` it writes beside the result, on the record
// that holds it, and `normalize()` copies the record's kind onto its flagged results. The kind decides wherever it is
// known; only a permission rule is told apart from a PreToolUse hook's denial, which Claude Code files as a rule, by
// its message. An unknown kind, and a result without one, falls back to the messages: recordings written before
// Claude Code kept the kind, and a PreToolUse hook that stops the turn with its own reason, carry none.
const kinds: Readonly<Record<string, Decision | ((text: Decision | null) => Decision)>> = {
  "user-rejected": "denied",
  "permission-rule": text => text === "blocked" ? "blocked" : "denied",
  "automode-blocked": "auto-denied",
  "automode-unavailable": "unreviewed",
  "automode-parsing-error": "unreviewed",
  interrupted: "interrupted",
  cancelled: "cancelled",
};

function leadingText(content: ContentBlock["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const entry of content) {
    if (typeof entry === "string") return entry;
    if (entry.type === "text" && typeof entry.text === "string") return entry.text;
  }
  return "";
}

/** The decision a `tool_result` block records, or null for a successful result or a genuine failure. */
export function resultDecision(block: ContentBlock | undefined): Decision | null {
  if (block?.type !== "tool_result" || block.is_error !== true) return null;
  const text = leadingText(block.content).trimStart();
  const matched = rules.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
  const kind = typeof block.toolDenialKind === "string" && Object.hasOwn(kinds, block.toolDenialKind) ? kinds[block.toolDenialKind] : undefined;
  return kind === undefined ? matched : typeof kind === "function" ? kind(matched) : kind;
}
