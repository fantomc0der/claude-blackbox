import { expect, spyOn, test } from "bun:test";
import { activeTimeSummary, duration, errorBreakdown, errorSummary, folderLabels, folderName, localDayOffset, measuredTime, modelName, recordedRange, resumeCommand, searchHighlight, stoppedTools, thinkingSummary, timeAgo, withLocalDays } from "../src/client/lib/format";
import { parseSearch } from "../src/server/search";
import { compareVersions, newestVersions, noteFiling, recordedDuration, recordedVersion, recordPolicy, recordSubtype, thinkingMeasure, turnDuration, unrecognizedKind } from "../src/shared/records";

test("measured times read in the two largest units", () => {
  expect(duration(0)).toBe("0s");
  expect(duration(400)).toBe("<1s");
  expect(duration(12_340)).toBe("12s");
  expect(duration(59_600)).toBe("1m 0s");
  expect(duration(336_000)).toBe("5m 36s");
  expect(duration(3_599_400)).toBe("59m 59s");
  expect(duration(23_940_000)).toBe("6h 39m");
  expect(duration(78_852_000)).toBe("21h 54m");
  expect(duration(97_200_000)).toBe("1d 3h");
  expect(activeTimeSummary({ durationMs: 336_000, turns: 6 })).toBe("5m 36s across 6 turns");
  expect(activeTimeSummary({ durationMs: 29_622_000, turns: 1 })).toBe("8h 13m across 1 turn");
  const recorded = { costUSD: 1, startedAt: "", unknownModelCost: false, models: {} };
  expect(measuredTime({ ...recorded, apiDurationMs: 450_000, toolDurationMs: 132_000 })).toBe("7m 30s in API calls · 2m 12s in tools");
  expect(measuredTime({ ...recorded, apiDurationMs: 450_000, toolDurationMs: null })).toBe("7m 30s in API calls");
  expect(measuredTime({ ...recorded, apiDurationMs: null, toolDurationMs: null })).toBe("");
  expect(thinkingSummary({ durationMs: 12_340, tokens: 1840 })).toBe("thought for 12s (1,840 thinking tokens)");
  expect(thinkingSummary({ durationMs: 400, tokens: null })).toBe("thought for <1s");
});

test("a recording's errors name the API errors among them, and the tools a decision stopped stand apart", () => {
  const counts = (errorCount: number, apiErrorCount: number, decisionCount: number) => ({ errorCount, apiErrorCount, decisionCount });
  expect(errorSummary(counts(3, 1, 2))).toBe("3 errors (1 API error) · 2 tools stopped");
  expect(errorSummary(counts(1, 0, 1))).toBe("1 error · 1 tool stopped");
  expect(errorSummary(counts(2, 2, 0))).toBe("2 API errors");
  expect(errorSummary(counts(1200, 0, 0))).toBe(`${(1200).toLocaleString()} errors`);
  expect(errorSummary(counts(0, 0, 4))).toBe("4 tools stopped");
  expect(errorSummary(counts(0, 0, 0))).toBe("");
  expect([errorBreakdown(counts(0, 0, 4)), stoppedTools(counts(5, 2, 0))]).toEqual(["", ""]);
});

// Claude Code's own schema bounds a recorded duration as a finite non-negative number up to 1e15, and its loader rewrites
// a `turn_duration` whose `durationMs` fails that as 0.
test("recorded durations are read within Claude Code's own bounds", () => {
  expect(recordedDuration(0)).toBe(0);
  expect(recordedDuration(132_000.5)).toBe(132_000.5);
  expect(recordedDuration(1e15)).toBe(1e15);
  for (const bad of [-1, 1e15 + 1, Number.NaN, Number.POSITIVE_INFINITY, "5", null, undefined, true]) expect(recordedDuration(bad)).toBeNull();
  const turn = (durationMs: unknown) => ({ type: "system", subtype: "turn_duration", durationMs, messageCount: 4 });
  expect(turnDuration(turn(336_000))).toBe(336_000);
  expect(turnDuration(turn(0))).toBe(0);
  for (const bad of [-1, 1.5, Number.NaN, "336000", undefined, 2 ** 53]) expect(turnDuration(turn(bad))).toBe(0);
  expect(turnDuration({ type: "system", subtype: "stop_hook_summary", durationMs: 5 })).toBeNull();
  expect(turnDuration({ type: "user", subtype: "turn_duration", durationMs: 5 })).toBeNull();
  expect(turnDuration({ type: "system", durationMs: 5 })).toBeNull();
});

test("a reasoning step's measured time comes with its thinking tokens when the API reported them", () => {
  const thought = (thinkingDurationMs: unknown, usage?: Record<string, unknown>) => ({ type: "assistant", thinkingDurationMs, message: { role: "assistant", content: [{ type: "thinking", thinking: "" }], usage } });
  expect(thinkingMeasure(thought(12_340, { output_tokens: 2000, output_tokens_details: { thinking_tokens: 1840 } }))).toEqual({ durationMs: 12_340, tokens: 1840 });
  expect(thinkingMeasure(thought(12_340, { output_tokens: 2000 }))).toEqual({ durationMs: 12_340, tokens: null });
  expect(thinkingMeasure(thought(1))).toEqual({ durationMs: 1, tokens: null });
  expect(thinkingMeasure(thought(12_340, { output_tokens_details: { thinking_tokens: -1 } }))).toEqual({ durationMs: 12_340, tokens: null });
  expect(thinkingMeasure(thought(12_340, { output_tokens_details: "none" }))).toEqual({ durationMs: 12_340, tokens: null });
  for (const bad of [0, -1, 1.5, Number.NaN, "12340", undefined, null]) expect(thinkingMeasure(thought(bad))).toBeNull();
  expect(thinkingMeasure({ type: "assistant", message: { usage: { output_tokens_details: { thinking_tokens: 1840 } } } })).toBeNull();
});

test("record types are filed as Claude Code files them, and only bookkeeping and state read as notes", () => {
  expect(["user", "progress", "last-prompt", "api-request", "summary", "cost-state", "future-record"].map(type => recordPolicy.get(type) ?? null))
    .toEqual(["transcript", "transcript", "bookkeeping", "bookkeeping", "state", "state", null]);
  // An API request and its message copies are bookkeeping, but the replay shows them as a request card.
  expect(["last-prompt", "file-history-snapshot", "api-request", "api-request-blob", "summary", "permission-mode", "system", "future-record", "constructor"].map(noteFiling))
    .toEqual(["bookkeeping", "bookkeeping", null, null, "state", "state", null, null, null]);
  expect(recordSubtype("system", { subtype: "turn_duration" })).toBe("turn_duration");
  expect(recordSubtype("attachment", { attachment: { type: "hook_success" } })).toBe("hook_success");
  expect(recordSubtype("attachment", { attachment: "hook_success" })).toBeUndefined();
  expect(recordSubtype("user", { subtype: "turn_duration" })).toBeUndefined();
});

test("unrecognized records are named by kind only when the name has the shape of an identifier", () => {
  for (const [type, subtype] of [["user", undefined], ["cost-state", undefined], ["system", "turn_duration"], ["system", "api_error"], ["attachment", "hook_success"], ["system", undefined], ["attachment", null]]) {
    expect(unrecognizedKind(type as string, subtype)).toBeNull();
  }
  expect(unrecognizedKind("future-record", undefined)).toBe("type:future-record");
  expect(unrecognizedKind("system", "future_notice")).toBe("system:future_notice");
  expect(unrecognizedKind("attachment", "future_reminder")).toBe("attachment:future_reminder");
  // Recorded content never becomes a name, though the record still counts.
  for (const [type, subtype] of [["Rename the helper", undefined], ["system", "x".repeat(41)], ["system", "Future Notice"], ["system", 7], ["attachment", { type: "nested" }], ["attachment", '{"type":"nested"}']]) {
    expect(unrecognizedKind(type as string, subtype)).toBe("");
  }
});

test("Claude Code versions are read only in the shape of a version and order by their numbers", () => {
  expect(["2.1.302", "2.1.10-beta.2", "1.0.0+build.5"].map(recordedVersion)).toEqual(["2.1.302", "2.1.10-beta.2", "1.0.0+build.5"]);
  expect(["v2.1.302", "2.1", "latest", "2.1.302 (Claude Code)", 2.1, null].map(recordedVersion)).toEqual(Array(6).fill(""));
  expect(["2.1.99", "2.1.302", "2.1.302-beta.1", "1.0.0"].sort(compareVersions)).toEqual(["1.0.0", "2.1.99", "2.1.302-beta.1", "2.1.302"]);
  // A list cut to a limit keeps the newest, which string order would put last.
  expect(newestVersions(["2.1.99", "10.0.0", "2.1.302", "2.1.302-beta.1", "1.0.0"], 3)).toEqual({ values: ["10.0.0", "2.1.302", "2.1.302-beta.1"], limited: true });
  expect(newestVersions(["2.1.9", "2.1.10"], 3)).toEqual({ values: ["2.1.10", "2.1.9"], limited: false });
});

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

test("recorded ranges show times within a day and dates across days", () => {
  const range = (start: string, end: string, days = false) => recordedRange(start, end, { days, locale: "en-US", timeZone: "UTC" }).replace(/\s/g, " ");
  expect(range("2026-10-10T09:02:00Z", "2026-10-10T09:40:00Z")).toBe("Oct 10, 2026, 9:02 – 9:40 AM");
  expect(range("2026-10-10T09:02:00Z", "2026-10-12T15:00:00Z")).toBe("Oct 10 – 12, 2026");
  expect(range("2026-10-10T09:02:00Z", "2026-10-10T09:02:00Z")).toBe("Oct 10, 2026, 9:02 AM");
  expect(range("2026-10-10T09:02:00Z", "")).toBe("Oct 10, 2026, 9:02 AM");
  expect(range("", "")).toBe("Dates not recorded");
  expect(range("2026-10-10T09:02:00Z", "2026-10-10T09:40:00Z", true)).toBe("Oct 10, 2026");
  expect(range("2026-10-10T09:02:00Z", "2026-11-02T15:00:00Z", true)).toBe("Oct 10 – Nov 2, 2026");
  expect(recordedRange("2026-10-10T23:30:00Z", "2026-10-11T00:30:00Z", { locale: "en-US", timeZone: "America/New_York" }).replace(/\s/g, " ")).toBe("Oct 10, 2026, 7:30 – 8:30 PM");
});

test("folder names take the last path segment on either separator", () => {
  expect(folderName("/synthetic/workspaces/orbit-auth")).toBe("orbit-auth");
  expect(folderName("C:\\work\\orbit-auth\\")).toBe("orbit-auth");
  expect(folderName("")).toBe("Unknown folder");
});

test("folder labels add parent segments only until folders that share a name differ", () => {
  const labels = folderLabels(["/a/packages/shared", "/b/packages/shared", "C:\\work\\app", "/srv/app", "/srv/api", "/"]);
  expect([...labels.values()]).toEqual(["a/packages/shared", "b/packages/shared", "work\\app", "srv/app", "api", "/"]);
});

test("resume commands quote POSIX and PowerShell paths as literal arguments", () => {
  expect(resumeCommand({ cwd: "/work/it's safe; echo nope", sessionId: "id'quoted" }))
    .toBe("cd -- '/work/it'\\''s safe; echo nope' && claude --resume 'id'\\''quoted'");
  expect(resumeCommand({ cwd: "C:\\work\\it's safe; echo nope", sessionId: "id'quoted" }))
    .toBe("Set-Location -LiteralPath 'C:\\work\\it''s safe; echo nope' -ErrorAction Stop; claude --resume 'id''quoted'");
});

test("relative times read skew as now and a stamp further ahead as its date", () => {
  const now = spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-12T00:25:00Z"));
  try {
    const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    expect(timeAgo("2026-10-12T00:24:30Z")).toBe("Just now");
    expect(timeAgo("2026-10-12T00:25:30Z")).toBe("Just now");
    expect(timeAgo("2026-10-12T00:26:00Z")).toBe("Just now");
    expect(timeAgo("2026-10-12T00:26:01Z")).toBe(date("2026-10-12T00:26:01Z"));
    expect(timeAgo("2026-10-12T17:42:00Z")).toBe(date("2026-10-12T17:42:00Z"));
    expect(timeAgo("2026-10-12T00:20:00Z")).toBe("5m ago");
    expect(timeAgo("2026-10-11T22:25:00Z")).toBe("2h ago");
    expect(timeAgo("2026-10-09T00:25:00Z")).toBe("3d ago");
    expect(timeAgo("2026-09-01T00:25:00Z")).toBe(date("2026-09-01T00:25:00Z"));
    expect(timeAgo("not a time")).toBe("Unknown");
  } finally { now.mockRestore(); }
});

test("date bounds carry the local offset of each chosen day", () => {
  const zone = process.env.TZ;
  try {
    process.env.TZ = "Europe/Berlin";
    expect(localDayOffset("2026-10-13")).toBe(120);
    expect(localDayOffset("2026-10-13", true)).toBe(120);
    // Daylight saving ends during this day, so its first and last moments sit in different offsets.
    expect(localDayOffset("2026-10-25")).toBe(120);
    expect(localDayOffset("2026-10-25", true)).toBe(60);
    expect(withLocalDays("kind=all&after=2026-10-25&before=2026-10-25")).toBe("kind=all&after=2026-10-25&before=2026-10-25&afterTz=120&beforeTz=60");
    expect(withLocalDays("q=retry&afterTz=99&before=yesterday")).toBe("q=retry&before=yesterday");
    expect(localDayOffset("")).toBeNull();
    process.env.TZ = "America/New_York";
    expect(withLocalDays("after=2026-10-13")).toBe("after=2026-10-13&afterTz=-240");
    // Havana skips from 00:00 to 01:00 on this day, so the day starts at the previous offset.
    process.env.TZ = "America/Havana";
    expect(localDayOffset("2026-03-08")).toBe(-300);
    expect(localDayOffset("2026-03-08", true)).toBe(-240);
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});
