import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { appendFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "../src/server/recorder";
import { emptyUsage, readUsage } from "../src/server/usage";
import { dollars, effortName, usageCost } from "../src/client/lib/format";
import { removeTestDirectory } from "./helpers";

function record(id: string, extra: Record<string, unknown> = {}) {
  return {
    type: "assistant", uuid: `uuid-${id}`, sessionId: "session-a", requestId: `request-${id}`,
    cwd: "C:\\work\\orbit", timestamp: "2026-09-20T12:00:00Z",
    message: { id: `msg-${id}`, role: "assistant", model: "claude-sonnet-4-5-20250929", content: `Response ${id}`,
      usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 300, cache_read_input_tokens: 400 } },
    ...extra,
  };
}

function sample(model: string, usage: Record<string, unknown>, extra = {}) {
  return readUsage(record("sample", { message: { model, usage }, ...extra }), "source", "event");
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "blackbox-usage-"));
  const data = join(root, "claude"), project = join(data, "projects", "test"), state = join(root, "state");
  await mkdir(project, { recursive: true });
  let recorder: Recorder | undefined;
  cleanup.push(async () => { await recorder?.close(); await removeTestDirectory(root); });
  return {
    project, state, data,
    write: async (name: string, records: unknown[]) => {
      const file = join(project, `${name}.jsonl`);
      await writeFile(file, records.map(value => JSON.stringify(value)).join("\n") + "\n");
      return file;
    },
    open: async () => recorder = await Recorder.open(data, state),
  };
}

describe("usage extraction and pricing", () => {
  test("retains explicit effort and normalizes model identities without inferring effort", () => {
    const original = record("effort");
    for (const entry of [
      { ...original, effort: " HIGH " },
      { ...original, message: { ...original.message, effort: "high" } },
      { ...original, output_config: { effort: "high" } },
      { ...original, message: { ...original.message, output_config: { effort: "high" } } },
    ]) {
      expect(readUsage(entry, "source", "event")).toMatchObject({ model: "claude-sonnet-4-5", effort: "high" });
      expect(readUsage(entry, "source", "event")?.cost).toBe(readUsage(original, "source", "event")?.cost);
    }
    expect(sample("claude-opus-4-5", { output_tokens: 50000, speed: "fast" }, { thinking: { budget_tokens: 10000 } })?.effort).toBeNull();
    expect(sample("claude-opus-4-5", { input_tokens: 3 }, { effort: { level: "high" } })?.effort).toBeNull();
    expect(sample("claude-opus-4-5", { input_tokens: 3 }, { effort: " ", output_config: { effort: "max" } })?.effort).toBe("max");
    expect(effortName(null)).toBe("Not recorded");
    expect(effortName("xhigh")).toBe("Extra high");
    expect(effortName("future-effort")).toBe("future-effort");
  });

  test("prices input, output and both cache durations without double counting writes", () => {
    const usage = sample("claude-sonnet-4-5", {
      input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 300, cache_read_input_tokens: 400,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
    })!;
    expect(usage.cacheCreation).toBe(300);
    expect(usage.cost).toBeCloseTo(0.007695, 9);
    expect(usage.recorded).toBe(false);
    expect(sample("claude-sonnet-4-5", { cache_creation: { ephemeral_1h_input_tokens: 200 } })?.cacheCreation).toBe(200);
  });

  test("prefers recorded costs including zero, preserves unknown-model tokens", () => {
    expect(sample("unknown-model", { input_tokens: 123 }, { costUSD: 0.75 })?.cost).toBe(0.75);
    expect(sample("claude-opus-4-5", { input_tokens: 123 }, { costUSD: 0 })?.cost).toBe(0);
    expect(sample("unknown-model", { input_tokens: 123 })).toMatchObject({ input: 123, cost: null, recorded: false });
    expect(sample("__proto__", { input_tokens: 123 })?.cost).toBeNull();
    expect(sample("claude-sonnet-future", { output_tokens: 25 })?.cost).toBeNull();
  });

  test("handles known aliases and rejects missing, synthetic and invalid usage", () => {
    for (const model of ["claude-sonnet-4-5-20250929", "claude-sonnet-4-5[1m]", "us.anthropic.claude-sonnet-4-5-20250929-v1:0"]) {
      expect(sample(model, { input_tokens: 1000 })?.cost).toBe(0.003);
    }
    expect(sample("claude-sonnet-4-5", {})).toBeNull();
    expect(sample("<synthetic>", { output_tokens: 5 })).toBeNull();
    expect(sample("claude-sonnet-4-5", { input_tokens: -1, output_tokens: "100" })).toBeNull();
    expect(sample("claude-sonnet-4-5", { input_tokens: Infinity, output_tokens: 5 })).toMatchObject({ input: 0, output: 5 });
    expect(sample("claude-sonnet-4-5", { input_tokens: 5 }, { type: "user" })).toBeNull();
  });

  test("accounts for legacy long context, fast mode and US inference when recorded", () => {
    expect(sample("claude-sonnet-4-5", { input_tokens: 200001, output_tokens: 100 })?.cost).toBeCloseTo(1.202256, 9);
    expect(sample("claude-sonnet-4-5", { input_tokens: 1, cache_read_input_tokens: 200000 })?.cost).toBeCloseTo(0.120006, 9);
    expect(sample("claude-sonnet-4-6", { input_tokens: 200001 })?.cost).toBeCloseTo(0.600003, 9);
    expect(sample("claude-opus-5", { input_tokens: 1000, speed: "fast" })?.cost).toBe(0.01);
    expect(sample("claude-sonnet-4-5", { input_tokens: 1000, speed: "fast" })?.cost).toBeNull();
    expect(sample("claude-opus-5", { input_tokens: 1000, inference_geo: "us" })?.cost).toBeCloseTo(0.0055, 9);
  });

  test("distinguishes missing, unpriced, zero, fractional and partial cost displays", () => {
    expect(usageCost(emptyUsage())).toBe("Not recorded");
    expect(usageCost({ ...emptyUsage(), requests: 1, unpricedRequests: 1 })).toBe("Unavailable");
    expect(usageCost({ ...emptyUsage(), requests: 1 })).toBe("$0.00");
    expect(dollars(0.00004)).toBe("<$0.01");
    expect(usageCost({ ...emptyUsage(), requests: 2, unpricedRequests: 1, costUSD: 1.23 })).toBe("$1.23+");
  });
});

describe("indexed usage", () => {
  test("catalog reuses workspace usage until an index or group invalidation", async () => {
    const setup = await fixture();
    const file = await setup.write("original", [record("original", { costUSD: 1 })]);
    await setup.write("clone", [record("clone", { cwd: "C:\\work\\clone", costUSD: 2 })]);
    const recorder = await setup.open();
    const query = spyOn(recorder.db, "query");
    const aggregations = () => query.mock.calls.filter(([sql]) => sql.includes("PARTITION BY coalesce(gp.group_id,s.cwd)")).length;
    try {
      const first = await recorder.catalog();
      expect((await recorder.catalog()).workspaces).toEqual(first.workspaces);
      expect(aggregations()).toBe(1);
      await appendFile(file, JSON.stringify(record("appended", { costUSD: 3 })) + "\n");
      await recorder.scan();
      expect((await recorder.catalog()).workspaces.find(workspace => workspace.name === "orbit")?.usage.costUSD).toBe(4);
      expect(aggregations()).toBe(2);
      const group = recorder.saveGroup({ name: "Cached group", paths: ["C:\\work\\orbit", "C:\\work\\clone"] });
      expect((await recorder.catalog()).workspaces[0].usage.costUSD).toBe(6);
      expect(aggregations()).toBe(3);
      await recorder.catalog();
      expect(aggregations()).toBe(3);
      recorder.deleteGroup(group.id);
      expect((await recorder.catalog()).workspaces).toHaveLength(2);
      expect(aggregations()).toBe(4);
    } finally { query.mockRestore(); }
  });

  test("catalog costs cover each workspace and deduplicate copied requests within a group", async () => {
    const setup = await fixture();
    const shared = record("shared", { costUSD: 10 });
    await setup.write("original", [shared]);
    await setup.write("same-folder-copy", [shared]);
    await setup.write("clone", [{ ...shared, cwd: "C:\\work\\clone" }, record("unique", { cwd: "C:\\work\\clone", costUSD: 3 })]);
    await setup.write("outside", [{ ...shared, cwd: "C:\\work\\outside" }]);
    const recorder = await setup.open();
    const ungrouped = (await recorder.catalog()).workspaces;
    expect(ungrouped.find(workspace => workspace.name === "orbit")).toMatchObject({ count: 2, usage: { requests: 1, costUSD: 10 } });
    expect(ungrouped.find(workspace => workspace.name === "clone")?.usage.costUSD).toBe(13);
    for (const workspace of ungrouped) expect(workspace.usage).toEqual(recorder.list(new URLSearchParams({ workspace: workspace.id })).usage);
    const group = recorder.saveGroup({ name: "Orbit together", paths: ["C:\\work\\orbit", "C:\\work\\clone"] });
    const grouped = (await recorder.catalog()).workspaces;
    expect(grouped).toHaveLength(2);
    expect(grouped.find(workspace => workspace.id === group.id)).toMatchObject({ count: 3, usage: { requests: 2, costUSD: 13 } });
    expect(grouped.find(workspace => workspace.name === "outside")?.usage.costUSD).toBe(10);
    for (const workspace of grouped) expect(workspace.usage).toEqual(recorder.list(new URLSearchParams({ workspace: workspace.id, limit: "1" })).usage);
    recorder.deleteGroup(group.id);
    expect((await recorder.catalog()).workspaces).toEqual(ungrouped);
  });

  test("catalog preserves missing, unpriced, partial and zero costs and refreshes after indexing", async () => {
    const setup = await fixture();
    await setup.write("missing", [record("missing", { cwd: "/work/missing", message: { role: "assistant", content: "No usage" } })]);
    await setup.write("unpriced", [record("unknown", { cwd: "/work/unpriced", message: { model: "future-model", usage: { input_tokens: 10 } } })]);
    const zeroFile = await setup.write("zero", [record("zero", { cwd: "/work/zero", costUSD: 0 })]);
    await setup.write("no-directory", [record("no-directory", { cwd: "", costUSD: 2 })]);
    const recorder = await setup.open();
    const catalog = await recorder.catalog();
    expect(catalog.workspaces.find(workspace => workspace.name === "missing")?.usage).toEqual(emptyUsage());
    expect(catalog.workspaces.find(workspace => workspace.name === "unpriced")?.usage).toMatchObject({ requests: 1, unpricedRequests: 1, costUSD: 0 });
    expect(catalog.workspaces.find(workspace => workspace.name === "zero")?.usage).toMatchObject({ requests: 1, unpricedRequests: 0, costUSD: 0 });
    expect(catalog.workspaces.find(workspace => workspace.id === "unknown")?.usage.costUSD).toBe(2);
    const group = recorder.saveGroup({ name: "Partial", paths: ["/work/unpriced", "/work/zero"] });
    await appendFile(zeroFile, JSON.stringify(record("added", { cwd: "/work/zero", costUSD: 4 })) + "\n");
    await recorder.scan();
    expect((await recorder.catalog()).workspaces.find(workspace => workspace.id === group.id)?.usage).toMatchObject({ requests: 3, unpricedRequests: 1, costUSD: 4 });
  });

  test("model and effort expenses use each request and reconcile across grouped folders and pages", async () => {
    const setup = await fixture();
    const high = record("opus-high"), low = record("opus-low");
    await setup.write("session-a", [
      { ...high, message: { ...high.message, model: "claude-opus-4-5-20251101", effort: "high" } },
      { ...low, message: { ...low.message, model: "claude-opus-4-5", effort: "low" } },
      record("sonnet-missing-effort"),
    ]);
    await setup.write("session-b", [record("unknown-model", { cwd: "C:\\work\\clone", message: { model: "future-model", effort: "high", usage: { input_tokens: 40 } } })]);
    const recorder = await setup.open();
    const group = recorder.saveGroup({ name: "Expenses", paths: ["C:\\work\\orbit", "C:\\work\\clone"] });
    const params = new URLSearchParams({ workspace: group.id, limit: "1" });
    const page = recorder.list(params);
    expect(page.modelUsage).toHaveLength(4);
    expect(page.modelUsage.map(row => [row.model, row.effort])).toContainEqual(["claude-opus-4-5", "high"]);
    expect(page.modelUsage.map(row => [row.model, row.effort])).toContainEqual(["claude-opus-4-5", "low"]);
    expect(page.modelUsage.map(row => [row.model, row.effort])).toContainEqual(["claude-sonnet-4-5", null]);
    expect(page.modelUsage.find(row => row.model === "future-model")?.usage.unpricedRequests).toBe(1);
    for (const key of ["requests", "totalTokens", "inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens", "unpricedRequests", "costUSD"] as const) {
      expect(page.modelUsage.reduce((sum, row) => sum + row.usage[key], 0)).toBeCloseTo(page.usage[key], 9);
    }
    expect(page.modelUsage.map(row => row.usage.costUSD)).toEqual(page.modelUsage.map(row => row.usage.costUSD).toSorted((left, right) => right - left));
    params.set("offset", "1");
    expect(recorder.list(params).modelUsage).toEqual(page.modelUsage);
    params.set("cwd", "C:\\work\\clone");
    expect(recorder.list(params).modelUsage).toHaveLength(1);
    expect(recorder.list(new URLSearchParams({ q: "sonnet-missing-effort" })).modelUsage).toHaveLength(3);
    expect(recorder.list(new URLSearchParams({ q: "no-such-request" })).modelUsage).toEqual([]);
  });

  test("deduplicates model aliases and copied requests while keeping recorded effort", async () => {
    const setup = await fixture();
    const original = record("shared");
    await setup.write("session-a", [original]);
    await setup.write("session-b", [{ ...original, cwd: "C:\\work\\clone", message: { ...original.message, model: "claude-sonnet-4-5", effort: "high" } }]);
    const recorder = await setup.open();
    const page = recorder.list(new URLSearchParams());
    expect(page.usage.requests).toBe(1);
    expect(page.modelUsage).toEqual([{ model: "claude-sonnet-4-5", effort: "high", usage: page.usage }]);
  });

  test("streamed usage retains effort when larger updates omit it or smaller updates add it", async () => {
    const setup = await fixture();
    const original = record("streaming");
    const file = await setup.write("session-a", [original]);
    const recorder = await setup.open();
    const metadata = { ...original, uuid: "smaller-update", effort: "high", message: { ...original.message, usage: { ...original.message.usage, output_tokens: 10 } } };
    await appendFile(file, JSON.stringify(metadata) + "\n");
    await recorder.scan();
    expect(recorder.list(new URLSearchParams()).modelUsage[0]).toMatchObject({ effort: "high", usage: { totalTokens: 1900 } });
    const larger = { ...original, uuid: "larger-update", message: { ...original.message, usage: { ...original.message.usage, output_tokens: 800 } } };
    await appendFile(file, JSON.stringify(larger) + "\n");
    await recorder.scan();
    expect(recorder.list(new URLSearchParams()).modelUsage[0]).toMatchObject({ effort: "high", usage: { requests: 1, totalTokens: 2500 } });
  });

  test("upgrades version 3 usage indexes and backfills per-request model and effort", async () => {
    const setup = await fixture();
    const file = await setup.write("session-a", [record("backfill", { effort: "medium" })]);
    const original = await Bun.file(file).text();
    const before = await setup.open();
    const expected = before.list(new URLSearchParams());
    before.bookmark(expected.items[0].id, true);
    before.db.exec("DROP INDEX usage_efforts; ALTER TABLE usage_records DROP COLUMN model; ALTER TABLE usage_records DROP COLUMN effort; PRAGMA user_version=3;");
    await before.close();
    const after = await setup.open();
    const page = after.list(new URLSearchParams());
    expect(page.usage).toEqual(expected.usage);
    expect(page.modelUsage).toEqual(expected.modelUsage);
    expect(page.modelUsage[0].effort).toBe("medium");
    expect(page.items[0].bookmarked).toBe(true);
    expect(await Bun.file(file).text()).toBe(original);
  });

  test("deduplicates streaming updates, stays idempotent and follows appended usage", async () => {
    const setup = await fixture();
    const original = record("first");
    const file = await setup.write("session-a", [original, { ...original, uuid: "duplicate" }]);
    const recorder = await setup.open();
    expect(recorder.list(new URLSearchParams()).usage).toMatchObject({ requests: 1, totalTokens: 1900 });
    const final = { ...original, uuid: "final", message: { ...original.message, usage: { ...original.message.usage, output_tokens: 800 } } };
    await appendFile(file, JSON.stringify(final) + "\n" + JSON.stringify(record("second")) + "\n");
    await recorder.scan();
    await recorder.scan();
    const page = recorder.list(new URLSearchParams());
    expect(page.usage).toMatchObject({ requests: 2, totalTokens: 4400, outputTokens: 1000 });
    expect(page.items[0].usage).toEqual(page.usage);
    expect(recorder.getSession(page.items[0].id)?.usage).toEqual(page.usage);
    expect(page.sessionsWithUsage).toBe(1);
  });

  test("totals span all pages and respect folder, group, search and bookmark filters", async () => {
    const setup = await fixture();
    await setup.write("session-a", [record("first")]);
    await setup.write("session-b", [record("second", { cwd: "C:\\work\\orbit-clone", sessionId: "session-b" })]);
    await setup.write("session-c", [record("third", { cwd: "C:\\work\\elsewhere", sessionId: "session-c" })]);
    const recorder = await setup.open();
    const group = recorder.saveGroup({ name: "Orbit", paths: ["C:\\work\\orbit", "C:\\work\\orbit-clone"] });
    const grouped = recorder.list(new URLSearchParams({ workspace: group.id, limit: "1" }));
    expect(grouped.items).toHaveLength(1);
    expect(grouped.usage).toMatchObject({ requests: 2, totalTokens: 3800 });
    expect(grouped.directories).toHaveLength(2);
    expect(recorder.list(new URLSearchParams({ workspace: group.id, offset: "1", limit: "1" })).usage).toEqual(grouped.usage);
    expect(recorder.list(new URLSearchParams({ workspace: group.id, cwd: "C:\\work\\orbit" })).usage.requests).toBe(1);
    expect(recorder.list(new URLSearchParams({ q: "second" })).usage.requests).toBe(1);
    recorder.bookmark(grouped.items[0].id, true);
    expect(recorder.list(new URLSearchParams({ bookmarked: "1" })).usage.requests).toBe(1);
    expect(recorder.list(new URLSearchParams({ after: "2026-09-21" })).usage).toEqual(emptyUsage());
    recorder.deleteGroup(group.id);
    expect(recorder.list(new URLSearchParams()).usage.requests).toBe(3);
  });

  test("deduplicates copied requests across folders, preserves independent subagent requests", async () => {
    const setup = await fixture();
    await setup.write("session-a", [record("shared")]);
    await setup.write("session-b", [record("shared", { cwd: "C:\\clone" }), record("distinct", { cwd: "C:\\clone" })]);
    await setup.write("agent-subtask", [record("agent", { cwd: "C:\\clone", isSidechain: true })]);
    const recorder = await setup.open();
    const page = recorder.list(new URLSearchParams());
    expect(page.usage.requests).toBe(3);
    expect(page.directories.reduce((sum, directory) => sum + directory.usage.requests, 0)).toBe(3);
    expect(recorder.list(new URLSearchParams({ agents: "0" })).usage.requests).toBe(2);
    expect(recorder.list(new URLSearchParams({ cwd: "C:\\clone" })).usage.requests).toBe(3);
  });

  test("tracks missing pricing and does not treat recordings without usage as free", async () => {
    const setup = await fixture();
    await setup.write("session-a", [record("known"), record("unknown", { message: { model: "future", usage: { input_tokens: 42 } } })]);
    await setup.write("session-b", [{ type: "user", message: { content: "No usage data" } }]);
    const recorder = await setup.open();
    const page = recorder.list(new URLSearchParams());
    expect(page.usage).toMatchObject({ requests: 2, unpricedRequests: 1, totalTokens: 1942 });
    expect(page.sessionsWithUsage).toBe(1);
    expect(page.total).toBe(2);
    expect(page.items.find(session => session.title === "No usage data")?.usage).toEqual(emptyUsage());
  });

  test("rebuilds usage after truncation, replacement and source deletion", async () => {
    const setup = await fixture();
    const file = await setup.write("session-a", [record("one"), record("two")]);
    const recorder = await setup.open();
    await writeFile(file, JSON.stringify(record("replacement")) + "\n");
    await recorder.scan();
    expect(recorder.list(new URLSearchParams()).usage.requests).toBe(1);
    await rm(file);
    await recorder.scan();
    expect(recorder.list(new URLSearchParams()).usage).toEqual(emptyUsage());
  });

  test("migrates existing indexes without touching sources, bookmarks or groups", async () => {
    const setup = await fixture();
    const file = await setup.write("session-a", [record("one")]);
    await setup.write("session-b", [record("two", { cwd: "C:\\work\\clone" })]);
    const original = await Bun.file(file).text();
    const before = await setup.open();
    const id = before.list(new URLSearchParams()).items[0].id;
    before.bookmark(id, true);
    const group = before.saveGroup({ name: "Work", paths: ["C:\\work\\orbit", "C:\\work\\clone"] });
    before.db.exec("DROP TABLE usage_records; PRAGMA user_version=2;");
    await before.close();
    const after = await setup.open();
    expect(after.getSession(id)?.bookmarked).toBe(true);
    expect(after.groups()[0].id).toBe(group.id);
    expect(after.list(new URLSearchParams()).usage.requests).toBe(2);
    expect(await Bun.file(file).text()).toBe(original);
  });
});
