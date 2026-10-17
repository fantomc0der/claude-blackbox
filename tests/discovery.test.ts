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
  expect(after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(17);
});

test("version 6 indexes clean terminal styling out of stored titles without rescanning recordings", async () => {
  const setup = await fixture();
  const styled = "Added \u001b[1mC:\\code\\app\u001b[22m as a working directory \u001b[2m· /permissions\u001b[22m";
  await setup.write("styled-title", [record(styled)]);
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
  expect(version()).toBe(17);
  expect(cwds(copied.id)).not.toContain("/synthetic/stale");
  expect(cwds(plain.id)).toEqual(["/synthetic/stale"]);
  expect(after.events(copied.id, new URLSearchParams("kind=edits")).items.map(event => event.sequence)).toEqual([1, 2]);
  expect(after.getSession(copied.id)?.toolCount).toBe(1);
});

// When an API request fails for good, Claude Code records the failure itself as an `assistant` record marked
// `isApiErrorMessage` with the error kind and HTTP status, the `<synthetic>` model, and zero usage. It writes other
// stand-ins, such as `No response requested.`, the same way without the error marks.
const standIn = (uuid: string, parentUuid: string, timestamp: string, text: string, extra: Record<string, unknown> = {}) => ({
  type: "assistant", uuid, parentUuid, timestamp, cwd: "/synthetic/project", sessionId: "s1", ...extra,
  message: { id: `synthetic-${uuid}`, model: "<synthetic>", role: "assistant", type: "message", stop_reason: "stop_sequence", content: [{ type: "text", text }],
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
});
const apiErrorText = 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
const apiError = (uuid: string, parentUuid: string, timestamp: string) => standIn(uuid, parentUuid, timestamp, apiErrorText, { isApiErrorMessage: true, error: "rate_limit", apiError: { status: 529 } });

test("API error turns and other Claude Code stand-ins count as errors, never as Claude responses", async () => {
  const setup = await fixture();
  await setup.write("failed", [
    { type: "user", uuid: "u1", parentUuid: null, timestamp: "2026-10-17T10:00:00Z", cwd: "/synthetic/project", sessionId: "s1", message: { role: "user", content: "Fix the flaky login test" } },
    apiError("a1", "u1", "2026-10-17T10:00:05Z"),
    standIn("a2", "a1", "2026-10-17T10:00:06Z", "No response requested."),
    { type: "assistant", uuid: "a3", parentUuid: "a2", timestamp: "2026-10-17T10:00:07Z", cwd: "/synthetic/project", sessionId: "s1",
      message: { id: "m1", model: "model-a", role: "assistant", content: [{ type: "text", text: "Login test fixed" }], usage: { input_tokens: 10, output_tokens: 5 } } },
  ]);
  const recorder = await setup.open();
  const session = recorder.list(new URLSearchParams()).items[0];
  const events = (query: string) => recorder.events(session.id, new URLSearchParams(query));
  expect([session.messageCount, session.errorCount, session.usage.requests, session.model]).toEqual([2, 1, 1, "model-a"]);
  const all = events("kind=all");
  expect(all.items.map(event => [event.role, event.category, event.error])).toEqual([["user", "message", false], ["assistant", "synthetic", true], ["assistant", "synthetic", false], ["assistant", "message", false]]);
  expect(all.items[1].blocks).toEqual([{ type: "text", text: apiErrorText }]);
  expect(events("kind=conversation").items.map(event => event.sequence)).toEqual([0, 1, 2, 3]);
  expect(events("kind=responses").items.map(event => event.sequence)).toEqual([3]);
  expect(events("kind=all&errors=1").items.map(event => event.sequence)).toEqual([1]);
  expect(recorder.timeline(session.id, new URLSearchParams("kind=all")).buckets.map(bucket => bucket.errors)).toEqual([1]);
  expect(recorder.list(new URLSearchParams("errors=1")).items.map(item => item.id)).toEqual([session.id]);
  expect(recorder.list(new URLSearchParams("q=Overloaded")).items[0]).toMatchObject({ matchCategory: "synthetic", matchRole: "assistant" });
  const catalog = await recorder.catalog();
  expect([catalog.messages, catalog.errors]).toEqual([2, 1]);
});

test("version 10 indexes re-index only the recordings that hold Claude Code's stand-ins", async () => {
  const setup = await fixture();
  await setup.write("failed", [record("Failed prompt"), apiError("a1", "u1", "2026-09-20T12:00:05Z")]);
  await setup.write("quiet", [record("Quiet prompt"), standIn("a2", "u2", "2026-09-20T12:00:05Z", "No response requested.")]);
  await setup.write("plain", [record("Plain prompt"), record("Reply", { type: "assistant", message: { model: "model-a", content: "Reply" } })]);
  const before = await setup.open();
  const sessions = before.list(new URLSearchParams()).items;
  const named = (title: string) => sessions.find(item => item.title === title)!;
  const failed = named("Failed prompt"), quiet = named("Quiet prompt"), plain = named("Plain prompt");
  // Indexes written before version 11 read a stand-in as a reply with no error flag.
  before.db.exec("UPDATE events SET category='message', error=0 WHERE type='assistant' AND model='<synthetic>'");
  before.db.query("UPDATE sessions SET messages=2, errors=0 WHERE id IN (?,?)").run(failed.id, quiet.id);
  // A re-index rewrites every event of a recording, so a marked column shows which recordings it reached.
  before.db.exec("UPDATE events SET cwd='/synthetic/stale'");
  before.db.exec("PRAGMA user_version=10");
  await before.close();
  const after = await setup.open({ scan: false });
  const version = () => after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const counts = (id: string) => { const session = after.getSession(id)!; return [session.messageCount, session.errorCount]; };
  const cwds = (id: string) => after.db.query<{ cwd: string }, [string]>("SELECT DISTINCT cwd FROM events WHERE session_id=?").all(id).map(row => row.cwd);
  expect(version()).toBe(10);
  expect([counts(failed.id), counts(quiet.id)]).toEqual([[2, 0], [2, 0]]);
  await after.scan();
  expect(version()).toBe(17);
  expect([counts(failed.id), counts(quiet.id)]).toEqual([[1, 1], [1, 0]]);
  expect(after.events(failed.id, new URLSearchParams("kind=all&errors=1")).items.map(event => event.sequence)).toEqual([1]);
  expect(after.events(quiet.id, new URLSearchParams("kind=all")).items.map(event => event.category)).toEqual(["message", "synthetic"]);
  expect(cwds(failed.id)).not.toContain("/synthetic/stale");
  expect(cwds(quiet.id)).not.toContain("/synthetic/stale");
  expect(cwds(plain.id)).toEqual(["/synthetic/stale"]);
});

test("version 8 indexes retitle recordings by Claude Code's first-prompt rules without rescanning them", async () => {
  const setup = await fixture();
  const command = (name: string, args: string) => `<command-name>${name}</command-name>\n<command-message>${name.slice(1)}</command-message>\n<command-args>${args}</command-args>`;
  const opened = "<ide_opened_file>The user opened the file /synthetic/project/upload.ts in the IDE. This may or may not be related to the current task.</ide_opened_file>";
  await setup.write("command-first", [record(command("/clear", "")), record("<local-command-stdout></local-command-stdout>"), record("Add retries to the upload client")]);
  await setup.write("ide-first", [record(opened), record("Why does the upload client hang?")]);
  await setup.write("review", [record(command("/review", "PR 12")), record("Looks fine")]);
  await setup.write("output-only", [record("<local-command-stdout>Added /synthetic/shared as a working directory for this session</local-command-stdout>")]);
  await setup.write("named", [record(command("/clear", "")), record("Prompt", { customTitle: "Custom title" })]);
  await setup.write("plain", [record("Plain prompt")]);
  const before = await setup.open();
  const id = (title: string) => before.list(new URLSearchParams()).items.find(item => item.title === title)!.id;
  const ids = { commandFirst: id("Add retries to the upload client"), ideFirst: id("Why does the upload client hang?"), review: id("/review PR 12"),
    outputOnly: id("Session output-o"), named: id("Custom title"), plain: id("Plain prompt") };
  before.bookmark(ids.commandFirst, true);
  // Indexes written before version 9 titled a recording from the first user record with any text, tags removed.
  const retitle = before.db.query("UPDATE sessions SET title=? WHERE id=?");
  retitle.run("/clear clear", ids.commandFirst);
  retitle.run("The user opened the file /synthetic/project/upload.ts in the IDE. This may or may not be related to the current task.", ids.ideFirst);
  retitle.run("/review review PR 12", ids.review);
  retitle.run("Added /synthetic/shared as a working directory for this session", ids.outputOnly);
  // A re-index rewrites every event of a recording, so a marked column shows which recordings were re-read: only the one
  // already marked for re-reading, which gets its title from that read instead of in place.
  before.db.exec("UPDATE events SET cwd='/synthetic/stale'");
  before.db.query("UPDATE sessions SET mtime=0, identity='' WHERE id=?").run(ids.review);
  before.db.exec("PRAGMA user_version=8");
  await before.close();
  // Retitling reads stored records, so opening leaves it to the first scan, after the server binds its port.
  const after = await setup.open({ scan: false });
  const version = () => after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const titles = () => Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, after.getSession(id)!.title]));
  const cwds = (id: string) => after.db.query<{ cwd: string }, [string]>("SELECT DISTINCT cwd FROM events WHERE session_id=?").all(id).map(row => row.cwd);
  expect(version()).toBe(8);
  expect(titles().commandFirst).toBe("/clear clear");
  await after.scan();
  expect(version()).toBe(17);
  expect(titles()).toEqual({ commandFirst: "Add retries to the upload client", ideFirst: "Why does the upload client hang?", review: "/review PR 12",
    outputOnly: "Session output-o", named: "Custom title", plain: "Plain prompt" });
  for (const id of [ids.commandFirst, ids.ideFirst, ids.outputOnly, ids.named, ids.plain]) expect(cwds(id)).toEqual(["/synthetic/stale"]);
  expect(cwds(ids.review)).toEqual(["/synthetic/project"]);
  expect(after.getSession(ids.commandFirst)?.bookmarked).toBe(true);
});

const denial = "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.";
const toolResult = (id: string, content: string, is_error = true) => record("", { message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });

test("version 11 indexes re-index only the recordings whose errors need telling apart from decisions", async () => {
  const setup = await fixture();
  await setup.write("denied", [record("Clean the install"), toolResult("rm-call", denial)]);
  await setup.write("failed", [record("Run the tests"), toolResult("test-call", "1 fail")]);
  await setup.write("plain", [record("Plain prompt")]);
  const before = await setup.open();
  const sessions = Object.fromEntries(before.list(new URLSearchParams()).items.map(session => [session.title, session.id]));
  // Indexes written before version 12 flagged every `is_error` result as an error.
  before.db.query("UPDATE events SET error=1, decision=0 WHERE session_id=?").run(sessions["Clean the install"]);
  before.db.query("UPDATE sessions SET errors=1 WHERE id=?").run(sessions["Clean the install"]);
  // A re-index rewrites every event of a recording, so a marked column shows which recordings it reached.
  before.db.exec("UPDATE events SET cwd='/synthetic/stale'");
  before.db.exec("PRAGMA user_version=11");
  await before.close();
  const after = await setup.open({ scan: false });
  const version = () => after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const cwds = (id: string) => after.db.query<{ cwd: string }, [string]>("SELECT DISTINCT cwd FROM events WHERE session_id=?").all(id).map(row => row.cwd);
  expect(version()).toBe(11);
  expect(after.getSession(sessions["Clean the install"])?.errorCount).toBe(1);
  await after.scan();
  expect(version()).toBe(17);
  for (const title of ["Clean the install", "Run the tests"]) expect(cwds(sessions[title])).toEqual(["/synthetic/project"]);
  expect(cwds(sessions["Plain prompt"])).toEqual(["/synthetic/stale"]);
  expect(after.getSession(sessions["Clean the install"])?.errorCount).toBe(0);
  expect(after.getSession(sessions["Run the tests"])?.errorCount).toBe(1);
  expect(after.events(sessions["Clean the install"], new URLSearchParams("kind=all&errors=1")).items.map(event => [event.sequence, event.error, event.decision])).toEqual([[1, false, "cancelled"]]);
});

// Claude Code 2.1.30x files a decided result's kind as `toolDenialKind` on the record that holds it.
const kinded = (id: string, content: string, toolDenialKind: string) => record("", { toolDenialKind, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: true }] } });
const skipped = "[Tool call skipped: the turn ended to deliver the message that follows before this call ran. Nothing refused it; re-run it if still needed.]";

test("version 16 indexes re-index only the recordings whose results Claude Code filed by kind or version 17 first reads as decisions", async () => {
  const setup = await fixture();
  await setup.write("kinded", [record("Deploy the release"), kinded("deploy-call", "Deploys are frozen until Monday.", "permission-rule")]);
  await setup.write("skipped", [record("Run the batch"), toolResult("batch-call", skipped)]);
  await setup.write("cancelled", [record("Clean the install"), toolResult("rm-call", denial)]);
  await setup.write("failed", [record("Run the tests"), toolResult("test-call", "1 fail")]);
  const before = await setup.open();
  const sessions = Object.fromEntries(before.list(new URLSearchParams()).items.map(session => [session.title, session.id]));
  before.bookmark(sessions["Deploy the release"], true);
  // Indexes written before version 17 read no kind, so a rule's denial in its own words, and a skipped call, were failures,
  // and the stored result kept no kind.
  for (const title of ["Deploy the release", "Run the batch"]) {
    before.db.query("UPDATE events SET error=1, decision=0 WHERE session_id=? AND sequence=1").run(sessions[title]);
    before.db.query("UPDATE sessions SET errors=1 WHERE id=?").run(sessions[title]);
  }
  before.db.exec("UPDATE tool_results SET raw=json_remove(raw,'$.toolDenialKind')");
  // A re-index rewrites every event of a recording, so a marked column shows which recordings it reached.
  before.db.exec("UPDATE events SET cwd='/synthetic/stale'");
  before.db.exec("PRAGMA user_version=16");
  await before.close();
  const after = await setup.open({ scan: false });
  const version = () => after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const cwds = (id: string) => after.db.query<{ cwd: string }, [string]>("SELECT DISTINCT cwd FROM events WHERE session_id=?").all(id).map(row => row.cwd);
  const decided = (title: string) => after.events(sessions[title], new URLSearchParams("kind=all&errors=1")).items.map(event => [event.error, event.decision]);
  expect(version()).toBe(16);
  expect(after.getSession(sessions["Deploy the release"])?.errorCount).toBe(1);
  await after.scan();
  expect(version()).toBe(17);
  for (const title of ["Deploy the release", "Run the batch"]) expect(cwds(sessions[title])).toEqual(["/synthetic/project"]);
  // A decision an earlier build recognized keeps its flag and takes its new label from the stored record, unread.
  for (const title of ["Clean the install", "Run the tests"]) expect(cwds(sessions[title])).toEqual(["/synthetic/stale"]);
  expect(["Deploy the release", "Run the batch", "Clean the install", "Run the tests"].map(title => after.getSession(sessions[title])?.errorCount)).toEqual([0, 0, 0, 1]);
  expect(["Deploy the release", "Run the batch", "Clean the install", "Run the tests"].map(decided)).toEqual([[[false, "denied"]], [[false, "cancelled"]], [[false, "cancelled"]], [[true, null]]]);
  expect(after.results(sessions["Deploy the release"], ["deploy-call"])["deploy-call"]).toMatchObject({ is_error: true, toolDenialKind: "permission-rule" });
  expect(after.getSession(sessions["Deploy the release"])?.bookmarked).toBe(true);
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

// Claude Code 2.1.30x keeps its own session state in the recording: `last-prompt` and `atis-latch` after every turn,
// without timestamps, a timestamped `queue-operation` when a prompt is queued, and settings such as `cost-state`. The
// first two copy the prompt a user record holds.
const sessionState = (type: string, fields: Record<string, unknown> = {}) => ({ type, sessionId: "synthetic", ...fields });
const turnState = (prompt: string) => [sessionState("last-prompt", { lastPrompt: prompt, leafUuid: "leaf" }), sessionState("atis-latch", { atis: "" })];

test("session state records index as notes without blocks or their copies of the prompt", async () => {
  const setup = await fixture();
  const prompt = "Rename the Saltmarsh helper";
  await setup.write("state", [
    sessionState("queue-operation", { operation: "enqueue", timestamp: "2026-09-20T11:59:59Z", content: prompt }),
    record(prompt),
    record("", { type: "assistant", timestamp: "2026-09-20T12:00:01Z", message: { model: "model-a", content: [{ type: "text", text: "Renaming it now" }] } }),
    ...turnState(prompt),
    sessionState("cost-state", { totalCostUSD: 0.42, totalInputTokens: 1200 }),
    sessionState("permission-mode", { mode: "acceptEdits" }),
    record("", { type: "assistant", timestamp: "2026-09-20T12:00:02Z", message: { model: "model-a", content: [{ type: "text", text: "Done" }] } }),
    ...turnState(prompt),
  ]);
  await setup.write("plain", [record("Saltmarsh plain prompt")]);
  const recorder = await setup.open();
  const session = recorder.list(new URLSearchParams()).items.find(item => item.title === prompt)!;
  const all = recorder.events(session.id, new URLSearchParams("kind=all"));
  expect(all.total).toBe(10);
  const state = all.items.filter(event => event.type !== "user" && event.type !== "assistant");
  expect(state.map(event => [event.type, event.category, event.role, event.blocks.length, event.timestamp])).toEqual([
    ["queue-operation", "system", "system", 0, "2026-09-20T11:59:59.000Z"],
    ["last-prompt", "system", "system", 0, ""], ["atis-latch", "system", "system", 0, ""],
    ["cost-state", "system", "system", 0, ""], ["permission-mode", "system", "system", 0, ""],
    ["last-prompt", "system", "system", 0, ""], ["atis-latch", "system", "system", 0, ""],
  ]);
  // The prompt copies are left out of the searchable text; the rest of each record, and the whole raw record, stay.
  expect(state.map(event => event.text.includes("Saltmarsh"))).toEqual(Array(7).fill(false));
  expect(state[0].text).toBe("type: queue-operation\nsessionId: synthetic\noperation: enqueue\ntimestamp: 2026-09-20T11:59:59Z");
  expect(state[4].text).toBe("type: permission-mode\nsessionId: synthetic\nmode: acceptEdits");
  expect(state[1].raw.lastPrompt).toBe(prompt);
  expect(recorder.matches(session.id, new URLSearchParams("kind=all&find=Saltmarsh")).items.map(item => item.sequence)).toEqual([1]);
  expect(recorder.matches(session.id, new URLSearchParams("kind=all&find=acceptEdits")).items.map(item => item.sequence)).toEqual([6]);
  expect(recorder.events(session.id, new URLSearchParams("kind=conversation")).items.map(event => event.sequence)).toEqual([1, 2, 7]);
  // Library search ranks the prompt itself, so the replay opens on Conversation at the prompt rather than at a note.
  const hit = recorder.list(new URLSearchParams("q=Saltmarsh")).items.find(item => item.id === session.id)!;
  expect([hit.matchEventId, hit.matchCategory, hit.matchRole, hit.snippet]).toEqual([all.items[1].id, "message", "user", prompt]);
  // Every record still counts as a record, as it does for API request copies; messages and tools count the transcript.
  expect([session.eventCount, session.messageCount, session.toolCount]).toEqual([10, 3, 0]);
  expect([session.startedAt, session.updatedAt]).toEqual(["2026-09-20T11:59:59.000Z", "2026-09-20T12:00:02.000Z"]);
});

// Claude Code names the version that wrote a record on its transcript records. A newer Claude Code may write a record
// type, a `system` subtype, or an `attachment` type this build does not know, and its type can be any string.
const formatRecords = () => [
  record("Check the recording format", { version: "2.1.296" }),
  sessionState("file-history-snapshot", { messageId: "m1", snapshot: { messageId: "m1", trackedFileBackups: {} }, isSnapshotUpdate: false }),
  sessionState("summary", { summary: "Earlier work on the Larkspur parser", leafUuid: "leaf" }),
  record("", { type: "assistant", version: "2.1.302", timestamp: "2026-09-20T12:00:01Z", message: { model: "model-a", content: [{ type: "text", text: "Checked" }] } }),
  sessionState("future-record", { version: "2.1.302", content: "Pinecrest arrives in a future record" }),
  sessionState("system", { subtype: "future_notice", version: "2.1.302", timestamp: "2026-09-20T12:00:02Z", content: "A notice from a newer Claude Code", level: "info" }),
  sessionState("attachment", { version: "2.1.302", timestamp: "2026-09-20T12:00:03Z", attachment: { type: "future_reminder" } }),
  sessionState("Rename the helper"),
  sessionState("system", { subtype: "turn_duration", durationMs: 1000, version: "latest", timestamp: "2026-09-20T12:00:04Z" }),
];

test("records are filed by Claude Code's policy, unrecognized kinds are counted, and the Claude Code version is indexed", async () => {
  const setup = await fixture();
  const formats = await setup.write("formats", formatRecords());
  await setup.write("plain", [record("Plain prompt", { version: "2.1.278" })]);
  const recorder = await setup.open();
  const session = (name: string) => recorder.list(new URLSearchParams()).items.find(item => item.source.endsWith(`${name}.jsonl`))!;
  const checked = session("formats");
  // The last version named wins, as the model does, and a value without the shape of a version is ignored.
  expect([checked.version, checked.unrecognizedCount, session("plain").version, session("plain").unrecognizedCount]).toEqual(["2.1.302", 4, "2.1.278", 0]);
  // Bookkeeping and state add no blocks, messages, or tool calls; unrecognized records keep their system cards.
  const all = recorder.events(checked.id, new URLSearchParams("kind=all"));
  expect(all.items.map(event => [event.type, event.category, event.blocks.length])).toEqual([
    ["user", "message", 1], ["file-history-snapshot", "system", 0], ["summary", "system", 0], ["assistant", "message", 1],
    ["future-record", "system", 1], ["system", "system", 1], ["attachment", "system", 0], ["Rename the helper", "system", 0], ["system", "system", 0],
  ]);
  expect([checked.eventCount, checked.messageCount, checked.toolCount]).toEqual([9, 2, 0]);
  expect(recorder.events(checked.id, new URLSearchParams("kind=conversation")).items.map(event => event.sequence)).toEqual([0, 3]);
  expect(all.items[4].text).toContain("Pinecrest");
  // A `summary` exists nowhere else, so its text stays searchable.
  expect(all.items[2].text).toContain("Larkspur");
  expect(recorder.list(new URLSearchParams("q=Larkspur")).items.map(item => item.id)).toEqual([checked.id]);
  // Only kinds with the shape of an identifier are named; the record whose type is free text still counts.
  const catalog = await recorder.catalog();
  expect([catalog.versions, catalog.unrecognizedRecords, catalog.unrecognizedKinds]).toEqual([
    ["2.1.302", "2.1.296", "2.1.278"], 4, ["attachment:future_reminder", "system:future_notice", "type:future-record"],
  ]);
  const matching = (version: string) => recorder.list(new URLSearchParams({ version })).items.map(item => item.id);
  expect([matching("2.1.296"), matching("2.1.278"), matching("latest")]).toEqual([[checked.id], [session("plain").id], []]);
  // An appended record adds to the count, and a newer version replaces the stored one.
  await appendFile(formats, JSON.stringify(sessionState("future-record", { version: "2.1.303" })) + "\n");
  await recorder.scan();
  expect(recorder.getSession(checked.id)).toMatchObject({ version: "2.1.303", unrecognizedCount: 5 });
  expect((await recorder.catalog()).versions[0]).toBe("2.1.303");
});

test("version 12 indexes re-index only the recordings that hold Claude Code's running total", async () => {
  const setup = await fixture();
  await setup.write("costed", [record("Price the work"), sessionState("cost-state", { totalCostUSD: 1.27, modelUsage: { "claude-opus-5[1m]": { outputTokens: 300, costUSD: 1.27 } } })]);
  await setup.write("plain", [record("Plain prompt")]);
  const before = await setup.open();
  const sessions = Object.fromEntries(before.list(new URLSearchParams()).items.map(session => [session.title, session.id]));
  before.bookmark(sessions["Price the work"], true);
  // Indexes written before version 13 kept no `session_costs` table.
  before.db.exec("DROP TABLE session_costs");
  // A re-index rewrites every event of a recording, so a marked column shows which recordings it reached.
  before.db.exec("UPDATE events SET cwd='/synthetic/stale'");
  before.db.exec("PRAGMA user_version=12");
  await before.close();
  const after = await setup.open({ scan: false });
  const version = () => after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const cwds = (id: string) => after.db.query<{ cwd: string }, [string]>("SELECT DISTINCT cwd FROM events WHERE session_id=?").all(id).map(row => row.cwd);
  expect(version()).toBe(12);
  expect(after.getSession(sessions["Price the work"])?.recordedCost).toBeNull();
  await after.scan();
  expect(version()).toBe(17);
  expect(cwds(sessions["Price the work"]).sort()).toEqual(["", "/synthetic/project"]);
  expect(cwds(sessions["Plain prompt"])).toEqual(["/synthetic/stale"]);
  expect(after.getSession(sessions["Price the work"])).toMatchObject({ bookmarked: true, recordedCost: { costUSD: 1.27, models: { "claude-opus-5": { outputTokens: 300, costUSD: 1.27 } } } });
  expect(after.getSession(sessions["Plain prompt"])?.recordedCost).toBeNull();
});

// Claude Code 2.1.27x and later end each turn with a timestamped `system` record of subtype `turn_duration`. Their sum is
// the time Claude Code worked; the recorded span still counts the pauses between turns.
const turnDuration = (durationMs: unknown, timestamp: string, extra: Record<string, unknown> = {}) =>
  ({ type: "system", subtype: "turn_duration", durationMs, messageCount: 4, isMeta: false, uuid: `turn-${timestamp}`, sessionId: "synthetic", cwd: "/synthetic/project", timestamp, ...extra });

test("active time sums the turn durations Claude Code measured and ranks recordings by it", async () => {
  const setup = await fixture();
  // Open for a day, worked for under six minutes.
  const worked = await setup.write("worked", [
    record("Worked", { timestamp: "2026-09-20T12:00:00Z" }), turnDuration(120_000, "2026-09-20T12:02:00Z"),
    record("Later", { timestamp: "2026-09-21T11:56:00Z" }), turnDuration(216_000, "2026-09-21T12:00:00Z"),
  ]);
  // A long single turn in a short recording, with a second record whose duration Claude Code's own bounds reject.
  await setup.write("brief", [record("Brief", { timestamp: "2026-09-22T09:00:00Z" }), turnDuration(500_000, "2026-09-22T09:08:20Z"), turnDuration("soon", "2026-09-22T09:08:21Z", { messageCount: "many" })]);
  await setup.write("older", [record("Older", { timestamp: "2026-09-10T09:00:00Z" }), record("Ended", { timestamp: "2026-09-10T15:00:00Z" })]);
  const recorder = await setup.open();
  const titles = (sort: string) => recorder.list(new URLSearchParams({ sort })).items.map(item => item.title);
  const session = (title: string) => recorder.list(new URLSearchParams()).items.find(item => item.title === title)!;
  expect(session("Worked").activeTime).toEqual({ durationMs: 336_000, turns: 2 });
  expect(session("Brief").activeTime).toEqual({ durationMs: 500_000, turns: 2 });
  expect(session("Older").activeTime).toBeNull();
  // Active time orders by measured work, with unmeasured recordings last; the span still ranks the day-long recording first.
  expect(titles("active")).toEqual(["Brief", "Worked", "Older"]);
  expect(titles("duration")).toEqual(["Worked", "Older", "Brief"]);
  // The record is a system record with its timestamp, kept out of the conversation; every record still counts as a record.
  const timed = session("Worked");
  const all = recorder.events(timed.id, new URLSearchParams("kind=all"));
  expect(all.items.filter(event => event.type === "system").map(event => [event.category, event.role, event.blocks.length, event.timestamp, event.raw.durationMs]))
    .toEqual([["system", "system", 0, "2026-09-20T12:02:00.000Z", 120_000], ["system", "system", 0, "2026-09-21T12:00:00.000Z", 216_000]]);
  expect(recorder.events(timed.id, new URLSearchParams("kind=conversation")).items.map(event => event.sequence)).toEqual([0, 2]);
  expect([timed.eventCount, timed.messageCount]).toEqual([4, 2]);
  // An appended turn adds to the stored sum.
  await appendFile(worked, [record("Again", { timestamp: "2026-09-21T12:30:00Z" }), turnDuration(60_000, "2026-09-21T12:31:00Z")].map(value => JSON.stringify(value)).join("\n") + "\n");
  await recorder.scan();
  expect(recorder.getSession(timed.id)?.activeTime).toEqual({ durationMs: 396_000, turns: 3 });
});

test("version 13 indexes re-index only the recordings that hold turn durations or Claude Code's running total", async () => {
  const setup = await fixture();
  await setup.write("timed", [record("Time the work"), turnDuration(90_000, "2026-09-20T12:01:30Z")]);
  await setup.write("costed", [record("Price the work"), sessionState("cost-state", { totalCostUSD: 1.27, totalAPIDuration: 45_000, totalToolDuration: 5_000 })]);
  await setup.write("plain", [record("Plain prompt"), sessionState("permission-mode", { mode: "acceptEdits" })]);
  const before = await setup.open();
  const sessions = Object.fromEntries(before.list(new URLSearchParams()).items.map(session => [session.title, session.id]));
  before.bookmark(sessions["Time the work"], true);
  // Indexes written before version 14 kept no turn counters and no measured time.
  before.db.exec("ALTER TABLE sessions DROP COLUMN turns; ALTER TABLE sessions DROP COLUMN active_ms; ALTER TABLE session_costs DROP COLUMN api_ms; ALTER TABLE session_costs DROP COLUMN tool_ms");
  // A re-index rewrites every event of a recording, so a marked column shows which recordings it reached.
  before.db.exec("UPDATE events SET cwd='/synthetic/stale'");
  before.db.exec("PRAGMA user_version=13");
  await before.close();
  const after = await setup.open({ scan: false });
  const version = () => after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const cwds = (id: string) => after.db.query<{ cwd: string }, [string]>("SELECT DISTINCT cwd FROM events WHERE session_id=?").all(id).map(row => row.cwd);
  expect(version()).toBe(13);
  expect(after.getSession(sessions["Time the work"])?.activeTime).toBeNull();
  expect(after.getSession(sessions["Price the work"])?.recordedCost).toMatchObject({ costUSD: 1.27, apiDurationMs: null, toolDurationMs: null });
  await after.scan();
  expect(version()).toBe(17);
  expect(cwds(sessions["Time the work"])).toEqual(["/synthetic/project"]);
  expect(cwds(sessions["Price the work"]).sort()).toEqual(["", "/synthetic/project"]);
  expect(cwds(sessions["Plain prompt"])).toEqual(["/synthetic/stale"]);
  expect(after.getSession(sessions["Time the work"])).toMatchObject({ bookmarked: true, activeTime: { durationMs: 90_000, turns: 1 } });
  expect(after.getSession(sessions["Price the work"])?.recordedCost).toMatchObject({ costUSD: 1.27, apiDurationMs: 45_000, toolDurationMs: 5_000 });
  expect(after.getSession(sessions["Plain prompt"])).toMatchObject({ activeTime: null, recordedCost: null });
});

test("version 14 indexes re-index only the recordings that Claude Code relocated", async () => {
  const setup = await fixture();
  const worktree = "/synthetic/project/.claude/worktrees/feature";
  await setup.write("moved", [record("Move to a worktree"), sessionState("relocated", { relocatedCwd: worktree }), record("Continue there", { cwd: worktree })]);
  await setup.write("plain", [record("Plain prompt"), sessionState("permission-mode", { mode: "acceptEdits" })]);
  const before = await setup.open();
  const sessions = Object.fromEntries(before.list(new URLSearchParams()).items.map(session => [session.title, session.id]));
  before.bookmark(sessions["Move to a worktree"], true);
  // Indexes written before version 15 stored no working directory for a relocated record and no facet for it.
  before.db.exec("UPDATE events SET cwd='' WHERE type='relocated'");
  // A re-index rewrites every event of a recording, so a marked column shows which recordings it reached.
  before.db.exec("UPDATE events SET cwd='/synthetic/stale' WHERE type!='relocated'");
  before.db.exec("PRAGMA user_version=14");
  await before.close();
  const after = await setup.open({ scan: false });
  const version = () => after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const cwds = (id: string) => after.db.query<{ cwd: string }, [string]>("SELECT cwd FROM events WHERE session_id=? ORDER BY sequence").all(id).map(row => row.cwd);
  expect(version()).toBe(14);
  await after.scan();
  expect(version()).toBe(17);
  expect(cwds(sessions["Move to a worktree"])).toEqual(["/synthetic/project", worktree, worktree]);
  expect(cwds(sessions["Plain prompt"])).toEqual(["/synthetic/stale", "/synthetic/stale"]);
  expect(after.getSession(sessions["Move to a worktree"])).toMatchObject({ bookmarked: true, cwd: "/synthetic/project" });
  expect(after.events(sessions["Move to a worktree"], new URLSearchParams(`kind=all&cwd=${encodeURIComponent(worktree)}`)).items.map(item => item.type)).toEqual(["relocated", "user"]);
});

test("version 15 indexes fill the Claude Code version and unrecognized records in place", async () => {
  const setup = await fixture();
  await setup.write("formats", formatRecords().filter(entry => entry.type !== "summary"));
  await setup.write("plain", [record("Plain prompt", { version: "2.1.278" }), sessionState("attachment", { version: "2.1.278", attachment: { type: "hook_success" } })]);
  await setup.write("summarized", [sessionState("summary", { summary: "Earlier work on the Larkspur parser", leafUuid: "leaf" }), record("Summarized prompt")]);
  const before = await setup.open();
  const ids = Object.fromEntries(before.list(new URLSearchParams()).items.map(session => [session.source.replace(/\.jsonl$/, "").split(/[\\/]/).at(-1), session.id]));
  before.bookmark(ids.formats, true);
  // Indexes written before version 16 kept no version and counted no unrecognized records.
  before.db.exec("DELETE FROM session_facets WHERE kind IN ('version','unrecognized'); UPDATE sessions SET version='', unrecognized=0");
  // A re-index rewrites every event of a recording, so a marked column shows which recordings it reached.
  before.db.exec("UPDATE events SET cwd='/synthetic/stale'");
  before.db.exec("PRAGMA user_version=15");
  await before.close();
  const after = await setup.open({ scan: false });
  const version = () => after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const cwds = (id: string) => after.db.query<{ cwd: string }, [string]>("SELECT DISTINCT cwd FROM events WHERE session_id=?").all(id).map(row => row.cwd);
  expect(version()).toBe(15);
  expect(after.getSession(ids.formats)).toMatchObject({ version: "", unrecognizedCount: 0 });
  await after.scan();
  expect(version()).toBe(17);
  expect(after.getSession(ids.formats)).toMatchObject({ bookmarked: true, version: "2.1.302", unrecognizedCount: 4 });
  expect(after.getSession(ids.plain)).toMatchObject({ version: "2.1.278", unrecognizedCount: 0 });
  const catalog = await after.catalog();
  expect([catalog.versions, catalog.unrecognizedRecords, catalog.unrecognizedKinds]).toEqual([
    ["2.1.302", "2.1.296", "2.1.278"], 4, ["attachment:future_reminder", "system:future_notice", "type:future-record"],
  ]);
  expect(after.list(new URLSearchParams("version=2.1.296")).items.map(item => item.id)).toEqual([ids.formats]);
  // Both are filled where they are; only a recording whose `summary` an earlier build read as content is re-read.
  expect(cwds(ids.formats)).toEqual(["/synthetic/stale"]);
  expect(cwds(ids.plain)).toEqual(["/synthetic/stale"]);
  expect(cwds(ids.summarized).sort()).toEqual(["", "/synthetic/project"]);
});

test("version 9 indexes re-index only the recordings that hold session state records", async () => {
  const setup = await fixture();
  await setup.write("state", [record("Stateful prompt"), ...turnState("Stateful prompt")]);
  await setup.write("plain", [record("Plain prompt")]);
  const before = await setup.open();
  const sessions = before.list(new URLSearchParams()).items;
  const stateful = sessions.find(item => item.title === "Stateful prompt")!, plain = sessions.find(item => item.title === "Plain prompt")!;
  // Indexes written before version 10 flattened the whole record, so the prompt copy was searchable on the state record.
  before.db.query("UPDATE events SET text='type: last-prompt\nlastPrompt: Stateful prompt' WHERE session_id=? AND type='last-prompt'").run(stateful.id);
  // A re-index rewrites every event of a recording, so a marked column shows which recordings it reached.
  before.db.exec("UPDATE events SET cwd='/synthetic/stale'");
  before.db.exec("PRAGMA user_version=9");
  await before.close();
  const after = await setup.open({ scan: false });
  const version = () => after.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const cwds = (id: string) => after.db.query<{ cwd: string }, [string]>("SELECT DISTINCT cwd FROM events WHERE session_id=?").all(id).map(row => row.cwd);
  expect(version()).toBe(9);
  expect(after.matches(stateful.id, new URLSearchParams("kind=all&find=Stateful")).items.map(item => item.sequence)).toEqual([0, 1]);
  await after.scan();
  expect(version()).toBe(17);
  expect(cwds(stateful.id)).not.toContain("/synthetic/stale");
  expect(cwds(plain.id)).toEqual(["/synthetic/stale"]);
  expect(after.matches(stateful.id, new URLSearchParams("kind=all&find=Stateful")).items.map(item => item.sequence)).toEqual([0]);
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
    expect(facetQueries()).toBe(initial + 7);
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
