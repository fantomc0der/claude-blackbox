import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, appendFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "../src/server/recorder";
import { parseSearch } from "../src/server/search";
import { removeTestDirectory } from "./helpers";
import type { IndexProgress } from "../src/shared/types";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "blackbox-test-"));
  const data = join(root, "claude");
  const project = join(data, "projects", "test-project");
  await mkdir(project, { recursive: true });
  const file = join(project, "session-a.jsonl");
  const record = (content: unknown, extra = {}) => JSON.stringify({
    type: "user", cwd: "C:\\work\\orbit", timestamp: "2026-09-19T12:00:00Z", sessionId: "session-a",
    message: { role: "user", content }, ...extra,
  });
  let recorder: Recorder | undefined;
  cleanup.push(async () => { await recorder?.close(); await removeTestDirectory(root); });
  return { root, data, project, file, record, open: async () => recorder = await Recorder.open(data, join(root, "state")) };
}

describe("recording index", () => {
  test("reports recording-file progress and completes unchanged and empty scans", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, fixtureData.record("First") + "\n" + fixtureData.record("Second") + "\n");
    const recorder = await fixtureData.open();
    const seen: IndexProgress[] = [];
    const changes: string[][] = [];
    recorder.progressListeners.add(progress => seen.push(progress));
    recorder.listeners.add(ids => changes.push(ids));
    await recorder.scan();
    expect(seen).toEqual([
      { phase: "discovering", checked: 0, total: 0 },
      { phase: "indexing", checked: 0, total: 1 },
      { phase: "idle", checked: 1, total: 1 },
    ]);
    expect(changes).toHaveLength(0);
    expect(recorder.indexing.checked).toBe(1);
    await rm(fixtureData.file);
    await recorder.scan();
    expect(recorder.indexing).toEqual({ phase: "idle", checked: 0, total: 0 });
    expect(changes.flat()).toHaveLength(1);
  });

  test("publishes checked counts while a long scan is still running", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, fixtureData.record("First") + "\n");
    const recorder = await fixtureData.open();
    const seen: IndexProgress[] = [];
    recorder.progressListeners.add(progress => seen.push(progress));
    let elapsed = 0;
    const clock = spyOn(performance, "now").mockImplementation(() => elapsed += 300);
    try { await recorder.scan(); }
    finally { clock.mockRestore(); }
    expect(seen).toContainEqual({ phase: "indexing", checked: 1, total: 1 });
    expect(seen.at(-1)).toEqual({ phase: "idle", checked: 1, total: 1 });
  });

  test("can open before the first index so the server binds immediately, then fills in on scan", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, fixtureData.record("Hello") + "\n");
    const recorder = await Recorder.open(fixtureData.data, join(fixtureData.root, "state"), { scan: false });
    cleanup.push(() => recorder.close());
    expect((await recorder.catalog()).sessions).toBe(0);
    expect((await recorder.catalog()).indexedAt).toBe("");
    const seen: string[][] = [];
    recorder.listeners.add(ids => seen.push(ids));
    await recorder.scan();
    expect((await recorder.catalog()).sessions).toBe(1);
    expect((await recorder.catalog()).indexedAt).not.toBe("");
    expect(seen.flat()).toHaveLength(1);
  });

  test("closing during a scan stops early without dropping recordings it had not reached", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, fixtureData.record("First") + "\n");
    await writeFile(join(fixtureData.project, "session-b.jsonl"), fixtureData.record("Second", { sessionId: "session-b" }) + "\n");
    const first = await fixtureData.open();
    expect(first.list(new URLSearchParams()).total).toBe(2);
    await first.close();
    const state = join(fixtureData.root, "state");
    const interrupted = await Recorder.open(fixtureData.data, state, { scan: false });
    const scanning = interrupted.scan();
    await interrupted.close();
    expect(await scanning).toEqual([]);
    const reopened = await Recorder.open(fixtureData.data, state, { scan: false });
    cleanup.push(() => reopened.close());
    expect(reopened.list(new URLSearchParams()).total).toBe(2);
    expect((await reopened.catalog()).indexedAt).toBe("");
  });

  test("closing after partial progress keeps the indexed recordings and leaves the rest for the next scan", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, fixtureData.record("First") + "\n");
    await writeFile(join(fixtureData.project, "session-b.jsonl"), fixtureData.record("Second", { sessionId: "session-b" }) + "\n");
    const state = join(fixtureData.root, "state");
    const interrupted = await Recorder.open(fixtureData.data, state, { scan: false });
    // The scan fingerprints each file right before it stores the file's row, so
    // closing from the first fingerprint stops the scan after exactly one file.
    const fingerprint = (interrupted as unknown as { fingerprint: (...args: unknown[]) => Promise<string> }).fingerprint.bind(interrupted);
    let closing: Promise<void> | undefined;
    (interrupted as unknown as { fingerprint: unknown }).fingerprint = (...args: unknown[]) => { closing ??= interrupted.close(); return fingerprint(...args); };
    const changed = await interrupted.scan();
    await closing;
    expect(changed).toHaveLength(1);
    const reopened = await Recorder.open(fixtureData.data, state, { scan: false });
    cleanup.push(() => reopened.close());
    const partial = reopened.list(new URLSearchParams());
    expect(partial.total).toBe(1);
    expect(partial.items[0].id).toBe(changed[0]);
    expect(reopened.events(changed[0], new URLSearchParams()).total).toBe(1);
    expect((await reopened.catalog()).indexedAt).toBe("");
    await reopened.scan();
    expect(reopened.list(new URLSearchParams()).total).toBe(2);
    expect((await reopened.catalog()).indexedAt).not.toBe("");
  });

  test("discovers sessions without history, handles CRLF, Unicode, unknown events and no final newline", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, [fixtureData.record("Fix café 🚀"), "malformed", fixtureData.record("recorded", { type: "future-event" })].join("\r\n"));
    const recorder = await fixtureData.open();
    const page = recorder.list(new URLSearchParams());
    expect(page.total).toBe(1);
    expect(page.items[0].title).toBe("Fix café 🚀");
    expect(page.items[0].workspace).toBe("orbit");
    const events = recorder.events(page.items[0].id, new URLSearchParams());
    expect(events.total).toBe(2);
    expect(events.items[1].type).toBe("future-event");
    expect((await recorder.catalog()).warnings).toBe(1);
    await recorder.scan();
    expect(recorder.events(page.items[0].id, new URLSearchParams()).total).toBe(2);
  });

  test("retries incomplete UTF-8 tails without skipping or duplicating records", async () => {
    const fixtureData = await fixture();
    const tail = Buffer.from(fixtureData.record("Résultat 🚀") + "\n");
    const split = tail.indexOf(Buffer.from("🚀")) + 2;
    await writeFile(fixtureData.file, Buffer.concat([Buffer.from(fixtureData.record("Start") + "\n"), tail.subarray(0, split)]));
    const recorder = await fixtureData.open();
    const id = recorder.list(new URLSearchParams()).items[0].id;
    expect(recorder.events(id, new URLSearchParams()).total).toBe(1);
    await appendFile(fixtureData.file, tail.subarray(split));
    await recorder.scan();
    const page = recorder.events(id, new URLSearchParams());
    expect(page.total).toBe(2);
    expect(page.items[1].blocks[0].text).toBe("Résultat 🚀");
    await recorder.scan();
    expect(recorder.events(id, new URLSearchParams()).total).toBe(2);
  });

  test("indexes tool-only content, supports phrase/exclusion and combined filters", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, [fixtureData.record("Fix auth"), fixtureData.record([
      { type: "tool_use", id: "call-1", name: "Edit", input: { file_path: "src/retry.ts", old_string: "1", new_string: "3" } },
    ], { type: "assistant" }), fixtureData.record([{ type: "tool_result", tool_use_id: "call-1", content: "retryBudget exceeded the default limit", is_error: true }])].join("\n") + "\n");
    const recorder = await fixtureData.open();
    const result = recorder.list(new URLSearchParams({ q: '"default limit" retryBudget', errors: "1", edits: "1", tool: "Edit" }));
    expect(result.total).toBe(1);
    expect(result.items[0].matchEventId).toBeTruthy();
    expect(recorder.list(new URLSearchParams({ q: "retryBudget -exceeded" })).total).toBe(0);
    expect(recorder.list(new URLSearchParams({ q: "-missing" })).total).toBe(1);
    expect(recorder.list(new URLSearchParams({ q: '" OR * "; DROP TABLE sessions;' })).total).toBe(0);
    expect(recorder.list(new URLSearchParams()).total).toBe(1);
  });

  test("builds search snippets from recorded content instead of the index serialization", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, [
      fixtureData.record("Make sign-in calmer"),
      fixtureData.record([{ type: "tool_use", id: "call-7", name: "Bash", input: { command: "bun test auth" } }], { type: "assistant" }),
      fixtureData.record([{ type: "tool_result", tool_use_id: "call-7", content: "12 checks passed and retryBudget stayed inside the configured ceiling" }]),
    ].join("\n") + "\n");
    const recorder = await fixtureData.open();
    const snippet = recorder.list(new URLSearchParams({ q: "retryBudget" })).items[0].snippet!;
    expect(snippet.startsWith("type:")).toBe(false);
    expect(snippet).not.toContain("tool_use_id");
    expect(snippet).toContain("retryBudget");
    expect(snippet).toContain("12 checks passed and retryBudget stayed inside the configured ceiling");
  });

  test("keeps prose snippets for punctuated terms the index tokenises apart", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, [
      fixtureData.record("Tighten the copy"),
      fixtureData.record([{ type: "tool_use", id: "call-3", name: "Read", input: { file_path: "src/auth.ts" } }], { type: "assistant" }),
      fixtureData.record([{ type: "tool_result", tool_use_id: "call-3", content: "The sign in screen still asks for the workspace twice" }]),
    ].join("\n") + "\n");
    const recorder = await fixtureData.open();
    const snippet = recorder.list(new URLSearchParams({ q: "sign-in" })).items[0].snippet!;
    expect(snippet.startsWith("type:")).toBe(false);
    expect(snippet).not.toContain("tool_use_id");
    expect(snippet).toContain("The sign in screen still asks for the workspace twice");
  });

  test("reconciles truncation, same-size replacements and deletion", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, fixtureData.record("old") + "\n");
    const recorder = await fixtureData.open();
    const id = recorder.list(new URLSearchParams()).items[0].id;
    await writeFile(fixtureData.file, fixtureData.record("new") + "\n");
    await utimes(fixtureData.file, new Date(), new Date(Date.now() + 1000));
    await recorder.scan();
    expect(recorder.getSession(id)?.title).toBe("new");
    expect(recorder.list(new URLSearchParams({ q: "old" })).total).toBe(0);
    await writeFile(fixtureData.file, "");
    await recorder.scan();
    expect(recorder.events(id, new URLSearchParams()).total).toBe(0);
    await rm(fixtureData.file);
    await recorder.scan();
    expect(recorder.list(new URLSearchParams()).total).toBe(0);
  });

  test("groups cloned folders reversibly, retaining cwd and distinct identical session IDs", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, fixtureData.record("Main session") + "\n");
    const second = join(fixtureData.data, "projects", "test-clone");
    await mkdir(second);
    await writeFile(join(second, "session-a.jsonl"), fixtureData.record("Worktree session", { cwd: "C:\\work\\orbit-feature" }) + "\n");
    const recorder = await fixtureData.open();
    const sessions = recorder.list(new URLSearchParams()).items;
    expect(sessions[0].id).not.toBe(sessions[1].id);
    const group = recorder.saveGroup({ name: "Orbit together", paths: sessions.map(session => session.cwd) });
    expect(recorder.list(new URLSearchParams({ workspace: group.id })).total).toBe(2);
    expect(recorder.list(new URLSearchParams({ workspace: group.id, cwd: sessions[0].cwd })).total).toBe(1);
    recorder.bookmark(sessions[0].id, true);
    expect(recorder.list(new URLSearchParams({ bookmarked: "1" })).total).toBe(1);
    expect(() => recorder.saveGroup({ name: "Conflict", paths: sessions.map(session => session.cwd) })).toThrow();
    recorder.deleteGroup(group.id);
    expect((await recorder.catalog()).workspaces.length).toBe(2);
    expect(recorder.getSession(sessions[0].id)?.cwd).toBe(sessions[0].cwd);
  });

  test("refuses state inside the source directory", async () => {
    const fixtureData = await fixture();
    await expect(Recorder.open(fixtureData.data, join(fixtureData.data, "cache"))).rejects.toThrow("outside");
  });

  test.skipIf(process.platform !== "win32")("compares state containment case-insensitively on Windows", async () => {
    const fixtureData = await fixture();
    await expect(Recorder.open(fixtureData.data, join(fixtureData.data.toUpperCase(), "cache"))).rejects.toThrow("outside");
  });

  test("includes subagents explicitly and lets discovery filter them out", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, fixtureData.record("Main recording") + "\n");
    await writeFile(join(fixtureData.project, "agent-worker.jsonl"), fixtureData.record("Delegated work") + "\n");
    const recorder = await fixtureData.open();
    expect(recorder.list(new URLSearchParams()).total).toBe(2);
    expect(recorder.list(new URLSearchParams({ agents: "0" })).total).toBe(1);
    expect(recorder.list(new URLSearchParams({ q: "Delegated" })).items[0].isAgent).toBe(true);
  });

  test("uses recorded session IDs and generated titles, not injected context", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, [
      fixtureData.record("Internal skill instructions", { isMeta: true }),
      fixtureData.record("Real user intent", { sessionId: "actual-session-id" }),
      JSON.stringify({ type: "ai-title", aiTitle: "Generated session title", sessionId: "actual-session-id" }),
      "", "",
    ].join("\n"));
    const recorder = await fixtureData.open();
    const session = recorder.list(new URLSearchParams()).items[0];
    expect(session.title).toBe("Generated session title");
    expect(session.sessionId).toBe("actual-session-id");
    expect(session.messageCount).toBe(1);
    expect((await recorder.catalog()).warnings).toBe(0);
    expect(recorder.events(session.id, new URLSearchParams({ kind: "conversation" })).total).toBe(1);
  });

  test("indexes legitimate data fields and pairs results outside the visible page", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, [
      fixtureData.record([{ type: "tool_use", name: "Custom", id: "call", input: { data: "payloadNeedle" } }], { type: "assistant" }),
      fixtureData.record("Another event"),
      fixtureData.record([{ type: "tool_result", tool_use_id: "call", content: "Finished" }]),
    ].join("\n") + "\n");
    const recorder = await fixtureData.open();
    const session = recorder.list(new URLSearchParams({ q: "payloadNeedle" })).items[0];
    expect(session).toBeDefined();
    expect(recorder.events(session.id, new URLSearchParams({ limit: "1" })).items).toHaveLength(1);
    expect(recorder.results(session.id, ["call"]).call.content).toBe("Finished");
    const plan = recorder.db.query<{ detail: string }, []>("EXPLAIN QUERY PLAN SELECT rowid FROM tool_results WHERE event_row=1").all();
    expect(plan.some(row => row.detail.includes("tool_results_event"))).toBe(true);
  });

  test("recovers an interrupted import from stored records without duplicates", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, fixtureData.record("Recorded once") + "\n");
    const first = await fixtureData.open();
    const session = first.list(new URLSearchParams()).items[0];
    first.db.query("UPDATE sessions SET events=0, cursor=0 WHERE id=?").run(session.id);
    await first.close();
    const recovered = await fixtureData.open();
    expect(recovered.getSession(session.id)?.eventCount).toBe(1);
    expect(recovered.events(session.id, new URLSearchParams()).total).toBe(1);
  });

  test("reindexes a larger replacement that shares the old prefix", async () => {
    const fixtureData = await fixture();
    const beginning = fixtureData.record("Unchanged prefix " + "a".repeat(350)) + "\n";
    await writeFile(fixtureData.file, beginning + fixtureData.record("RemoveThisRecord") + "\n");
    const recorder = await fixtureData.open();
    await writeFile(fixtureData.file, beginning + fixtureData.record("Replacement record with a significantly longer body") + "\n");
    await recorder.scan();
    expect(recorder.list(new URLSearchParams({ q: "RemoveThisRecord" })).total).toBe(0);
    expect(recorder.list(new URLSearchParams({ q: "Replacement" })).total).toBe(1);
    expect(recorder.list(new URLSearchParams()).items[0].eventCount).toBe(2);
  });
});

test("search parser treats phrases and exclusions as data", () => {
  expect(parseSearch('auth "retry budget" -timeout')).toEqual([
    { value: "auth", exclude: false }, { value: "retry budget", exclude: false }, { value: "timeout", exclude: true },
  ]);
});
