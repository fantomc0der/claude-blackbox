import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "../src/server/recorder";
import { indexVersion, migrations, migrationTo } from "../src/server/migrations";
import { removeTestDirectory } from "./helpers";
import type { IndexProgress } from "../src/shared/types";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

function record(text: string, extra: Record<string, unknown> = {}) {
  return { type: "user", cwd: "/synthetic/project", timestamp: "2026-09-20T12:00:00Z", message: { content: text }, ...extra };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "blackbox-migrations-"));
  const data = join(root, "source");
  const folder = join(data, "projects", "synthetic");
  await mkdir(folder, { recursive: true });
  let recorder: Recorder | undefined;
  cleanup.push(async () => { await recorder?.close(); await removeTestDirectory(root); });
  return {
    write: (name: string, records: unknown[]) => writeFile(join(folder, `${name}.jsonl`), records.map(entry => JSON.stringify(entry)).join("\n") + "\n"),
    open: async (options: { scan?: boolean } = {}) => recorder = await Recorder.open(data, join(root, "state"), options),
  };
}

const storedVersion = (recorder: Recorder) => recorder.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
const markedForRereading = (recorder: Recorder) => recorder.db.query<{ title: string }, []>("SELECT title FROM sessions WHERE mtime=0 ORDER BY title").all().map(row => row.title);

test("the scan-time upgrade steps are listed once each, in ascending order, after the constructor's and within the gate", () => {
  const versions = migrations.map(step => step.version);
  expect(versions).toEqual([...new Set(versions)].sort((a, b) => a - b));
  // Versions up to 7 complete in the constructor, before the port binds, and the gate refuses an index past the last step.
  expect(versions[0]).toBeGreaterThan(7);
  expect(versions.at(-1)).toBeLessThanOrEqual(indexVersion);
  for (const version of versions) expect(migrationTo(version).version).toBe(version);
  expect(() => migrationTo(7)).toThrow("No index upgrade step writes version 7.");
});

test("a per-recording step that chooses recordings to re-read marks the one it is given only when it holds what the step looks for", async () => {
  const setup = await fixture();
  // A copy of a message holding text no other record holds keeps that text searchable, which version 19 re-reads.
  await setup.write("copied", [record("Copy the context"),
    { type: "api-request-blob", sessionId: "synthetic", hash: "hash-system", message: { role: "system", content: [{ type: "text", text: "Hook context no record holds" }] } },
    { type: "api-request", sessionId: "synthetic", id: "request", timestamp: "2026-09-20T12:00:03Z", keep: 2, tail: ["hash-system"] }]);
  await setup.write("plain", [record("Plain prompt")]);
  const recorder = await setup.open();
  const ids = Object.fromEntries(recorder.queries.list(new URLSearchParams()).items.map(session => [session.title, session.id]));
  expect(markedForRereading(recorder)).toEqual([]);
  const step = migrationTo(19);
  if (!("each" in step)) throw new Error("Version 19 searches one recording at a time.");
  const fill = step.each(recorder.db);
  fill({ id: ids["Plain prompt"], named: 0 });
  expect(markedForRereading(recorder)).toEqual([]);
  fill({ id: ids["Copy the context"], named: 0 });
  expect(markedForRereading(recorder)).toEqual(["Copy the context"]);
  expect(storedVersion(recorder)).toBe(indexVersion);
});

test("a whole-index step reads no event, so it costs the same at any index size", async () => {
  const setup = await fixture();
  await setup.write("plain", [record("Plain prompt")]);
  const recorder = await setup.open();
  // One statement holds the thread that serves the page until it returns, so a step that reads events goes one
  // recording at a time instead. Without the table, a statement that reads it fails.
  const search = migrationTo(19);
  if (!("each" in search)) throw new Error("Version 19 searches one recording at a time.");
  recorder.db.exec("ALTER TABLE events RENAME TO events_elsewhere");
  try {
    for (const step of migrations) if ("apply" in step) expect(() => step.apply(recorder.db)).not.toThrow();
    expect(() => search.each(recorder.db)({ id: "", named: 0 })).toThrow("no such table: events");
  } finally { recorder.db.exec("ALTER TABLE events_elsewhere RENAME TO events"); }
});

test("an upgrade reports its own phase, lets the server answer between recordings, and never reports less done", async () => {
  const setup = await fixture();
  await setup.write("interrupted", [record("Interrupted prompt"), record("[Request interrupted by user]")]);
  await setup.write("first", [record("First prompt")]);
  await setup.write("second", [record("Second prompt")]);
  const before = await setup.open();
  // An earlier build read the marker as a message, which version 18 re-reads.
  before.db.exec("UPDATE events SET category='message' WHERE role='user'");
  before.db.exec("PRAGMA user_version=17");
  await before.close();
  const recorder = await setup.open({ scan: false });
  const seen: Array<IndexProgress & { turns: number }> = [];
  let turns = 0;
  const turn = setInterval(() => turns++, 0);
  recorder.progressListeners.add(progress => seen.push({ ...progress, turns }));
  // Every recording then outlasts the time slice, so the step yields and reports after each.
  let elapsed = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => elapsed += 300);
  try { await recorder.scan(); }
  finally { clock.mockRestore(); clearInterval(turn); }
  const upgrade = seen.filter(progress => progress.phase === "upgrading");
  expect(seen.findIndex(progress => progress.phase === "discovering")).toBe(upgrade.length);
  // Versions 18 and 19 each read the three recordings, and version 19 skips the one version 18 marked.
  expect(upgrade.map(({ checked, total }) => [checked, total])).toEqual([[0, 0], [0, 6], [1, 6], [2, 6], [3, 6], [3, 5], [4, 5], [5, 5]]);
  expect(upgrade.at(-1)!.turns).toBeGreaterThan(upgrade[1].turns);
  expect(storedVersion(recorder)).toBe(indexVersion);
  expect(recorder.indexing.phase).toBe("idle");
});

test("the step that stands for the collapsed versions 8 to 15 marks every recording and leaves the version alone", async () => {
  const setup = await fixture();
  await setup.write("costed", [record("Price the work"), { type: "cost-state", sessionId: "synthetic", totalCostUSD: 1.27 }]);
  await setup.write("plain", [record("Plain prompt")]);
  const recorder = await setup.open();
  const step = migrationTo(15);
  if (!("apply" in step)) throw new Error("Version 15 marks recordings across the whole index.");
  step.apply(recorder.db);
  expect(markedForRereading(recorder)).toEqual(["Plain prompt", "Price the work"]);
  expect(storedVersion(recorder)).toBe(indexVersion);
});

test("a per-recording step applied on its own fills the one recording it is given and leaves the version alone", async () => {
  const setup = await fixture();
  await setup.write("versioned", [record("Versioned prompt", { version: "2.1.302" })]);
  await setup.write("plain", [record("Plain prompt", { version: "2.1.296" })]);
  const recorder = await setup.open();
  const ids = Object.fromEntries(recorder.queries.list(new URLSearchParams()).items.map(session => [session.title, session.id]));
  // An index written before version 16 kept no Claude Code version.
  recorder.db.exec("DELETE FROM session_facets WHERE kind='version'; UPDATE sessions SET version=''");
  const step = migrationTo(16);
  if (!("each" in step)) throw new Error("Version 16 fills one recording at a time.");
  step.each(recorder.db)({ id: ids["Versioned prompt"], named: 0 });
  expect(recorder.queries.getSession(ids["Versioned prompt"])?.version).toBe("2.1.302");
  expect(recorder.queries.getSession(ids["Plain prompt"])?.version).toBe("");
  expect(recorder.db.query<{ value: string }, []>("SELECT value FROM session_facets WHERE kind='version'").all().map(row => row.value)).toEqual(["2.1.302"]);
  expect(markedForRereading(recorder)).toEqual([]);
  expect(storedVersion(recorder)).toBe(indexVersion);
});
