import { describe, expect, test } from "bun:test";
import { decisionLabels, resultDecision } from "../src/shared/decisions";
import { normalize } from "../src/server/normalize";

const result = (content: unknown, is_error = true) => ({ type: "tool_result", tool_use_id: "call-1", content, is_error }) as Parameters<typeof resultDecision>[0];
const user = (content: unknown, extra: Record<string, unknown> = {}) => normalize({ type: "user", timestamp: "2026-10-17T10:00:02Z", message: { role: "user", content }, ...extra }, "s", 0, 0);

describe("tool result decisions", () => {
  test("recognizes the messages Claude Code records when the user stops a tool", () => {
    expect(resultDecision(result("The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."))).toBe("denied");
    expect(resultDecision(result("The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."))).toBe("denied");
    // A rejection with feedback starts with a newline and carries the user's words after it.
    expect(resultDecision(result("\nThe user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nUse the staging database instead."))).toBe("denied");
    expect(resultDecision(result("[Request interrupted by user for tool use]"))).toBe("interrupted");
  });

  test("recognizes denials by permission rules, non-interactive modes, and subagent limits", () => {
    expect(resultDecision(result("Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). Try a different approach or report the limitation to complete your task."))).toBe("denied");
    expect(resultDecision(result("Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user said:\nNot on main."))).toBe("denied");
    expect(resultDecision(result("Permission to use Bash has been denied. IMPORTANT: You *may* attempt to accomplish this action using other tools."))).toBe("denied");
    expect(resultDecision(result("Permission to use mcp__github__merge_pull_request has been denied because Claude Code is running in don't ask mode. IMPORTANT: ..."))).toBe("denied");
  });

  test("recognizes a PreToolUse hook that stopped the call", () => {
    expect(resultDecision(result("Execution stopped by PreToolUse hook"))).toBe("blocked");
    expect(resultDecision(result("Execution stopped by PreToolUse hook: protected branch"))).toBe("blocked");
    expect(resultDecision(result("PreToolUse:Bash hook error: rm -rf is not allowed in this repository"))).toBe("blocked");
  });

  test("leaves genuine failures, successes, and other blocks alone", () => {
    expect(resultDecision(result("<tool_use_error>File has not been read yet.</tool_use_error>"))).toBeNull();
    expect(resultDecision(result("<tool_use_error>Sibling tool call errored</tool_use_error>"))).toBeNull();
    expect(resultDecision(result("Exit code 1\nrm: cannot remove 'node_modules': Permission denied"))).toBeNull();
    expect(resultDecision(result("InputValidationError: command is required"))).toBeNull();
    expect(resultDecision(result("Note: The user doesn't want to take this action right now."))).toBeNull();
    // The same words from a tool that ran are its output, not a decision.
    expect(resultDecision(result("The user doesn't want to take this action right now.", false))).toBeNull();
    expect(resultDecision({ type: "text", text: "The user doesn't want to take this action right now.", is_error: true })).toBeNull();
    expect(resultDecision(undefined)).toBeNull();
  });

  test("reads the message from the first text block of structured content", () => {
    expect(resultDecision(result([{ type: "text", text: "[Request interrupted by user for tool use]" }]))).toBe("interrupted");
    expect(resultDecision(result([{ type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } }, { type: "text", text: "Execution stopped by PreToolUse hook" }]))).toBe("blocked");
    expect(resultDecision(result([{ type: "text", text: "1 fail" }]))).toBeNull();
    expect(resultDecision(result([]))).toBeNull();
  });

  test("names each decision for the replay", () => {
    expect(decisionLabels).toEqual({ denied: "Permission denied", blocked: "Stopped by hook", interrupted: "Interrupted" });
  });
});

describe("normalized error flags", () => {
  test("counts failures but not decisions as errors, and keeps the decision on the record", () => {
    const denied = user([result("The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.")]);
    expect([denied.error, denied.decision]).toEqual([false, "denied"]);
    const failed = user([result("<tool_use_error>Exit code 2</tool_use_error>")]);
    expect([failed.error, failed.decision]).toEqual([true, null]);
    const mixed = user([result("1 fail"), { type: "tool_result", tool_use_id: "call-2", content: "[Request interrupted by user for tool use]", is_error: true }]);
    expect([mixed.error, mixed.decision]).toEqual([true, "interrupted"]);
    const succeeded = user([result("ok", false)]);
    expect([succeeded.error, succeeded.decision]).toEqual([false, null]);
  });

  test("counts an API error turn as an error", () => {
    const turn = normalize({
      type: "assistant", timestamp: "2026-10-17T10:00:05Z", isApiErrorMessage: true, error: "rate_limit", apiError: { status: 529 },
      message: { id: "synthetic-1", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }], usage: { input_tokens: 0, output_tokens: 0 } },
    }, "s", 0, 1);
    expect([turn.error, turn.decision, turn.role]).toEqual([true, null, "assistant"]);
    expect(normalize({ type: "assistant", message: { model: "claude-sonnet-5-5", content: "Done." } }, "s", 0, 2).error).toBe(false);
    expect(normalize({ type: "system", level: "error", content: "Hook failed" }, "s", 0, 3).error).toBe(true);
  });
});
