import { afterEach, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "../src/server/recorder";
import { dateBound, numericBound } from "../src/server/search";
import { removeTestDirectory } from "./helpers";

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
    open: async () => recorder = await Recorder.open(data, join(root, "state")),
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
  expect(events("q=nonexistent").facets).toEqual({ tools: ["Edit"], models: ["model-a", "model-b"], directories: ["/synthetic/project", "/synthetic/worktree"] });
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

test("numeric and UTC date bounds reject malformed and impossible values", () => {
  expect(numericBound("0")).toBe(0);
  expect(numericBound(".25")).toBe(0.25);
  for (const value of ["", "-1", "NaN", "Infinity", "1e9", "0x10", "9007199254740992"]) expect(numericBound(value)).toBeNull();
  expect(numericBound("1.5", true)).toBeNull();
  expect(dateBound("2026-09-20", true)).toBe("2026-09-20T23:59:59.999Z");
  expect(dateBound("2026-02-30")).toBeNull();
  expect(dateBound("yesterday")).toBeNull();
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
