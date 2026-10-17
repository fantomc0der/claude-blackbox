import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "../src/server/recorder";
import { indexVersion, migrations, migrationTo } from "../src/server/migrations";
import { removeTestDirectory } from "./helpers";

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
    open: async () => recorder = await Recorder.open(data, join(root, "state")),
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

test("a whole-index step applied on its own marks only the recordings it names and leaves the version alone", async () => {
  const setup = await fixture();
  await setup.write("costed", [record("Price the work"), { type: "cost-state", sessionId: "synthetic", totalCostUSD: 1.27 }]);
  await setup.write("plain", [record("Plain prompt")]);
  const recorder = await setup.open();
  expect(markedForRereading(recorder)).toEqual([]);
  const step = migrationTo(13);
  if (!("apply" in step)) throw new Error("Version 13 marks recordings across the whole index.");
  step.apply(recorder.db);
  expect(markedForRereading(recorder)).toEqual(["Price the work"]);
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
