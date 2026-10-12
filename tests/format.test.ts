import { expect, test } from "bun:test";
import { modelName, resumeCommand, searchHighlight } from "../src/client/lib/format";
import { parseSearch } from "../src/server/search";

test("search highlights use the term the server matched records with", () => {
  expect(searchHighlight("retry")).toBe("retry");
  expect(searchHighlight("  -draft billing retry")).toBe("billing");
  expect(searchHighlight('fix "default limit"')).toBe("fix");
  expect(searchHighlight('"default limit" fix')).toBe("default limit");
  expect(searchHighlight('-"old plan" rollout')).toBe("rollout");
  expect(searchHighlight("*** -- retry")).toBe("retry");
  expect(searchHighlight("-only -excluded")).toBe("");
  expect(searchHighlight("")).toBe("");
  for (const query of ["retry", '-"old plan" rollout', "*** retry", 'a"b c', `${"-x ".repeat(12)}late`, `${"-x ".repeat(11)}late`]) {
    const server = parseSearch(query).find(term => !term.exclude && /[\p{L}\p{N}]/u.test(term.value))?.value || "";
    expect(searchHighlight(query)).toBe(server);
  }
});

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
