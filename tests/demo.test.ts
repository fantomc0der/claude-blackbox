import { afterEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemo } from "../scripts/demo";
import { layoutTimeline } from "../src/client/lib/timeline";
import { Recorder } from "../src/server/recorder";
import { DEMO_AGENT_IDS, DEMO_SESSION_COUNT } from "./fixtures";
import { removeTestDirectory } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function indexedDemo() {
  const root = await mkdtemp(join(tmpdir(), "blackbox-demo-"));
  let recorder: Recorder | undefined;
  cleanup.push(async () => { await recorder?.close(); await removeTestDirectory(root); });
  await createDemo(join(root, "demo"));
  recorder = await Recorder.open(join(root, "demo"), join(root, "state"));
  return recorder;
}

test("demo catalog includes a multi-day session that fills more than one replay page", async () => {
  const recorder = await indexedDemo();
  const listing = recorder.queries.list(new URLSearchParams({ agents: "1", limit: "100" }));
  expect(listing.total).toBe(DEMO_SESSION_COUNT + Object.keys(DEMO_AGENT_IDS).length);
  const ledger = recorder.queries.list(new URLSearchParams({ q: "Stream ledger exports without timeouts" })).items[0]!;
  const conversation = new URLSearchParams({ kind: "conversation" });
  expect(recorder.queries.events(ledger.id, conversation).total).toBeGreaterThan(60);
  const layout = layoutTimeline(recorder.queries.timeline(ledger.id, conversation), 640);
  expect(layout.items.filter(item => item.kind === "gap").length).toBeGreaterThanOrEqual(1);
  expect(layout.bins.filter(bin => bin.errors > 0).length).toBeGreaterThanOrEqual(2);
});

test("demo catalog never reuses an event uuid across recordings", async () => {
  const root = await mkdtemp(join(tmpdir(), "blackbox-demo-"));
  cleanup.push(() => removeTestDirectory(root));
  await createDemo(root);
  const uuids: string[] = [];
  for await (const file of new Bun.Glob("**/*.jsonl").scan({ cwd: root, absolute: true })) {
    for (const line of (await Bun.file(file).text()).split("\n")) {
      if (line) uuids.push(JSON.parse(line).uuid);
    }
  }
  expect(uuids.length).toBeGreaterThan(60);
  expect(new Set(uuids).size).toBe(uuids.length);
});

test("demo catalog includes a parent session whose agent recordings link back to their launches", async () => {
  const recorder = await indexedDemo();
  const parent = recorder.queries.list(new URLSearchParams({ q: "Audit keyboard paths across the component library" })).items[0]!;
  const family = recorder.queries.family(parent.id);
  const agents = family.members.filter(member => member.session.isAgent);
  expect(agents.map(member => member.label).sort()).toEqual(["Check menu roving focus", "Map dialog focus order", "Review skip links and landmarks"]);
  expect(agents.every(member => member.parentId === parent.id && member.depth === 1)).toBe(true);
  expect(Object.values(family.launches).sort()).toEqual(agents.map(member => member.session.id).sort());
});
