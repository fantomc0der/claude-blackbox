import type { ContentBlock } from "./types";

/**
 * What a `tool_result` that Claude Code marked `is_error` records when the tool never ran because of a decision rather
 * than a failure: `denied` for a permission the user, a permission rule, or a non-interactive mode refused; `blocked`
 * for a PreToolUse hook that stopped the call; `interrupted` for a call the user interrupted.
 */
export type Decision = "denied" | "blocked" | "interrupted";

export const decisionLabels: Record<Decision, string> = { denied: "Permission denied", blocked: "Stopped by hook", interrupted: "Interrupted" };

// The messages Claude Code itself writes into these results, matched as prefixes because a denial may carry the user's
// reason after it and a hook stop its own reason. A rejection with feedback starts with a newline, so leading
// whitespace is skipped first. Anything else marked `is_error`, including the `<tool_use_error>` wrapper, a non-zero
// exit, or a file system "Permission denied", is a failure.
const rules: ReadonlyArray<readonly [Decision, RegExp]> = [
  ["interrupted", /^\[Request interrupted by user for tool use\]/],
  ["blocked", /^(?:Execution stopped by (?:\S+ )?hook\b|PreToolUse(?::\S+)? hook error: )/],
  ["denied", /^(?:The user doesn't want to (?:take this action|proceed with this tool use)\b|Permission (?:for this tool use was|to use [^\n]{1,200}? has been) denied\b)/],
];

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
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}
