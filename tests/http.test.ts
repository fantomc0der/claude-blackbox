import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "../src/server/recorder";
import { createHandler } from "../src/server/http";
import { removeTestDirectory } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function setup(records: unknown[] = [{ type: "user", cwd: "/work/example", message: { content: "Hello" } }]) {
  const root = await mkdtemp(join(tmpdir(), "blackbox-http-"));
  const directory = join(root, "claude", "projects", "workspace");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "record.jsonl"), records.map(record => JSON.stringify(record)).join("\n") + "\n");
  const recorder = await Recorder.open(join(root, "claude"), join(root, "state"));
  cleanup.push(async () => { await recorder.close(); await removeTestDirectory(root); });
  return { handler: createHandler({ recorder }), recorder, id: recorder.queries.list(new URLSearchParams()).items[0].id };
}

test("blocks DNS rebinding, foreign origins and unsafe mutations", async () => {
  const { handler, id } = await setup();
  expect((await handler(new Request("http://evil.example/api/catalog"))).status).toBe(403);
  expect((await handler(new Request("http://127.0.0.1:12001/api/catalog", { headers: { origin: "https://evil.example" } }))).status).toBe(403);
  expect((await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/bookmark`, { method: "PUT", body: '{"bookmarked":true}' }))).status).toBe(403);
});

test("serves paginated records, local bookmarks and faithful export", async () => {
  const { handler, id } = await setup();
  const result = await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/bookmark`, {
    method: "PUT", headers: { origin: "http://127.0.0.1:12001", "content-type": "application/json" }, body: '{"bookmarked":true}',
  }));
  expect(result.status).toBe(200);
  expect((await result.json()).bookmarked).toBe(true);
  expect(result.headers.get("access-control-allow-origin")).toBeNull();
  const events = await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/events?limit=1`));
  expect((await events.json()).items).toHaveLength(1);
  const matches = await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/matches?kind=all&find=hello`));
  expect(await matches.json()).toMatchObject({ total: 1, limited: false, items: [{ position: 0, sequence: 0 }] });
  const family = await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/family`));
  expect(family.status).toBe(200);
  expect(await family.json()).toMatchObject({ rootId: id, launches: {}, members: [{ session: { id }, parentId: null, spawnEventId: null, spawnToolId: null, depth: 0 }] });
  const subagents = await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/subagents`));
  expect(await subagents.json()).toEqual([]);
  const download = await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/export`));
  expect(download.headers.get("content-disposition")).toContain("attachment");
  expect(JSON.parse((await download.text()).trim()).message.content).toBe("Hello");
});

test("pairs a page's results with their calls in both directions", async () => {
  const { handler, id } = await setup([
    { type: "assistant", cwd: "/work/example", message: { content: [{ type: "tool_use", id: "probe", name: "Bash", input: { command: "bun run probe" } }] } },
    { type: "user", cwd: "/work/example", message: { content: [{ type: "tool_result", tool_use_id: "probe", content: "Timed out", is_error: true }] } },
  ]);
  const errors = await (await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/events?kind=all&errors=1`))).json();
  expect(errors.items).toHaveLength(1);
  expect(errors.results).toEqual({});
  expect(errors.calls).toEqual({ probe: { type: "tool_use", id: "probe", name: "Bash", input: { command: "bun run probe" } } });
  const all = await (await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/events?kind=all`))).json();
  expect(all.results.probe).toMatchObject({ tool_use_id: "probe", is_error: true });
  expect(all.calls.probe.name).toBe("Bash");
});

test("serves a recording's file summary with positions under the replay filters", async () => {
  const { handler, id } = await setup([
    { type: "user", cwd: "/work/example", message: { content: "Hello" } },
    { type: "assistant", cwd: "/work/example", message: { role: "assistant", content: [{ type: "tool_use", id: "edit-1", name: "Edit", input: { file_path: "src/a.ts", old_string: "a", new_string: "b" } }] } },
    { type: "assistant", cwd: "/work/example", message: { role: "assistant", content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "cd /work/example && bun test", description: "Run the tests" } }] } },
    { type: "user", cwd: "/work/example", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "bash-1", content: "<tool_use_error>Exit code 1</tool_use_error>", is_error: true }] } },
    { type: "assistant", cwd: "/work/example", message: { role: "assistant", content: [{ type: "tool_use", id: "grep-1", name: "Grep", input: { pattern: "ready", path: "src", glob: "*.ts" } }] } },
    { type: "assistant", cwd: "/work/example", message: { role: "assistant", content: [{ type: "tool_use", id: "bash-2", name: "Bash", input: { command: "bun run dev", run_in_background: true } }] } },
    { type: "assistant", cwd: "/work/example", message: { role: "assistant", content: [{ type: "tool_use", id: "fetch-1", name: "WebFetch", input: { url: "https://example.test/docs", prompt: "Find setup instructions" } }] } },
  ]);
  const summary = await (await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/summary?kind=all`))).json();
  expect(summary).toMatchObject({ folders: [{ path: "/work/example", added: null, files: [{ path: "/work/example/src/a.ts", display: "src/a.ts", changes: [{ tool: "Edit", error: false, position: 1 }] }] }], changedFiles: 1 });
  // The prompt counts the failed Bash call recorded after it.
  expect(summary).toMatchObject({ prompts: [{ kind: "prompt", text: "Hello", position: 0, errors: 1, stopped: 0 }], promptCount: 1 });
  // Shell commands group by program with each run's outcome, and the recording holding no result for a call says so.
  expect(summary).toMatchObject({ commandCount: 2, commandRuns: 2, searchCount: 1, searchRuns: 1, fetchCount: 1, fetchRuns: 1 });
  // The chain's bun call is a step row under bun, sharing the Other row's runs and positions.
  const chain = { id: expect.any(String), position: 2, timestamp: "", tool: "Bash", error: true, decision: null, background: false, pending: false };
  expect(summary.commands).toEqual([{ name: "bun", category: "language", count: 2, errors: 1, stopped: 0, commands: [
    { key: expect.any(String), text: "bun run dev", head: "bun run dev", lines: 1, detail: "", count: 1, errors: 0, stopped: 0, runs: [{ id: expect.any(String), position: 5, timestamp: "", tool: "Bash", error: false, decision: null, background: true, pending: true }] },
    { key: expect.stringMatching(/:bun$/), text: "cd /work/example && bun test", head: "…bun test", lines: 1, detail: "", count: 1, errors: 1, stopped: 0, step: { line: 1, step: 2, steps: 2 }, also: [], runs: [chain] },
  ] }, { name: "Other", category: "other", count: 1, errors: 1, stopped: 0, commands: [
    { key: expect.any(String), text: "cd /work/example && bun test", head: "cd /work/example && bun test", lines: 1, detail: "", count: 1, errors: 1, stopped: 0, also: ["bun"], runs: [chain] },
  ] }]);
  expect(summary.commands[0].commands[1].key).toBe(`${summary.commands[1].commands[0].key}:bun`);
  expect(summary.fetches).toMatchObject([{ name: "WebFetch", category: "network", commands: [{ text: "https://example.test/docs", detail: "Find setup instructions", runs: [{ position: 6, pending: true }] }] }]);
  expect(summary.searches).toMatchObject([{ name: "Grep", count: 1, commands: [{ text: "ready", detail: "src · *.ts", runs: [{ position: 4, pending: true }] }] }]);
  const prompts = await (await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/summary?kind=prompts`))).json();
  expect(prompts.folders[0].files[0].changes[0].position).toBeNull();
  expect(prompts.prompts[0].position).toBe(0);
  expect(prompts.commands[0].commands[0].runs[0].position).toBeNull();
  expect(prompts.fetches[0].commands[0].runs[0].position).toBeNull();
  expect((await handler(new Request(`http://127.0.0.1:12001/api/sessions/${"0".repeat(24)}/summary`))).status).toBe(404);
});

test("SSE sends a fresh invalidation on reconnect and releases listeners", async () => {
  const { handler, recorder } = await setup();
  const response = await handler(new Request("http://127.0.0.1:12001/api/live"));
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"version":1');
  const progress = new TextDecoder().decode((await reader.read()).value);
  expect(progress).toContain("event: indexing");
  expect(progress).toContain('"checked":1,"total":1');
  expect(recorder.listeners.size).toBe(1);
  expect(recorder.progressListeners.size).toBe(1);
  recorder.emit(["updated"]);
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("updated");
  await reader.cancel();
  expect(recorder.listeners.size).toBe(0);
  expect(recorder.progressListeners.size).toBe(0);
});

test("SSE keeps the latest progress and invalidation for a slow reader", async () => {
  const { handler, recorder } = await setup();
  const response = await handler(new Request("http://127.0.0.1:12001/api/live"));
  const reader = response.body!.getReader();
  for (let checked = 0; checked <= 100; checked++) {
    for (const listener of recorder.progressListeners) listener({ phase: checked === 100 ? "idle" : "indexing", checked, total: 100 });
    recorder.emit([`changed-${checked}`]);
  }
  const messages = [];
  for (let index = 0; index < 3; index++) messages.push(new TextDecoder().decode((await reader.read()).value));
  expect(messages.join("")).toContain('"phase":"idle","checked":100,"total":100');
  const changes = messages.filter(message => message.includes("event: change"));
  expect(changes).toHaveLength(2);
  expect(changes.map(message => JSON.parse(message.split("data: ")[1]))).toEqual([
    { version: 1, ids: [] },
    { version: 1, ids: [] },
  ]);
  await reader.cancel();
});

test("SSE preserves single updates and broadens overlapping invalidations without narrowing them", async () => {
  const { handler, recorder } = await setup();
  const response = await handler(new Request("http://127.0.0.1:12001/api/live"));
  const reader = response.body!.getReader();
  const readPayload = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value).split("data: ")[1]);
  try {
    await readPayload();
    await readPayload();
    recorder.emit(["single"]);
    expect(await readPayload()).toEqual({ version: 1, ids: ["single"] });
    for (const updates of [[["first"], ["second"], ["third"]], [[], ["later"]], [["earlier"], []]]) {
      recorder.emit(["buffered"]);
      for (const ids of updates) recorder.emit(ids);
      expect(await readPayload()).toEqual({ version: 1, ids: ["buffered"] });
      expect(await readPayload()).toEqual({ version: 1, ids: [] });
    }
  } finally { await reader.cancel(); }
});
