import { expect, test } from "bun:test";
import { modelName, resumeCommand } from "../src/client/lib/format";

test("model names keep their version numbers and variant suffixes", () => {
  expect(modelName("claude-opus-4-5")).toBe("Opus 4.5");
  expect(modelName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
  expect(modelName("claude-opus-4-1-20250805")).toBe("Opus 4.1");
  expect(modelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  expect(modelName("claude-opus-5")).toBe("Opus 5");
  expect(modelName("claude-fable-5-1")).toBe("Fable 5.1");
  expect(modelName("claude-opus-5[1m]")).toBe("Opus 5 [1m]");
  expect(modelName("claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
});

test("model names report missing records and pass unknown identifiers through", () => {
  expect(modelName("")).toBe("Model not recorded");
  expect(modelName("<synthetic>")).toBe("Model not recorded");
  expect(modelName("claude-internal-preview-build")).toBe("internal-preview-build");
  expect(modelName("claude-opus-4-5-thinking-20250101")).toBe("opus-4-5-thinking");
  expect(modelName("claude-sonnet-4-5-v2-20250929")).toBe("sonnet-4-5-v2");
  expect(modelName("gpt-4o-mini")).toBe("gpt-4o-mini");
});

test("resume commands quote POSIX and PowerShell paths as literal arguments", () => {
  expect(resumeCommand({ cwd: "/work/it's safe; echo nope", sessionId: "id'quoted" }))
    .toBe("cd -- '/work/it'\\''s safe; echo nope' && claude --resume 'id'\\''quoted'");
  expect(resumeCommand({ cwd: "C:\\work\\it's safe; echo nope", sessionId: "id'quoted" }))
    .toBe("Set-Location -LiteralPath 'C:\\work\\it''s safe; echo nope' -ErrorAction Stop; claude --resume 'id''quoted'");
});
