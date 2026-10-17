import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { censusFormat } from "../scripts/inspect-format";
import { Recorder } from "../src/server/recorder";
import { recordPolicy } from "../src/shared/records";
import type { ReplayEvent, Session } from "../src/shared/types";
import { formatFixtures, type FormatFixture, type Generation, writeFormatFixtures } from "./format-fixtures";
import { removeTestDirectory } from "./helpers";

// Each generation's synthetic recording, from tests/format-fixtures.ts, indexed into isolated state. The numbers below
// are derived from those records by the index's rules; when Claude Code changes its format, refreshing a fixture and
// these numbers together is the deliberate step that reviews the change.

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "blackbox-generations-"));
  const data = join(root, "claude");
  const fixtures = formatFixtures();
  await writeFormatFixtures(data, fixtures);
  let recorder: Recorder | undefined;
  cleanup.push(async () => { await recorder?.close(); await removeTestDirectory(root); });
  return { data, fixtures, open: async (options: { scan?: boolean } = {}) => recorder = await Recorder.open(data, join(root, "state"), options) };
}

/** What the index shows of one generation's recording. */
function inspect(recorder: Recorder, fixture: FormatFixture) {
  const session = recorder.list(new URLSearchParams()).items.find(item => item.sessionId === fixture.sessionId)!;
  const events = (query: Record<string, string>) => recorder.events(session.id, new URLSearchParams({ limit: "200", ...query }));
  const all = events({ kind: "all" });
  const find = (term: string, kind = "all") => {
    const found = recorder.matches(session.id, new URLSearchParams({ kind, find: term }));
    return { total: found.total, sequences: found.items.map(item => item.sequence) };
  };
  const facets = (kind: string) => recorder.db.query<{ value: string }, [string, string]>("SELECT value FROM session_facets WHERE session_id=? AND kind=? ORDER BY value")
    .all(session.id, kind).map(row => row.value);
  const named = recorder.db.query<{ named: number }, [string]>("SELECT named FROM sessions WHERE id=?").get(session.id)!.named;
  const landing = recorder.list(new URLSearchParams({ q: fixture.term })).items.find(item => item.id === session.id);
  return { session, all, events, find, facets, named, landing };
}

function counts(session: Session) {
  return {
    events: session.eventCount, messages: session.messageCount, tools: session.toolCount, errors: session.errorCount,
    apiErrors: session.apiErrorCount, decisions: session.decisionCount,
  };
}

function categories(events: ReplayEvent[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const event of events) tally[event.category] = (tally[event.category] ?? 0) + 1;
  return tally;
}

/** The records that hold a turn of the conversation, less the reasoning Claude Code recorded without its text. */
function conversationRecords(fixture: FormatFixture, events: ReplayEvent[]): number {
  return fixture.records.filter(record => record.type === "user" || record.type === "assistant").length - events.filter(event => event.category === "hidden").length;
}

async function indexed() {
  const setup = await fixture();
  const recorder = await setup.open();
  const of = (generation: Generation) => setup.fixtures.find(fixture => fixture.generation === generation)!;
  return { setup, recorder, of, view: (generation: Generation) => inspect(recorder, of(generation)) };
}

describe("Claude Code recording generations", () => {
  test("2.0: a record per reply with its cost, a summary title, and a refusal known only by its message", async () => {
    const { of, view } = await indexed();
    const { session, all, events, find, facets, named, landing } = view("2.0");
    // Eleven records: the summary, two local command records, two prompts and an interruption marker, three replies, and
    // the failed and refused results. Each reply holds text, so each is a message; the interruption marker is one too.
    expect(counts(session)).toEqual({ events: 11, messages: 6, tools: 2, errors: 1, apiErrors: 0, decisions: 1 });
    expect(categories(all.items)).toEqual({ system: 3, message: 6, tool: 2 });
    expect([all.total, events({ kind: "conversation" }).total, all.hiddenTotal]).toEqual([11, 8, 0]);
    expect(events({ kind: "conversation" }).total).toBe(conversationRecords(of("2.0"), all.items));
    // The failure counts as an error; the refusal is a decision read from its message alone, and the Errors view shows both.
    expect(all.items.filter(event => event.error).map(event => event.sequence)).toEqual([5]);
    expect(all.items.filter(event => event.decision).map(event => [event.sequence, event.decision])).toEqual([[7, "denied"]]);
    expect(events({ kind: "all", errors: "1" }).total).toBe(2);
    // The summary titles the recording, at the lowest explicit rank.
    expect([session.title, named]).toEqual(["Synthetic parser cleanup", 1]);
    expect([session.version, facets("version"), session.unrecognizedCount, facets("unrecognized")]).toEqual(["2.0.14", ["2.0.14"], 0, []]);
    expect([session.model, session.cwd, session.hasEdits]).toEqual(["claude-sonnet-4-5-20250929", "/synthetic/parser", true]);
    expect(find("Quillfeather")).toEqual({ total: 1, sequences: [3] });
    expect(find("Quillfeather", "conversation").total).toBe(1);
    expect([landing?.matchEventId, landing?.matchCategory, landing?.matchRole]).toEqual([all.items[3].id, "message", "user"]);
    // Three requests, each priced by the `costUSD` Claude Code recorded on it.
    expect(session.usage).toMatchObject({
      requests: 3, inputTokens: 26, outputTokens: 120, cacheCreationTokens: 1200, cacheReadTokens: 2200, totalTokens: 3546,
      unpricedRequests: 0, recordedCostRequests: 3,
    });
    expect(session.usage.costUSD).toBeCloseTo(0.0125 + 0.0075 + 0.005, 12);
    expect([session.recordedCost, session.activeTime]).toEqual([null, null]);
  });

  test("2.1.27x: replies a block at a time, split cache writes, turn durations, hooks, and session state", async () => {
    const { of, view } = await indexed();
    const { session, all, events, find, facets, named, landing } = view("2.1.27x");
    // 22 records: 13 transcript records, of which five assistant records hold three replies, and nine state and
    // bookkeeping records. The reasoning without text is hidden, the tool call and its result are tools.
    expect(counts(session)).toEqual({ events: 22, messages: 5, tools: 1, errors: 0, apiErrors: 0, decisions: 0 });
    expect(categories(all.items)).toEqual({ system: 14, message: 5, tool: 2, hidden: 1 });
    expect([all.total, events({ kind: "conversation" }).total, all.hiddenTotal]).toEqual([22, 7, 1]);
    expect(events({ kind: "conversation" }).total).toBe(conversationRecords(of("2.1.27x"), all.items));
    expect([all.items[2].category, all.items[2].raw.thinkingDurationMs, all.items[2].raw.apiBlockIndex]).toEqual(["hidden", 1800, 0]);
    // A Stop hook summary at the suggestion level is not an error.
    expect(events({ kind: "all", errors: "1" }).total).toBe(0);
    expect([session.title, named]).toEqual(["Rename the Brindlewood helper", 0]);
    expect([session.version, facets("version"), session.unrecognizedCount, facets("unrecognized")]).toEqual(["2.1.278", ["2.1.278"], 0, []]);
    expect([session.model, session.hasEdits]).toEqual(["claude-opus-5", true]);
    // `last-prompt` repeats the prompt after each turn, but only the prompt itself is found.
    expect(find("Brindlewood")).toEqual({ total: 1, sequences: [1] });
    expect([landing?.matchEventId, landing?.matchCategory, landing?.matchRole]).toEqual([all.items[1].id, "message", "user"]);
    // Three requests from five assistant records: each keeps the record with its final usage. At claude-opus-5's rates
    // ($5 input, $25 output, a 5-minute write at 1.25 times input, an hour write at twice input, a read at a tenth):
    // a: 3×5 + 90×25 + 1500×6.25 + 500×10 + 8000×0.5 = 20,640; b: 5×5 + 40×25 + 300×6.25 + 10,000×0.5 = 7900;
    // c: 4×5 + 25×25 + 150×6.25 + 10,300×0.5 = 6732.5, in millionths of a dollar.
    expect(session.usage).toMatchObject({
      requests: 3, inputTokens: 12, outputTokens: 155, cacheCreationTokens: 2450, cacheReadTokens: 28_300, totalTokens: 30_917,
      unpricedRequests: 0, recordedCostRequests: 0,
    });
    expect(session.usage.costUSD).toBeCloseTo((20_640 + 7900 + 6732.5) / 1_000_000, 12);
    // The last `cost-state` is Claude Code's own total, its model key read without the context window suffix.
    expect(session.recordedCost).toEqual({
      costUSD: 0.0353, startedAt: "2026-08-20T09:00:00.000Z", unknownModelCost: false, apiDurationMs: 45_000, toolDurationMs: 4000,
      models: { "claude-opus-5": { inputTokens: 12, outputTokens: 155, thinkingTokens: 0, cacheCreationTokens: 2450, cacheReadTokens: 28_300, webSearchRequests: 0, costUSD: 0.0353 } },
    });
    expect(session.activeTime).toEqual({ durationMs: 60_000, turns: 2 });
  });

  test("2.1.30x: the request log, decision kinds, API error stand-ins, advisor steps, and the agent name title", async () => {
    const { of, view } = await indexed();
    const { session, all, events, find, facets, named, landing } = view("2.1.30x");
    // 57 records: 25 transcript records, seven request log records with a version, nine message copies, and sixteen
    // state and bookkeeping records. Two of the ten assistant records are Claude Code's own stand-ins, never messages.
    expect(counts(session)).toEqual({ events: 57, messages: 6, tools: 5, errors: 1, apiErrors: 1, decisions: 4 });
    expect(categories(all.items)).toEqual({ system: 38, message: 6, tool: 10, hidden: 1, synthetic: 2 });
    expect([all.total, events({ kind: "conversation" }).total, all.hiddenTotal]).toEqual([57, 18, 1]);
    expect(events({ kind: "conversation" }).total).toBe(conversationRecords(of("2.1.30x"), all.items));
    // The interruption marker is a user record with text, so it is listed among the prompts.
    expect(events({ kind: "prompts" }).items.map(event => event.sequence)).toEqual([1, 28, 37, 47]);
    expect(events({ kind: "responses" }).items.map(event => event.sequence)).toEqual([6, 51]);
    // Each decision is read from the `toolDenialKind` beside it; a PreToolUse hook's denial, filed as a permission rule,
    // is told apart by its message. Only the API error turn is an error, and the Errors view lists all five.
    expect(all.items.filter(event => event.decision).map(event => [event.sequence, event.decision]))
      .toEqual([[14, "denied"], [19, "blocked"], [26, "cancelled"], [27, "interrupted"]]);
    expect(all.items.filter(event => event.error).map(event => [event.sequence, event.category])).toEqual([[40, "synthetic"]]);
    expect(all.items[41]).toMatchObject({ category: "synthetic", error: false });
    expect(events({ kind: "all", errors: "1" }).total).toBe(5);
    // The agent name outranks the AI title written before it.
    expect([session.title, named]).toEqual(["Stream porter", 4]);
    expect([session.version, facets("version"), session.unrecognizedCount, facets("unrecognized")]).toEqual(["2.1.302", ["2.1.302"], 0, []]);
    // The relocation moves the working directory where it happened; the recording keeps its first.
    expect([session.cwd, all.items[45].cwd, all.facets.directories]).toEqual(["/synthetic/harbor", "/synthetic/harbor/.claude/worktrees/streams", ["/synthetic/harbor", "/synthetic/harbor/.claude/worktrees/streams"]]);
    expect([session.model, session.hasEdits]).toEqual(["claude-opus-5-5", true]);
    // The request log stays in the chronology as notes: copies untimed and without blocks, requests timed.
    const copies = all.items.filter(event => event.type === "api-request-blob");
    expect([copies.length, copies.every(event => event.category === "system" && !event.blocks.length && !event.timestamp)]).toEqual([9, true]);
    expect(all.items.filter(event => event.type === "api-request").every(event => event.timestamp)).toBe(true);
    // `last-prompt` and `queue-operation` leave their copies of a prompt out of the searchable text, but the message copy
    // of a prompt as it was sent keeps the user's words, so All events finds a prompt in its copy too. The conversation,
    // and the library search that opens it, find only the prompt.
    expect(find("Wrenfield")).toEqual({ total: 2, sequences: [1, 3] });
    expect(find("smaller batch")).toEqual({ total: 2, sequences: [37, 38] });
    expect(find("Wrenfield", "conversation").total).toBe(1);
    expect([landing?.matchEventId, landing?.matchCategory, landing?.matchRole]).toEqual([all.items[1].id, "message", "user"]);
    // Five requests; the stand-ins carry no usage. At claude-opus-5-5's rates ($4 input, $20 output, a read at 0.05 of
    // input) and claude-fable-5-1's ($10 input, $50 output) for the advisor step, in millionths of a dollar:
    // a: 6×4 + 120×20 + 3000×5 = 17,424 plus the advisor's 800×10 + 64×50 = 11,200; b: 4×4 + 80×20 + 400×5 + 3000×0.2 =
    // 4216; d: 5×4 + 110×20 + 300×5 + 3600×0.2 = 4440; f: 4×4 + 70×20 + 250×5 + 250×8 + 4000×0.2 = 5466. Request c ran at
    // the priority tier, which has no bundled rates, so it is counted without an estimate.
    expect(session.usage).toMatchObject({
      requests: 5, inputTokens: 822, outputTokens: 504, cacheCreationTokens: 4400, cacheReadTokens: 14_000, totalTokens: 19_726,
      unpricedRequests: 1, tierRequests: 1, unratedRequests: 0, unratedIterationRequests: 0, unnamedRequests: 0, fastRequests: 0,
      creditRequests: 0, recordedCostRequests: 0,
    });
    expect(session.usage.costUSD).toBeCloseTo((17_424 + 11_200 + 4216 + 4440 + 5466) / 1_000_000, 12);
    expect(session.recordedCost).toMatchObject({
      costUSD: 0.0512, startedAt: "2026-10-15T09:00:00.000Z", apiDurationMs: 52_000, toolDurationMs: 6000,
      models: { "claude-opus-5-5": { inputTokens: 22, costUSD: 0.04 }, "claude-fable-5-1": { inputTokens: 800, costUSD: 0.0112 } },
    });
    expect(session.activeTime).toEqual({ durationMs: 57_000, turns: 3 });
  });

  test("future: unknown record kinds are counted and shown, and nothing else changes", async () => {
    const { setup, recorder, of, view } = await indexed();
    const current = view("2.1.30x"), future = view("future");
    // The same session plus four records: three of kinds this build does not know and one valid record 30 levels deep.
    expect(of("future").records.length - of("2.1.30x").records.length).toBe(4);
    expect(counts(future.session)).toEqual({ ...counts(current.session), events: 61 });
    expect([future.session.version, future.facets("version"), future.session.unrecognizedCount, future.facets("unrecognized")])
      .toEqual(["2.2.0", ["2.2.0"], 3, ["attachment:context_digest", "system:plan_checkpoint", "type:session-insight"]]);
    // Unknown kinds keep their system cards under All events and stay searchable there, outside the conversation.
    const unknown = future.all.items.filter(event => /Cobaltreach/.test(event.text));
    expect(unknown.map(event => [event.type, event.category])).toEqual([["attachment", "system"], ["session-insight", "system"], ["system", "system"]]);
    expect(future.find("Cobaltreach")).toEqual({ total: 3, sequences: unknown.map(event => event.sequence) });
    expect(future.find("Cobaltreach", "conversation").total).toBe(0);
    const deep = future.all.items.find(event => event.type === "attachment" && (event.raw.attachment as { type?: string }).type === "structured_output")!;
    expect([deep.category, deep.text.includes("leaf: synthetic")]).toEqual(["system", true]);
    const comparable = (view: ReturnType<typeof inspect>) => ({
      title: view.session.title, named: view.named, model: view.session.model, cwd: view.session.cwd, hasEdits: view.session.hasEdits,
      usage: view.session.usage, recordedCost: view.session.recordedCost, activeTime: view.session.activeTime,
      categories: { ...categories(view.all.items), system: undefined }, conversation: view.events({ kind: "conversation" }).total,
      decisions: view.all.items.filter(event => event.decision).map(event => event.decision), find: view.find("Wrenfield"),
      landing: view.all.items.findIndex(event => event.id === view.landing?.matchEventId),
    });
    expect(comparable(future)).toEqual(comparable(current));
    expect(comparable(future).landing).toBe(1);
    expect(categories(future.all.items).system).toBe(categories(current.all.items).system + 4);
    // The library lists every version newest first, and filters by any of them.
    const catalog = await recorder.catalog();
    expect([catalog.versions, catalog.unrecognizedRecords, catalog.unrecognizedKinds]).toEqual([
      ["2.2.0", "2.1.302", "2.1.278", "2.0.14"], 3, ["attachment:context_digest", "system:plan_checkpoint", "type:session-insight"],
    ]);
    const versioned = (version: string) => recorder.list(new URLSearchParams({ version })).items.map(item => item.sessionId);
    expect(["2.0.14", "2.1.278", "2.1.302", "2.2.0"].map(versioned)).toEqual(setup.fixtures.map(fixture => [fixture.sessionId]));
  });

  test("a reopened index keeps every generation as indexed and re-reads none", async () => {
    const setup = await fixture();
    let recorder = await setup.open();
    const sessions = () => setup.fixtures.map(fixture => inspect(recorder, fixture).session);
    const indexed = sessions();
    await recorder.close();
    recorder = await setup.open({ scan: false });
    expect(sessions()).toEqual(indexed);
    // Advisor rows, priced with the whole rate table, and every other row are current, so nothing is marked for re-reading.
    expect(await recorder.scan()).toEqual([]);
    expect(sessions()).toEqual(indexed);
  });

  test("the format census lists every generation's record types, versions, and unknown kinds", async () => {
    const setup = await fixture();
    const census = await censusFormat(setup.data);
    expect(census.files).toEqual({ total: 4, main: 4, subagent: 0, unreadable: 0 });
    expect(census.lines).toEqual({ records: setup.fixtures.reduce((sum, fixture) => sum + fixture.records.length, 0), malformed: 0 });
    const types = Object.keys(census.types).sort();
    expect(types).toEqual([
      "agent-name", "ai-title", "api-request", "api-request-blob", "api-request-shape", "assistant", "atis-latch", "attachment",
      "cost-state", "file-history-snapshot", "last-prompt", "mode", "permission-mode", "pr-link", "queue-operation", "relocated",
      "session-insight", "summary", "system", "user",
    ]);
    // Every type the fixtures write is one Claude Code 2.1.302 files, except the future one.
    expect(types.filter(type => !recordPolicy.has(type))).toEqual(["session-insight"]);
    expect(census.types["session-insight"]).toMatchObject({ records: 1, recordings: 1 });
    expect(census.types.system!.subtypes).toEqual({ turn_duration: 8, stop_hook_summary: 3, local_command: 2, plan_checkpoint: 1 });
    expect(census.types.attachment!.subtypes).toEqual({ hook_success: 3, total_tokens_reminder: 3, context_digest: 1, structured_output: 1 });
    // Transcript records name their version, and from 2.1.30x so do the request log's requests and shapes.
    expect(census.versions).toEqual({
      "2.0.14": { records: 10, recordings: 1 }, "2.1.278": { records: 13, recordings: 1 },
      "2.1.302": { records: 32, recordings: 1 }, "2.2.0": { records: 35, recordings: 1 },
    });
    expect(Object.keys(census.versions)).toEqual(["2.0.14", "2.1.278", "2.1.302", "2.2.0"]);
    // Sixteen requests the index counts; from 2.1.27x each lists its steps, and two 2.1.30x requests consulted an advisor.
    expect(census.usage.requests).toBe(16);
    expect(census.usage.iterations).toMatchObject({ requests: 13, entryTypes: { message: 13, advisor_message: 2 } });
    expect(census.models).toMatchObject({
      requestedModel: { "assistant.requestedModel": 16 }, requestedModelValues: { "claude-opus-5-5[1m]": 16 },
      advisorModel: { "assistant.advisorModel": 16 }, advisorModelValues: { "claude-fable-5-1": 16 },
    });
  });
});
