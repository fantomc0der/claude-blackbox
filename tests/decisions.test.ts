import { describe, expect, test } from "bun:test";
import { decisionLabels, resultDecision } from "../src/shared/decisions";
import { normalize } from "../src/server/normalize";

const result = (content: unknown, is_error = true, extra: Record<string, unknown> = {}) => ({ type: "tool_result", tool_use_id: "call-1", content, is_error, ...extra }) as Parameters<typeof resultDecision>[0];
const user = (content: unknown, extra: Record<string, unknown> = {}) => normalize({ type: "user", timestamp: "2026-10-17T10:00:02Z", message: { role: "user", content }, ...extra }, "s", 0, 0);
const cancel = "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.";
const reject = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

describe("tool result decisions", () => {
  test("recognizes the messages Claude Code records when the user declines or stops a tool", () => {
    expect(resultDecision(result(reject))).toBe("denied");
    // A rejection with feedback starts with a newline and carries the user's words after it.
    expect(resultDecision(result("\nThe user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nUse the staging database instead."))).toBe("denied");
    expect(resultDecision(result("[Request interrupted by user for tool use]"))).toBe("interrupted");
    expect(resultDecision(result("[Request interrupted by user]"))).toBe("interrupted");
  });

  test("tells the calls Claude Code ended or dropped apart from the ones it refused", () => {
    // Claude Code files this message as a cancellation, an abort rather than a denial.
    expect(resultDecision(result(cancel))).toBe("cancelled");
    expect(resultDecision(result("[Tool call skipped: the turn ended to deliver the message that follows before this call ran. Nothing refused it; re-run it if still needed.]"))).toBe("cancelled");
    expect(resultDecision(result("[Tool call not completed: an approval request expired with no answer, so the action awaiting approval did not run. Nobody refused it, so this is not the user's decision; ask again if it is still needed.]"))).toBe("cancelled");
    expect(resultDecision(result("[Tool call did not complete: the turn was ended to deliver the message that follows. Nothing refused it; re-run it if still needed.]"))).toBe("interrupted");
    expect(resultDecision(result("[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]"))).toBe("interrupted");
    expect(resultDecision(result("[Tool call result not in this copy: this session was copied from another session before that session recorded this call's result.]"))).toBe("interrupted");
  });

  test("recognizes denials by permission rules, non-interactive modes, safety checks, and subagent limits", () => {
    expect(resultDecision(result("Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). Try a different approach or report the limitation to complete your task."))).toBe("denied");
    expect(resultDecision(result("Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user said:\nNot on main."))).toBe("denied");
    expect(resultDecision(result("Permission to use Bash has been denied. IMPORTANT: You *may* attempt to accomplish this action using other tools."))).toBe("denied");
    expect(resultDecision(result("Permission to use mcp__github__merge_pull_request has been denied because Claude Code is running in don't ask mode. IMPORTANT: ..."))).toBe("denied");
    expect(resultDecision(result("Permission for this command was denied by a built-in Claude Code safety check, not by the user. The check stops removals that can delete far more than intended."))).toBe("denied");
    expect(resultDecision(result("Permission for this action has been denied. Reason: Production deploys need a review."))).toBe("denied");
  });

  test("recognizes a PreToolUse hook that stopped the call", () => {
    expect(resultDecision(result("Execution stopped by PreToolUse hook"))).toBe("blocked");
    expect(resultDecision(result("Execution stopped by PreToolUse hook: protected branch"))).toBe("blocked");
    expect(resultDecision(result("PreToolUse:Bash hook error: rm -rf is not allowed in this repository"))).toBe("blocked");
    expect(resultDecision(result("Hook PreToolUse:Bash denied this tool"))).toBe("blocked");
  });

  test("recognizes the auto mode classifier's refusals and the calls it could not review", () => {
    expect(resultDecision(result("Permission for this action was denied by the Claude Code auto mode classifier. Reason: Force push to main. If you have other tasks that don't require this action, continue working on those."))).toBe("auto-denied");
    expect(resultDecision(result("The API told auto mode's safety classifier (opus) to wait 30s from now, so auto mode cannot determine the safety of Bash until then. This is not a judgment that the action is unsafe."))).toBe("unreviewed");
    expect(resultDecision(result("The safety classifier is temporarily unavailable, so auto mode cannot determine the safety of Bash right now. Wait a moment and then try this action again."))).toBe("unreviewed");
    expect(resultDecision(result("mcp__deploy__release was not reviewed: it gave the auto mode classifier nothing to judge (its toAutoClassifierInput is empty), and only the classifier can allow it."))).toBe("unreviewed");
    expect(resultDecision(result("Bash was not reviewed and did not run: the conversation is too long for auto mode's classifier."))).toBe("unreviewed");
  });

  test("reads the kind Claude Code filed before the message, and the message only to tell a hook from a rule", () => {
    const kind = (toolDenialKind: unknown, content = "Deploys are frozen until Monday.") => resultDecision(result(content, true, { toolDenialKind }));
    expect([kind("user-rejected"), kind("permission-rule"), kind("automode-blocked"), kind("automode-unavailable"), kind("automode-parsing-error"), kind("interrupted"), kind("cancelled")])
      .toEqual(["denied", "denied", "auto-denied", "unreviewed", "unreviewed", "interrupted", "cancelled"]);
    expect(kind("permission-rule", "Execution stopped by PreToolUse hook: protected branch")).toBe("blocked");
    expect(kind("permission-rule", "Hook PreToolUse:Bash denied this tool")).toBe("blocked");
    expect(kind("user-rejected", cancel)).toBe("denied");
    // A remote host wraps a rule's denial in the failure wrapper, which only the kind tells apart.
    expect(kind("permission-rule", "<tool_use_error>Permission to use Bash has been denied.</tool_use_error>")).toBe("denied");
    // A kind this build does not know, or a value that is not one, leaves the message to decide.
    expect([kind("sandbox-blocked", cancel), kind("sandbox-blocked"), kind(7, reject), kind("constructor")]).toEqual(["cancelled", null, "denied", null]);
    // An unflagged result is output, whatever kind the record names.
    expect(resultDecision(result("Deploys are frozen until Monday.", false, { toolDenialKind: "permission-rule" }))).toBeNull();
  });

  test("leaves genuine failures, successes, and other blocks alone", () => {
    expect(resultDecision(result("<tool_use_error>File has not been read yet.</tool_use_error>"))).toBeNull();
    expect(resultDecision(result("<tool_use_error>Sibling tool call errored</tool_use_error>"))).toBeNull();
    expect(resultDecision(result("Exit code 1\nrm: cannot remove 'node_modules': Permission denied"))).toBeNull();
    expect(resultDecision(result("InputValidationError: command is required"))).toBeNull();
    expect(resultDecision(result("Note: The user doesn't want to take this action right now."))).toBeNull();
    expect(resultDecision(result("Exit code 1\nThe classifier was not reviewed by anyone"))).toBeNull();
    // The same words from a tool that ran are its output, not a decision.
    expect(resultDecision(result(cancel, false))).toBeNull();
    expect(resultDecision({ type: "text", text: cancel, is_error: true })).toBeNull();
    expect(resultDecision(undefined)).toBeNull();
  });

  test("reads the message from the first text block of structured content", () => {
    expect(resultDecision(result([{ type: "text", text: "[Request interrupted by user for tool use]" }]))).toBe("interrupted");
    expect(resultDecision(result([{ type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } }, { type: "text", text: "Execution stopped by PreToolUse hook" }]))).toBe("blocked");
    expect(resultDecision(result([{ type: "text", text: "1 fail" }]))).toBeNull();
    expect(resultDecision(result([]))).toBeNull();
  });

  test("names each decision for the replay", () => {
    expect(decisionLabels).toEqual({
      denied: "Permission denied", blocked: "Stopped by hook", "auto-denied": "Blocked by auto mode", unreviewed: "Not reviewed by auto mode",
      interrupted: "Interrupted", cancelled: "Cancelled",
    });
  });
});

describe("normalized error flags", () => {
  test("counts failures but not decisions as errors, and keeps the decision on the record", () => {
    const denied = user([result(reject)]);
    expect([denied.error, denied.decision]).toEqual([false, "denied"]);
    const cancelled = user([result(cancel)]);
    expect([cancelled.error, cancelled.decision]).toEqual([false, "cancelled"]);
    const failed = user([result("<tool_use_error>Exit code 2</tool_use_error>")]);
    expect([failed.error, failed.decision]).toEqual([true, null]);
    const mixed = user([result("1 fail"), { type: "tool_result", tool_use_id: "call-2", content: "[Request interrupted by user for tool use]", is_error: true }]);
    expect([mixed.error, mixed.decision]).toEqual([true, "interrupted"]);
    const succeeded = user([result("ok", false)]);
    expect([succeeded.error, succeeded.decision]).toEqual([false, null]);
  });

  test("copies the record's toolDenialKind onto its flagged results, and keeps it out of the searchable text", () => {
    const hook = user([result("Deploys are frozen until Monday.")], { toolDenialKind: "permission-rule", toolUseResult: "Error: Deploys are frozen until Monday." });
    expect([hook.error, hook.decision]).toEqual([false, "denied"]);
    expect(hook.blocks).toEqual([{ type: "tool_result", tool_use_id: "call-1", content: "Deploys are frozen until Monday.", is_error: true, toolDenialKind: "permission-rule" }]);
    expect(hook.text).not.toContain("permission-rule");
    // The raw record is kept as recorded.
    expect(hook.raw.message).toEqual({ role: "user", content: [result("Deploys are frozen until Monday.")] });
    const both = user([result("ok", false), { type: "tool_result", tool_use_id: "call-2", content: "[Tool call skipped: the turn was stopped before this call ran.]", is_error: true }], { toolDenialKind: "interrupted" });
    expect(both.blocks.map(block => block.toolDenialKind)).toEqual([undefined, "interrupted"]);
    expect([both.error, both.decision]).toEqual([false, "interrupted"]);
  });

  test("counts an API error turn as an error", () => {
    const turn = normalize({
      type: "assistant", timestamp: "2026-10-17T10:00:05Z", isApiErrorMessage: true, error: "rate_limit", apiError: "usage_limit_reached", apiErrorStatus: 429,
      message: { id: "synthetic-1", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "API Error: Request rejected (429)" }], usage: { input_tokens: 0, output_tokens: 0 } },
    }, "s", 0, 1);
    expect([turn.error, turn.decision, turn.role, turn.category]).toEqual([true, null, "assistant", "synthetic"]);
    expect(normalize({ type: "assistant", message: { model: "claude-sonnet-5-5", content: "Done." } }, "s", 0, 2).error).toBe(false);
    expect(normalize({ type: "system", level: "error", content: "Hook failed" }, "s", 0, 3).error).toBe(true);
  });
});
