import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "../src/server/recorder";
import { emptyUsage, readUsage } from "../src/server/usage";
import { dollars, usageCost } from "../src/client/lib/format";
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
