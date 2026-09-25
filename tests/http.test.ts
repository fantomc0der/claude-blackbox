import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "../src/server/recorder";
import { createHandler } from "../src/server/http";
import { removeTestDirectory } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "blackbox-http-"));
  const directory = join(root, "claude", "projects", "workspace");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "record.jsonl"), JSON.stringify({ type: "user", cwd: "/work/example", message: { content: "Hello" } }) + "\n");
  const recorder = await Recorder.open(join(root, "claude"), join(root, "state"));
  cleanup.push(async () => { await recorder.close(); await removeTestDirectory(root); });
  return { handler: createHandler({ recorder }), recorder, id: recorder.list(new URLSearchParams()).items[0].id };
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
  const download = await handler(new Request(`http://127.0.0.1:12001/api/sessions/${id}/export`));
  expect(download.headers.get("content-disposition")).toContain("attachment");
  expect(JSON.parse((await download.text()).trim()).message.content).toBe("Hello");
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
