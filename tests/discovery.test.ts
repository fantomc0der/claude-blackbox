import { afterEach, expect, spyOn, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "../src/server/recorder";
import { dateBound, numericBound } from "../src/server/search";
import { removeTestDirectory } from "./helpers";
import { withSelectedOption } from "../src/client/lib/filter-options";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

function record(text: string, extra: Record<string, unknown> = {}) {
  return { type: "user", cwd: "/synthetic/project", timestamp: "2026-09-20T12:00:00Z", message: { content: text }, ...extra };
}

function request(key: string, costUSD?: number, model = "unknown-model", effort?: string) {
  return record(key, { type: "assistant", requestId: key, costUSD,
    message: { id: key, content: key, model, effort, usage: { input_tokens: 1000, output_tokens: 200 } } });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "blackbox-discovery-"));
  const data = join(root, "source");
  const folder = join(data, "projects", "synthetic");
  await mkdir(folder, { recursive: true });
  let recorder: Recorder | undefined;
  cleanup.push(async () => { await recorder?.close(); await removeTestDirectory(root); });
  return {
    root, data, folder,
    write: async (name: string, records: unknown[]) => {
      const path = join(folder, `${name}.jsonl`);
      await writeFile(path, records.map(entry => JSON.stringify(entry)).join("\n") + "\n");
      return path;
    },
    open: async (options: { scan?: boolean } = {}) => recorder = await Recorder.open(data, join(root, "state"), options),
  };
}

test("session ranking covers the whole selection and puts missing prices after known zero", async () => {
  const setup = await fixture();
  await setup.write("expensive", [request("expensive", 12), request("expensive", 12)]);
  await setup.write("cheap", [request("cheap", 2)]);
  await setup.write("zero", [request("zero", 0)]);
  await setup.write("partial", [request("partial", 5), request("unpriced-part")]);
  await setup.write("unpriced", [request("unpriced")]);
  await setup.write("missing", [record("missing")]);
  const recorder = await setup.open();
  const list = (query: string) => recorder.list(new URLSearchParams(query));
  expect(list("sort=cost&limit=1").items[0].usage.costUSD).toBe(12);
  expect(list("sort=cost&limit=1&offset=1").items[0].usage.costUSD).toBe(5);
  expect(list("sort=cost").items.slice(0, 4).map(session => session.usage.costUSD)).toEqual([12, 5, 2, 0]);
  expect(list("sort=cost-asc").items.slice(0, 4).map(session => session.usage.costUSD)).toEqual([0, 2, 5, 12]);
  expect(list("sort=tokens").items[0].title).toBe("Session partial");
  expect(list("sort=tokens-asc").items.at(-1)?.title).toBe("missing");
  expect(list("sort=cost&limit=1").usage).toEqual(list("sort=oldest").usage);
  expect(list("sort=__proto__").total).toBe(6);
});

test("pricing coverage and numeric bounds preserve unknown and partial semantics", async () => {
  const setup = await fixture();
  await setup.write("zero", [record("Zero"), request("zero", 0)]);
  await setup.write("priced", [record("Priced"), request("priced", 10)]);
  await setup.write("partial", [record("Partial"), request("partial", 3), request("unpriced-part")]);
  await setup.write("unpriced", [record("Unpriced"), request("unpriced")]);
  await setup.write("missing", [record("Missing")]);
  const recorder = await setup.open();
  const list = (query: string) => recorder.list(new URLSearchParams(query));
  expect(list("pricing=complete").total).toBe(2);
  expect(list("pricing=partial").items[0].title).toBe("Partial");
  expect(list("pricing=unpriced").items[0].title).toBe("Unpriced");
  expect(list("pricing=missing").items[0].title).toBe("Missing");
  expect(list("minCost=0&maxCost=0").items.map(session => session.title)).toEqual(["Zero"]);
  expect(list("maxCost=100").total).toBe(2);
  expect(list("minTokens=0").total).toBe(4);
  expect(list("pricing=missing&minTokens=0").total).toBe(0);
  expect(list("minTokens=2400&maxRecords=3").items[0].title).toBe("Partial");
  expect(list("minRecords=2&maxRecords=2").total).toBe(3);
  expect(list("minCost=11&maxCost=10").total).toBe(0);
  expect(list("minTokens=-1&maxCost=Infinity&minRecords=1.5").total).toBe(5);
  expect(list("pricing=complete&sort=cost&limit=1").usage.costUSD).toBe(10);
});

test("model and effort filters use historical evidence and the same model-effort pair", async () => {
  const setup = await fixture();
  await setup.write("mixed", [record("Mixed"), request("old", 1, "claude-sonnet-4-5-20250929", "high"), request("new", 2, "claude-opus-4-5", "low")]);
  await setup.write("no-usage", [record("No usage", { type: "assistant", message: { model: "historical-model", content: "No usage" } }), record("Last", { type: "assistant", message: { model: "latest-model", content: "Last" } })]);
  const recorder = await setup.open();
  const list = (query: string) => recorder.list(new URLSearchParams(query));
  expect(list("model=historical-model").total).toBe(1);
  expect(list("model=claude-sonnet-4-5&effort=high").total).toBe(1);
  expect(list("model=claude-sonnet-4-5&effort=low").total).toBe(0);
  expect(list("model=claude-sonnet-4-5&effort=high").usage.costUSD).toBe(3);
  const catalog = await recorder.catalog();
  expect(catalog.models).toContain("historical-model");
  expect(catalog.efforts).toEqual(["high", "low"]);
});

test("recorded tool facets are exact and support arbitrary MCP tools", async () => {
  const setup = await fixture();
  const tool = (name: string) => record(name, { type: "assistant", message: { content: [{ type: "tool_use", id: name, name, input: {} }] } });
  await setup.write("read", [tool("Read")]);
  await setup.write("reader", [tool("ReadFile")]);
  await setup.write("mcp", [tool("mcp__server__investigate")]);
  await setup.write("agent-worker", [tool("Write")]);
  const recorder = await setup.open();
  expect(recorder.list(new URLSearchParams("tool=Read")).total).toBe(1);
  expect(recorder.list(new URLSearchParams("tool=mcp__")).total).toBe(1);
  expect(recorder.list(new URLSearchParams("agents=only")).items[0].isAgent).toBe(true);
  expect(recorder.list(new URLSearchParams("agents=0")).total).toBe(3);
  expect((await recorder.catalog()).toolsUsed).toEqual(["Read", "ReadFile", "Write", "mcp__server__investigate"]);
});

test("replay views include mixed records, paired results and independent failure filtering", async () => {
  const setup = await fixture();
  await setup.write("mixed", [
    record("Investigate the failure"),
    record("", { type: "assistant", message: { model: "model-a", content: [
      { type: "text", text: "Editing the source" }, { type: "thinking", thinking: "Consider the cause" },
      { type: "tool_use", id: "edit-call", name: "Edit", input: { file_path: "src/test.ts" } },
    ] } }),
    record("", { message: { content: [{ type: "tool_result", tool_use_id: "edit-call", content: "Edit failed", is_error: true }] } }),
    record("Final answer", { type: "assistant", message: { model: "model-b", content: "Final answer" }, cwd: "/synthetic/worktree" }),
    record("System notification", { type: "system" }),
  ]);
  const recorder = await setup.open();
  const session = recorder.list(new URLSearchParams()).items[0];
  const events = (query: string) => recorder.events(session.id, new URLSearchParams(query));
  expect(events("kind=tool").items.map(event => event.sequence)).toEqual([1, 2]);
  expect(events("kind=thinking").items.map(event => event.sequence)).toEqual([1]);
  expect(events("kind=edits").items.map(event => event.sequence)).toEqual([1, 2]);
  expect(events("kind=prompts").items.map(event => event.sequence)).toEqual([0]);
  expect(events("kind=responses").items.map(event => event.sequence)).toEqual([1, 3]);
  expect(events("kind=tool&tool=Edit&errors=1").items.map(event => event.sequence)).toEqual([2]);
  expect(events("tool=Read").total).toBe(0);
  expect(events("model=model-a").items.map(event => event.sequence)).toEqual([1]);
  expect(events("cwd=%2Fsynthetic%2Fworktree").items.map(event => event.sequence)).toEqual([3]);
  expect(events("q=nonexistent").unfilteredTotal).toBe(5);
  expect(events("q=nonexistent").facets).toEqual({ tools: ["Edit"], models: ["model-a", "model-b"], directories: ["/synthetic/project", "/synthetic/worktree"], limited: false });
});

test("reasoning the API did not return leaves the conversation and thinking views but stays in the chronology", async () => {
  const setup = await fixture();
  const assistant = (content: unknown[]) => record("", { type: "assistant", message: { model: "model-a", content } });
  await setup.write("hidden", [
    record("Investigate the failure"),
    assistant([{ type: "thinking", thinking: "", signature: "signed" }]),
    assistant([{ type: "thinking", thinking: " \n", signature: "signed" }]),
    assistant([{ type: "redacted_thinking", data: "encrypted" }]),
    assistant([{ type: "thinking", thinking: "Readable progress note", signature: "signed" }]),
    assistant([{ type: "thinking", text: "Legacy text field only" }]),
    assistant([{ type: "thinking", thinking: "", signature: "signed" }, { type: "tool_use", id: "call", name: "Read", input: {} }]),
    assistant([{ type: "thinking", thinking: "", signature: "signed" }, { type: "text", text: "Final answer" }]),
    assistant([]),
  ]);
  const recorder = await setup.open();
  const session = recorder.list(new URLSearchParams()).items[0];
  const events = (query: string) => recorder.events(session.id, new URLSearchParams(query));
  expect(events("kind=all").items.map(event => event.category)).toEqual(["message", "hidden", "hidden", "hidden", "thinking", "thinking", "tool", "message", "thinking"]);
  expect(events("kind=conversation").items.map(event => event.sequence)).toEqual([0, 4, 5, 6, 7, 8]);
  expect(events("kind=thinking").items.map(event => event.sequence)).toEqual([4, 5]);
  expect(events("kind=all").total).toBe(9);
  expect(events("kind=thinking").hiddenTotal).toBe(3);
  expect(events("kind=conversation&anchor=" + encodeURIComponent(events("kind=all").items[1].id)).offset).toBe(1);
  expect(session.messageCount).toBe(2);
});

test("version 5 indexes reclassify reasoning the API did not return", async () => {
  const setup = await fixture();
  await setup.write("reclassify", [record("Prompt"), record("", { type: "assistant", message: { content: [{ type: "thinking", thinking: "", signature: "signed" }] } })]);
  const before = await setup.open();
  const session = before.list(new URLSearchParams()).items[0];
  before.db.exec("UPDATE events SET category='thinking', has_thinking=1; PRAGMA user_version=5");
  await before.close();
  const after = await setup.open();
  expect(after.events(session.id, new URLSearchParams("kind=conversation")).items.map(event => event.sequence)).toEqual([0]);
  expect(after.events(session.id, new URLSearchParams("kind=thinking")).total).toBe(0);
  expect(after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(8);
});

test("version 6 indexes clean terminal styling out of stored titles without rescanning recordings", async () => {
  const setup = await fixture();
  const styled = "Added \u001b[1mC:\\code\\app\u001b[22m as a working directory \u001b[2m· /permissions\u001b[22m";
  await setup.write("styled-title", [record(`<local-command-stdout>${styled}</local-command-stdout>`)]);
  await setup.write("named", [record("Prompt", { customTitle: "Custom  title" })]);
  const before = await setup.open();
  const sessions = before.list(new URLSearchParams()).items;
  const session = sessions.find(item => item.title.startsWith("Added"))!, named = sessions.find(item => item.title === "Custom  title")!;
  expect(session.title).toBe("Added C:\\code\\app as a working directory · /permissions");
  // Indexes written before version 7 stored the escape bytes the terminal recorded.
  before.db.query("UPDATE sessions SET title=? WHERE id=?").run(styled, session.id);
  before.db.exec("PRAGMA user_version=6");
  await before.close();
  const after = await setup.open({ scan: false });
  expect(after.getSession(session.id)?.title).toBe("Added C:\\code\\app as a working directory · /permissions");
  expect(after.getSession(named.id)?.title).toBe("Custom  title");
  expect(after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(7);
  expect(after.db.query<{ identity: string }, [string]>("SELECT identity FROM sessions WHERE id=?").get(session.id)!.identity).not.toBe("");
});

// Claude Code writes the messages an API request adds as `api-request-blob` records, without timestamps, just before the
// `api-request` record that sends them. Assistant turns and tool blocks copy other records; the hook context Claude Code
// composed for the request can appear only in its copy.
const requestBlob = (hash: string, message: unknown) => ({ type: "api-request-blob", sessionId: "synthetic", hash, message });
const apiRequest = (tail: string[]) => ({ type: "api-request", sessionId: "synthetic", id: "request", timestamp: "2026-09-20T12:00:03Z", keep: 2, tail });

function requestCopies(call: Record<string, unknown>, result: Record<string, unknown>) {
  return [
    requestBlob("hash-assistant", { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "signed" }, call, { type: "text", text: "Saltmarsh renamed" }] }),
    requestBlob("hash-user", { role: "user", content: [result] }),
    requestBlob("hash-system", { role: "system", content: [{ type: "text", text: "PreToolUse:Edit hook additional context: Saltmarsh" }] }),
    apiRequest(["hash-assistant", "hash-user", "hash-system"]),
  ];
}

test("API request message copies stay in the chronology without blocks, tool links, or copied search text", async () => {
  const setup = await fixture();
  const call = { type: "tool_use", id: "edit-call", name: "Edit", input: { file_path: "/synthetic/project/app.ts", old_string: "a", new_string: "b" } };
  const result = { type: "tool_result", tool_use_id: "edit-call", content: "Saltmarsh edit rejected", is_error: true };
  await setup.write("copies", [
    record("Rename the Saltmarsh helper"),
    record("", { type: "assistant", timestamp: "2026-09-20T12:00:01Z", message: { model: "model-a", content: [call] } }),
    record("", { timestamp: "2026-09-20T12:00:02Z", message: { content: [result] } }),
    ...requestCopies(call, result),
  ]);
  const recorder = await setup.open();
  const session = recorder.list(new URLSearchParams()).items[0];
  const events = (query: string) => recorder.events(session.id, new URLSearchParams(query));
  const all = events("kind=all");
  expect(all.total).toBe(7);
  const copies = all.items.filter(event => event.type === "api-request-blob");
  expect(copies.map(event => ({ category: event.category, blocks: event.blocks.length, tools: event.toolNames.length, error: event.error, timestamp: event.timestamp })))
    .toEqual(Array(3).fill({ category: "system", blocks: 0, tools: 0, error: false, timestamp: "" }));
  expect(copies.map(event => event.text)).toEqual(["", "", "type: text\ntext: PreToolUse:Edit hook additional context: Saltmarsh"]);
  expect(events("kind=tool").items.map(event => event.sequence)).toEqual([1, 2]);
  expect(events("kind=edits").items.map(event => event.sequence)).toEqual([1, 2]);
  expect(events("kind=all&errors=1").items.map(event => event.sequence)).toEqual([2]);
  expect(recorder.matches(session.id, new URLSearchParams("kind=all&find=Saltmarsh")).items.map(item => item.sequence)).toEqual([0, 2, 5]);
  expect([session.toolCount, session.errorCount]).toEqual([1, 1]);
  const changes = recorder.summary(session.id, new URLSearchParams("kind=all")).folders.flatMap(folder => folder.files).flatMap(file => file.changes);
  expect(changes.map(change => ({ id: change.id, timestamp: change.timestamp, error: change.error })))
    .toEqual([{ id: all.items[1].id, timestamp: "2026-09-20T12:00:01.000Z", error: true }]);
});

test("version 7 indexes re-index only the recordings that hold API request message copies", async () => {
  const setup = await fixture();
  const call = { type: "tool_use", id: "edit-call", name: "Edit", input: { file_path: "/synthetic/project/app.ts", old_string: "a", new_string: "b" } };
  const result = { type: "tool_result", tool_use_id: "edit-call", content: "Edited" };
  await setup.write("copies", [record("Copied prompt"), record("", { type: "assistant", message: { content: [call] } }), record("", { message: { content: [result] } }), ...requestCopies(call, result)]);
  await setup.write("plain", [record("Plain prompt")]);
  const before = await setup.open();
  const sessions = before.list(new URLSearchParams()).items;
  const copied = sessions.find(item => item.title === "Copied prompt")!, plain = sessions.find(item => item.title === "Plain prompt")!;
  // Indexes written before version 8 read each copy's blocks, so the copied call took over the original's tool link.
  before.db.query("UPDATE tool_calls SET event_row=(SELECT rowid FROM events WHERE session_id=? AND type='api-request-blob' ORDER BY sequence LIMIT 1)").run(copied.id);
  before.db.query("UPDATE sessions SET tools=2 WHERE id=?").run(copied.id);
  // A re-index rewrites every event of a recording, so a marked column shows which recordings it reached.
  before.db.exec("UPDATE events SET cwd='/synthetic/stale'");
  before.db.exec("PRAGMA user_version=7");
  await before.close();
  // Finding those recordings reads every event, so opening leaves it to the first scan, after the server binds its port.
  const after = await setup.open({ scan: false });
  const version = () => after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const cwds = (id: string) => after.db.query<{ cwd: string }, [string]>("SELECT DISTINCT cwd FROM events WHERE session_id=?").all(id).map(row => row.cwd);
  expect(version()).toBe(7);
  await after.scan();
  expect(version()).toBe(8);
  expect(cwds(copied.id)).not.toContain("/synthetic/stale");
  expect(cwds(plain.id)).toEqual(["/synthetic/stale"]);
  expect(after.events(copied.id, new URLSearchParams("kind=edits")).items.map(event => event.sequence)).toEqual([1, 2]);
  expect(after.getSession(copied.id)?.toolCount).toBe(1);
});

test("an API request's copies of an /add-dir command and its output add no folder", async () => {
  const setup = await fixture();
  await setup.write("add-dir-copies", [
    record("Start"),
    requestBlob("hash-command", { role: "user", content: "<command-name>/add-dir</command-name>\n<command-message>add-dir</command-message>\n<command-args>/synthetic/shared</command-args>" }),
    requestBlob("hash-output", { role: "user", content: "<local-command-stdout>Added /synthetic/shared as a working directory for this session</local-command-stdout>" }),
    apiRequest(["hash-command", "hash-output"]),
  ]);
  const recorder = await setup.open();
  const session = recorder.list(new URLSearchParams()).items[0];
  const summary = recorder.summary(session.id, new URLSearchParams("kind=all"));
  expect(summary.folders.map(folder => [folder.path, Boolean(folder.working), Boolean(folder.added)])).toEqual([["/synthetic/project", true, false]]);
});

test("full-session replay filters precede pagination and context keeps original sequence", async () => {
  const setup = await fixture();
  await setup.write("long", Array.from({ length: 175 }, (_, index) => record(`Record ${index}`, {
    type: index % 2 === 0 ? "user" : "assistant", timestamp: index === 120 ? "2026-09-19T00:00:00Z" : "2026-09-20T12:00:00Z",
  })));
  const recorder = await setup.open();
  const session = recorder.list(new URLSearchParams()).items[0];
  const events = (query: string) => recorder.events(session.id, new URLSearchParams(query));
  const hit = events("q=Record+120").items[0];
  expect(hit.sequence).toBe(120);
  expect(events(`anchor=${hit.id}`).items[0].sequence).toBe(120);
  const context = events(`anchor=${hit.id}&context=1`);
  expect(context.items[0].sequence).toBe(112);
  expect(context.items[8].id).toBe(hit.id);
  expect(events("kind=responses&limit=10&offset=60").items[0].sequence).toBe(121);
  expect(events("before=2026-09-19").items[0].sequence).toBe(120);
  expect(events("offset=999999").items.at(-1)?.sequence).toBe(174);
});

test("version 4 indexes backfill investigation fields without changing source or bookmarks", async () => {
  const setup = await fixture();
  const source = await setup.write("migration", [record("Migrate"), record("", { type: "assistant", message: { model: "old-model", content: [{ type: "thinking", thinking: "Reason" }, { type: "tool_use", id: "call", name: "Read", input: {} }] } })]);
  const original = await Bun.file(source).text();
  const before = await setup.open();
  const session = before.list(new URLSearchParams()).items[0];
  before.bookmark(session.id, true);
  before.db.exec("DROP TABLE tool_calls; DROP INDEX events_model; DROP INDEX events_timestamp; DROP INDEX events_cwd;");
  for (const column of ["role", "timestamp", "model", "cwd", "has_thinking", "has_tools"]) before.db.exec(`ALTER TABLE events DROP COLUMN ${column}`);
  before.db.exec("PRAGMA user_version=4");
  await before.close();
  const after = await setup.open();
  expect(after.events(session.id, new URLSearchParams("kind=thinking&model=old-model")).total).toBe(1);
  expect(after.getSession(session.id)?.bookmarked).toBe(true);
  expect(await Bun.file(source).text()).toBe(original);
  await appendFile(source, JSON.stringify(record("", { message: { content: [{ type: "tool_result", tool_use_id: "call", content: "New result" }] } })) + "\n");
  await after.scan();
  expect(after.events(session.id, new URLSearchParams("tool=Read")).total).toBe(2);
  await writeFile(source, JSON.stringify(record("Replaced")) + "\n");
  await after.scan();
  expect(after.events(session.id, new URLSearchParams("tool=Read")).total).toBe(0);
  expect(after.db.query("SELECT * FROM tool_calls").all()).toEqual([]);
});

test("numeric and date bounds reject malformed and impossible values and out-of-range offsets", () => {
  expect(numericBound("0")).toBe(0);
  expect(numericBound(".25")).toBe(0.25);
  for (const value of ["", "-1", "NaN", "Infinity", "1e9", "0x10", "9007199254740992"]) expect(numericBound(value)).toBeNull();
  expect(numericBound("1.5", true)).toBeNull();
  expect(dateBound("2026-09-20", true)).toBe("2026-09-20T23:59:59.999Z");
  expect(dateBound("2026-02-30")).toBeNull();
  expect(dateBound("2026-02-30T12:00:00Z")).toBeNull();
  expect(dateBound("2026-09-20T12:00:00")).toBeNull();
  expect(dateBound("2026-09-20T12:00:00+02:00")).toBe("2026-09-20T10:00:00.000Z");
  expect(dateBound("yesterday")).toBeNull();
  expect(dateBound("2026-09-20", false, "120")).toBe("2026-09-19T22:00:00.000Z");
  expect(dateBound("2026-09-20", true, "120")).toBe("2026-09-20T21:59:59.999Z");
  expect(dateBound("2026-09-20", false, "-330")).toBe("2026-09-20T05:30:00.000Z");
  expect(dateBound("2026-09-20", true, "-840")).toBe("2026-09-21T13:59:59.999Z");
  expect(dateBound("2026-09-20", false, "840")).toBe("2026-09-19T10:00:00.000Z");
  expect(dateBound("2026-02-30", false, "120")).toBeNull();
  expect(dateBound("2026-09-20T12:00:00Z", false, "120")).toBe("2026-09-20T12:00:00.000Z");
  for (const offset of ["", "841", "-900", "1.5", "60m", " 60", "1e2", "abc", "0x10"]) {
    expect(dateBound("2026-09-20", false, offset)).toBe("2026-09-20T00:00:00.000Z");
    expect(dateBound("2026-09-20", true, offset)).toBe("2026-09-20T23:59:59.999Z");
  }
  expect(withSelectedOption(["Read", "Write"], "Custom")).toEqual(["Custom", "Read", "Write"]);
  expect(withSelectedOption(["Read", "Write"], "Read")).toEqual(["Read", "Write"]);
});

test("investigation sorts rank recorded span, failures, tool calls and titles deterministically", async () => {
  const setup = await fixture();
  await setup.write("alpha", [record("Alpha"), record("Ended", { timestamp: "2026-09-21T12:00:00Z" })]);
  await setup.write("beta", [record("Beta"), record("", { type: "assistant", message: { content: [
    { type: "tool_use", id: "first", name: "Read" }, { type: "tool_use", id: "second", name: "Write" },
  ] } })]);
  await setup.write("gamma", [record("Gamma", { is_error: true })]);
  const recorder = await setup.open();
  const first = (sort: string) => recorder.list(new URLSearchParams({ sort, limit: "1" })).items[0].title;
  expect(first("duration")).toBe("Alpha");
  expect(first("errors")).toBe("Gamma");
  expect(first("tools")).toBe("Beta");
  expect(first("title")).toBe("Alpha");
  const list = recorder.list(new URLSearchParams("sort=activity&limit=1&offset=1"));
  expect(list.items[0].title).toBe("Beta");
  expect(list.total).toBe(3);
});

test("facet queries reuse bounded caches and index changes invalidate only changed recordings", async () => {
  const setup = await fixture();
  const source = await setup.write("first", [record("First"), request("first", 1, "model-a")]);
  await setup.write("second", [record("Second"), request("second", 1, "model-b")]);
  const recorder = await setup.open();
  const sessions = recorder.list(new URLSearchParams("sort=title")).items;
  const query = spyOn(recorder.db, "query");
  const facetQueries = () => query.mock.calls.filter(([sql]) => sql.includes("SELECT DISTINCT value FROM session_facets")).length;
  try {
    await recorder.catalog();
    recorder.events(sessions[0].id, new URLSearchParams());
    recorder.events(sessions[1].id, new URLSearchParams());
    const initial = facetQueries();
    recorder.bookmark(sessions[0].id, true);
    await recorder.catalog();
    recorder.events(sessions[0].id, new URLSearchParams("q=absent"));
    expect(facetQueries()).toBe(initial);
    await appendFile(source, JSON.stringify(request("new", 1, "model-new")) + "\n");
    await recorder.scan();
    recorder.events(sessions[1].id, new URLSearchParams());
    expect(facetQueries()).toBe(initial);
    expect((await recorder.catalog()).models).toContain("model-new");
    expect(recorder.events(sessions[0].id, new URLSearchParams()).facets.models).toContain("model-new");
    expect(facetQueries()).toBe(initial + 5);
    await writeFile(source, JSON.stringify(record("Replacement")) + "\n");
    await recorder.scan();
    expect((await recorder.catalog()).models).toEqual(["model-b"]);
    expect(recorder.events(sessions[0].id, new URLSearchParams()).facets.models).toEqual([]);
  } finally { query.mockRestore(); }
});

test("facets bound untrusted metadata without rewriting raw records or inventing tool names", async () => {
  const setup = await fixture();
  const records = Array.from({ length: 230 }, (_, index) => record("", { type: "assistant", message: {
    model: `model-${String(index).padStart(3, "0")}`, content: [{ type: "tool_use", id: `call-${index}`, name: `Tool-${String(index).padStart(3, "0")}`, input: {} }],
  } }));
  records.push(record("", { type: "assistant", message: { model: "x".repeat(1000), content: [
    { type: "tool_use", id: "malformed", name: "Read\nWrite" }, { type: "tool_use", id: "oversized", name: "X".repeat(1000) },
  ] } }));
  const source = await setup.write("bounded", records);
  const original = await Bun.file(source).text();
  const recorder = await setup.open();
  const catalog = await recorder.catalog();
  expect(catalog.models).toHaveLength(200);
  expect(catalog.toolsUsed).toHaveLength(200);
  expect(catalog.facetsLimited).toBe(true);
  expect(catalog.toolsUsed).not.toContain("Read");
  expect(recorder.list(new URLSearchParams("tool=Read")).total).toBe(0);
  expect(recorder.list(new URLSearchParams({ tool: "Read\nWrite" })).total).toBe(0);
  const session = recorder.list(new URLSearchParams()).items[0];
  const events = recorder.events(session.id, new URLSearchParams());
  expect(events.facets.limited).toBe(true);
  expect(events.facets.tools).toHaveLength(200);
  expect(recorder.events(session.id, new URLSearchParams({ tool: "Read\nWrite" })).total).toBe(0);
  expect(recorder.events(session.id, new URLSearchParams("tool=Tool-229")).total).toBe(1);
  expect(recorder.events(session.id, new URLSearchParams("q=malformed")).items[0].toolNames).toContain("Read\nWrite");
  expect(await Bun.file(source).text()).toBe(original);
});

test("literal missing-effort text never aliases the separate missing-data filter", async () => {
  const setup = await fixture();
  await setup.write("missing", [record("Missing"), request("missing", 1)]);
  await setup.write("literal", [record("Literal"), request("literal", 1, "unknown-model", "__missing__")]);
  const recorder = await setup.open();
  expect(recorder.list(new URLSearchParams("effort=__missing__")).items.map(session => session.title)).toEqual(["Literal"]);
  expect(recorder.list(new URLSearchParams("effortMissing=1")).items.map(session => session.title)).toEqual(["Missing"]);
  expect(recorder.list(new URLSearchParams("effortMissing=1&effort=__missing__")).total).toBe(0);
  expect((await recorder.catalog()).efforts).toEqual(["__missing__"]);
});

// 23:30 on Tuesday 13 October and 00:30 on Wednesday in a +02:00 zone, which are both Tuesday in UTC.
const lateTuesday = "2026-10-13T21:30:00Z", earlyWednesday = "2026-10-13T22:30:00Z";
const localDay = (date: string, offset = "120") => `after=${date}&before=${date}&afterTz=${offset}&beforeTz=${offset}`;
const invalidOffsets = ["abc", "900", "-841", "1.5", ""];

test("library date bounds fall on the reader's local calendar days", async () => {
  const setup = await fixture();
  await setup.write("tuesday", [record("Late Tuesday", { timestamp: lateTuesday })]);
  await setup.write("wednesday", [record("Early Wednesday", { timestamp: earlyWednesday })]);
  const recorder = await setup.open();
  const titles = (query: string) => recorder.list(new URLSearchParams(query)).items.map(session => session.title).sort();
  expect(titles(localDay("2026-10-13"))).toEqual(["Late Tuesday"]);
  expect(titles(localDay("2026-10-14"))).toEqual(["Early Wednesday"]);
  expect(titles("after=2026-10-14&afterTz=120")).toEqual(["Early Wednesday"]);
  expect(titles("before=2026-10-13&beforeTz=120")).toEqual(["Late Tuesday"]);
  expect(titles(localDay("2026-10-13", "-240"))).toEqual(["Early Wednesday", "Late Tuesday"]);
  expect(titles("after=2026-10-13&before=2026-10-13")).toEqual(["Early Wednesday", "Late Tuesday"]);
  for (const offset of invalidOffsets) {
    expect(titles(localDay("2026-10-13", offset))).toEqual(["Early Wednesday", "Late Tuesday"]);
    expect(titles(localDay("2026-10-14", offset))).toEqual([]);
  }
});

test("replay date bounds fall on local days for records, the timeline, and find matches", async () => {
  const setup = await fixture();
  await setup.write("midnight", [
    record("Monday day prompt", { timestamp: "2026-10-12T10:00:00Z" }),
    record("Late Tuesday day prompt", { timestamp: lateTuesday }),
    record("Early Wednesday day prompt", { timestamp: earlyWednesday }),
  ]);
  const recorder = await setup.open();
  const id = recorder.list(new URLSearchParams()).items[0].id;
  const sequences = (query: string) => recorder.events(id, new URLSearchParams(`kind=all&${query}`)).items.map(event => event.sequence);
  const timeline = (query: string) => {
    const result = recorder.timeline(id, new URLSearchParams(`kind=all&${query}`));
    return result.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  };
  const matches = (query: string) => recorder.matches(id, new URLSearchParams(`kind=all&find=day&${query}`)).items.map(match => match.sequence);
  expect(sequences(localDay("2026-10-13"))).toEqual([1]);
  expect(sequences(localDay("2026-10-14"))).toEqual([2]);
  expect(timeline(localDay("2026-10-13"))).toBe(1);
  expect(timeline(localDay("2026-10-14"))).toBe(1);
  expect(matches(localDay("2026-10-13"))).toEqual([1]);
  expect(matches(localDay("2026-10-14"))).toEqual([2]);
  expect(sequences("after=2026-10-13&afterTz=120")).toEqual([1, 2]);
  expect(sequences("before=2026-10-13&beforeTz=120")).toEqual([0, 1]);
  for (const offset of invalidOffsets) {
    expect(sequences(localDay("2026-10-13", offset))).toEqual([1, 2]);
    expect(timeline(localDay("2026-10-13", offset))).toBe(2);
    expect(matches(localDay("2026-10-13", offset))).toEqual([1, 2]);
    expect(sequences(localDay("2026-10-14", offset))).toEqual([]);
  }
});
