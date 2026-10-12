import { expect, spyOn, test } from "bun:test";
import { folderName, localDayOffset, modelName, recordedRange, resumeCommand, searchHighlight, timeAgo, withLocalDays } from "../src/client/lib/format";
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
