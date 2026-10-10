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

  test("hides subagents by default and includes them only when requested", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, fixtureData.record("Main recording") + "\n");
    await writeFile(join(fixtureData.project, "agent-worker.jsonl"), fixtureData.record("Delegated work") + "\n");
    const recorder = await fixtureData.open();
    expect(recorder.list(new URLSearchParams()).total).toBe(1);
    expect(recorder.list(new URLSearchParams({ agents: "1" })).total).toBe(2);
    expect(recorder.list(new URLSearchParams({ agents: "only" })).total).toBe(1);
    expect(recorder.list(new URLSearchParams({ agents: "0" })).total).toBe(1);
    expect(recorder.list(new URLSearchParams({ q: "Delegated" })).total).toBe(0);
    expect(recorder.list(new URLSearchParams({ q: "Delegated", agents: "1" })).items[0].isAgent).toBe(true);
  });

  test("links nested and legacy subagents without matching unrelated projects or parents", async () => {
    const setup = await fixture();
    await writeFile(setup.file, setup.record("Main recording") + "\n");
    const nested = join(setup.project, "session-a", "subagents");
    const unrelated = join(setup.project, "session-other", "subagents");
    const otherProject = join(setup.data, "projects", "other-project");
    for (const folder of [nested, unrelated, otherProject]) await mkdir(folder, { recursive: true });
    await writeFile(join(nested, "agent-nested.jsonl"), setup.record("Nested task", { sessionId: "own-agent-id", cwd: "C:\\work\\isolated-agent" }) + "\n");
    await writeFile(join(setup.project, "agent-legacy.jsonl"), setup.record("Legacy task") + "\n");
    await writeFile(join(unrelated, "agent-unrelated.jsonl"), setup.record("Different parent") + "\n");
    await writeFile(join(otherProject, "agent-copy.jsonl"), setup.record("Different project") + "\n");
    const recorder = await setup.open();
    const parent = recorder.list(new URLSearchParams()).items[0];
    const children = recorder.subagents(parent.id);
    expect(children.map(agent => agent.title).sort()).toEqual(["Legacy task", "Nested task"]);
    expect(recorder.subagents(children[0].id)).toEqual([]);
    expect(recorder.subagents("missing")).toEqual([]);
    expect(recorder.getSession(children[0].id)?.isAgent).toBe(true);
    recorder.bookmark(children[0].id, true);
    const catalog = await recorder.catalog();
    expect(catalog.mainSessions).toBe(1);
    expect(catalog.mainBookmarked).toBe(0);
    expect(catalog.workspaces.find(workspace => workspace.id === "C:\\work\\isolated-agent")?.mainCount).toBe(0);
    const group = recorder.saveGroup({ name: "With agent worktree", paths: [parent.cwd, "C:\\work\\isolated-agent"] });
    expect((await recorder.catalog()).workspaces.find(workspace => workspace.id === group.id)).toMatchObject({ count: 5, mainCount: 1 });
    expect(recorder.list(new URLSearchParams({ workspace: group.id })).total).toBe(1);
    expect(recorder.list(new URLSearchParams({ workspace: group.id, agents: "1" })).total).toBe(5);
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

  test("resolves evidence-backed nested session families without crossing projects", async () => {
    const fixtureData = await fixture();
    const root = fixtureData.file;
    const agents = join(fixtureData.project, "session-a", "subagents");
    const otherAgents = join(fixtureData.root, "claude", "projects", "other", "session-a", "subagents");
    const orphanAgents = join(fixtureData.project, "orphan", "subagents");
    await mkdir(agents, { recursive: true });
    await mkdir(otherAgents, { recursive: true });
    await mkdir(orphanAgents, { recursive: true });
    const event = (sessionId: string, content: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ type: "assistant", cwd: "C:\\work\\orbit", timestamp: "2026-09-19T12:00:00Z", sessionId, message: { role: "assistant", content }, ...extra });
    await writeFile(root, [
      event("root", [{ type: "tool_use", id: "launch-child", name: "Agent", input: { description: "Research implementation" } }]),
      event("root", [{ type: "tool_result", tool_use_id: "launch-child", content: "agent_id: child-123" }]),
      event("root", [{ type: "tool_use", id: "unknown-launch", name: "Agent", input: { description: "No indexed child" } }]),
      event("root", [{ type: "tool_result", tool_use_id: "unknown-launch", content: "agentId: missing-child" }]),
    ].join("\n") + "\n");
    await writeFile(join(agents, "agent-child-123.jsonl"), [
      event("child", "Child title", { type: "user" }),
      event("child", [{ type: "tool_use", id: "launch-grandchild", name: "task", input: { description: "Validate nested work" } }]),
      event("child", [{ type: "tool_result", tool_use_id: "launch-grandchild", content: "done" }], { toolUseResult: { agentId: "grand-456" } }),
    ].join("\n") + "\n");
    await writeFile(join(agents, "agent-grand-456.jsonl"), event("grand", "Grandchild title", { type: "user" }) + "\n");
    await writeFile(join(agents, "agent-unlinked.jsonl"), event("unlinked", "Unlinked title", { type: "user" }) + "\n");
    await writeFile(join(fixtureData.project, "agent-legacy.jsonl"), event("root", "Legacy title", { type: "user" }) + "\n");
    await writeFile(join(otherAgents, "agent-cross.jsonl"), event("cross", "Cross project", { type: "user" }) + "\n");
    await writeFile(join(orphanAgents, "agent-orphan.jsonl"), event("orphan", "Orphan title", { type: "user" }) + "\n");
    const recorder = await fixtureData.open();
    const sessions = recorder.list(new URLSearchParams({ agents: "1", limit: "50" })).items;
    const byTitle = new Map(sessions.map(session => [session.title, session]));
    const family = recorder.family(recorder.list(new URLSearchParams()).items.find(session => session.title.startsWith("Session root"))!.id);
    const child = byTitle.get("Child title")!, grandchild = byTitle.get("Grandchild title")!, legacy = byTitle.get("Legacy title")!, unlinked = byTitle.get("Unlinked title")!;
    expect(family.rootId).toBe(family.members[0].session.id);
    expect(family.launches).toEqual({ "launch-child": child.id });
    expect(family.members.map(member => member.session.id)).toContain(child.id);
    expect(family.members.map(member => member.session.id)).toContain(grandchild.id);
    expect(family.members.map(member => member.session.id)).toContain(legacy.id);
    expect(family.members.map(member => member.session.id)).toContain(unlinked.id);
    expect(family.members.map(member => member.session.title)).not.toContain("Cross project");
    expect(family.members.find(member => member.session.id === child.id)).toMatchObject({ parentId: family.rootId, spawnToolId: "launch-child", label: "Research implementation", depth: 1 });
    expect(family.members.find(member => member.session.id === grandchild.id)).toMatchObject({ parentId: child.id, spawnToolId: "launch-grandchild", label: "Validate nested work", depth: 2 });
    expect(family.members.find(member => member.session.id === legacy.id)).toMatchObject({ parentId: null, spawnToolId: null, depth: null });
    expect(family.members.find(member => member.session.id === unlinked.id)).toMatchObject({ parentId: null, spawnToolId: null, depth: null });
    expect(recorder.family(child.id).launches).toEqual({ "launch-grandchild": grandchild.id });
    const orphan = byTitle.get("Orphan title")!;
    expect(recorder.family(orphan.id)).toMatchObject({ rootId: null, launches: {}, members: [{ session: { id: orphan.id }, parentId: null, spawnEventId: null, spawnToolId: null, depth: null }] });
  });

  test("refreshes family launches from newly indexed exact tool results", async () => {
    const fixtureData = await fixture();
    const agents = join(fixtureData.project, "session-a", "subagents");
    await mkdir(agents, { recursive: true });
    const event = (content: unknown) => fixtureData.record(content, { type: "assistant" });
    await writeFile(fixtureData.file, event([{ type: "tool_use", id: "launch", name: "Agent", input: { description: "Refresh child" } }]) + "\n");
    await writeFile(join(agents, "agent-refresh.jsonl"), fixtureData.record("Refresh child", { type: "user", sessionId: "refresh" }) + "\n");
    const recorder = await fixtureData.open();
    const root = recorder.list(new URLSearchParams()).items.find(session => !session.isAgent)!;
    expect(recorder.family(root.id).launches).toEqual({});
    await appendFile(fixtureData.file, event([{ type: "tool_result", tool_use_id: "launch", content: "agentId: refresh" }]) + "\n");
    await recorder.scan();
    const child = recorder.list(new URLSearchParams({ agents: "1" })).items[0];
    expect(recorder.family(root.id).launches).toEqual({ launch: child.id });
  });

  test("requires a single exact launch identifier before linking or exposing navigation", async () => {
    const fixtureData = await fixture();
    const agents = join(fixtureData.project, "session-a", "subagents");
    await mkdir(agents, { recursive: true });
    const event = (content: unknown) => fixtureData.record(content, { type: "assistant" });
    const launch = (id: string, result: string) => [
      event([{ type: "tool_use", id, name: "Agent", input: { description: id } }]),
      event([{ type: "tool_result", tool_use_id: id, content: result }]),
    ];
    await writeFile(fixtureData.file, [
      ...launch("inline", "Inline prose mentions agent_id: inline-child but is not metadata."),
      ...launch("conflict", "agent_id: conflict-child\nagentId: unknown-child"),
      ...launch("repeat-one", "agent_id: repeated-child"),
      ...launch("repeat-two", "agent_id: repeated-child"),
    ].join("\n") + "\n");
    for (const name of ["inline-child", "conflict-child", "repeated-child"]) {
      await writeFile(join(agents, `agent-${name}.jsonl`), fixtureData.record(name, { type: "user", sessionId: name }) + "\n");
    }
    const recorder = await fixtureData.open();
    const root = recorder.list(new URLSearchParams()).items.find(session => !session.isAgent)!;
    const family = recorder.family(root.id);
    expect(family.launches).toEqual({});
    for (const member of family.members.filter(member => member.session.isAgent)) {
      expect(member).toMatchObject({ parentId: null, spawnEventId: null, spawnToolId: null, depth: null });
    }
  });

  test("limits large families while retaining the requested descendant", async () => {
    const fixtureData = await fixture();
    await writeFile(fixtureData.file, fixtureData.record("Root") + "\n");
    const recorder = await fixtureData.open();
    const root = recorder.list(new URLSearchParams()).items.find(session => !session.isAgent)!;
    const agents = join(fixtureData.project, "session-a", "subagents");
    let requestedId = "";
    for (let index = 0; index <= 500; index++) {
      const id = (1000 + index).toString(16).padStart(24, "0");
      recorder.db.query("INSERT INTO sessions(id,session_id,source,cwd,title,started,updated,agent) VALUES (?,?,?,?,?,?,?,1)")
        .run(id, `limit-${index}`, join(agents, `agent-limit-${index}.jsonl`), "C:\\work\\orbit", `Limited ${index}`, "2026-09-19T12:00:00Z", "2026-09-19T12:00:00Z");
      if (index === 500) requestedId = id;
    }
    const family = recorder.family(requestedId);
    expect(family).toMatchObject({ rootId: root.id, limited: true });
    expect(family.members).toHaveLength(501);
    expect(family.launches).toEqual({});
    expect(family.members.find(member => member.session.id === requestedId)).toMatchObject({ parentId: null, depth: null });
  });

  test("matches structured launch metadata and annotated marker lines without using the event owner", async () => {
    const fixtureData = await fixture();
    const agents = join(fixtureData.project, "session-a", "subagents");
    await mkdir(agents, { recursive: true });
    const launch = (id: string, content: unknown, metadata = {}) => [
      fixtureData.record([{ type: "tool_use", id, name: "Agent", input: { description: id } }], { type: "assistant" }),
      fixtureData.record([{ type: "tool_result", tool_use_id: id, content }], metadata),
    ];
    await writeFile(fixtureData.file, [
      ...launch("structured", "agentId: structured-child (synthetic continuation annotation)", { toolUseResult: { agentId: "structured-child" } }),
      ...launch("text-fallback", [{ type: "text", text: "Synthetic completion" }, { type: "text", text: "agent_id: text-child (synthetic continuation annotation)" }]),
      ...launch("owner-only", "Synthetic completion without launch metadata", { agentId: "owner-child" }),
      ...launch("conflicting", "agentId: other-child (synthetic continuation annotation)", { toolUseResult: { agentId: "conflict-child" } }),
      ...launch("prose", "agentId: prose-child mentioned in prose, not a metadata annotation"),
    ].join("\n") + "\n");
    for (const name of ["structured-child", "text-child", "owner-child", "conflict-child", "other-child", "prose-child"]) {
      await writeFile(join(agents, `agent-${name}.jsonl`), fixtureData.record(name, { sessionId: name }) + "\n");
    }
    const recorder = await fixtureData.open();
    const root = recorder.list(new URLSearchParams()).items[0];
    const family = recorder.family(root.id);
    const childId = (title: string) => family.members.find(member => member.session.title === title)!.session.id;
    expect(family.launches).toEqual({ structured: childId("structured-child"), "text-fallback": childId("text-child") });
    for (const title of ["owner-child", "conflict-child", "other-child", "prose-child"]) {
      expect(family.members.find(member => member.session.title === title)).toMatchObject({ parentId: null, spawnToolId: null });
    }
  });

  test("large families retain exact root launch targets beyond the initial member window", async () => {
    const fixtureData = await fixture();
    const launch = (id: string, agentId: string) => [
      fixtureData.record([{ type: "tool_use", id, name: "Agent", input: { description: id } }], { type: "assistant" }),
      fixtureData.record([{ type: "tool_result", tool_use_id: id, content: `agentId: ${agentId}` }]),
    ];
    await writeFile(fixtureData.file, [
      ...launch("inside", "limit-0"), ...launch("outside", "late-child"),
      ...launch("repeated-one", "limit-1"), ...launch("repeated-two", "limit-1"),
      ...launch("duplicate", "limit-2"), ...launch("cross-project", "foreign-child"),
      ...launch("missing", "missing-child"),
    ].join("\n") + "\n");
    const recorder = await fixtureData.open();
    const root = recorder.list(new URLSearchParams()).items[0];
    const agents = join(fixtureData.project, "session-a", "subagents");
    const insert = recorder.db.query("INSERT INTO sessions(id,session_id,source,cwd,title,started,updated,agent) VALUES (?,?,?,?,?,?,?,1)");
    for (let index = 0; index <= 500; index++) {
      insert.run((1000 + index).toString(16).padStart(24, "0"), `limit-${index}`, join(agents, `agent-limit-${index}.jsonl`), "C:\\work\\orbit", `Limited ${index}`, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    }
    const lateId = "f".repeat(24);
    insert.run(lateId, "late-child", join(agents, "agent-late-child.jsonl"), "C:\\work\\orbit", "Later child", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z");
    insert.run("e".repeat(24), "duplicate", join(agents, "nested", "subagents", "agent-limit-2.jsonl"), "C:\\work\\orbit", "Duplicate outside window", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z");
    insert.run("d".repeat(24), "foreign-child", join(fixtureData.data, "projects", "other", "session-a", "subagents", "agent-foreign-child.jsonl"), "C:\\work\\other", "Other project", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z");
    const family = recorder.family(root.id);
    expect(family.limited).toBe(true);
    expect(family.members).toHaveLength(501);
    expect(family.launches).toEqual({ inside: (1000).toString(16).padStart(24, "0"), outside: lateId });
    expect(family.members.find(member => member.session.id === lateId)).toMatchObject({ label: "outside", parentId: null, spawnEventId: null, spawnToolId: null, depth: null });
    expect(family.members.every(member => member.parentId === null && member.spawnEventId === null)).toBe(true);
  });

  test("large families retain a viewed subagent and its own exact launch targets", async () => {
    const fixtureData = await fixture();
    const agents = join(fixtureData.project, "session-a", "subagents");
    await mkdir(agents, { recursive: true });
    await writeFile(fixtureData.file, fixtureData.record("Root") + "\n");
    await writeFile(join(agents, "agent-viewed.jsonl"), [
      fixtureData.record("Viewed worker", { sessionId: "viewed" }),
      fixtureData.record([{ type: "tool_use", id: "direct", name: "Task", input: { description: "Direct recording" } }], { type: "assistant", sessionId: "viewed" }),
      fixtureData.record([{ type: "tool_result", tool_use_id: "direct", content: "agent_id: direct-child" }], { sessionId: "viewed" }),
      fixtureData.record([{ type: "tool_use", id: "self", name: "Agent", input: {} }], { type: "assistant", sessionId: "viewed" }),
      fixtureData.record([{ type: "tool_result", tool_use_id: "self", content: "agentId: viewed" }], { sessionId: "viewed" }),
    ].join("\n") + "\n");
    const recorder = await fixtureData.open();
    const viewed = recorder.list(new URLSearchParams({ agents: "only" })).items[0];
    const insert = recorder.db.query("INSERT INTO sessions(id,session_id,source,title,started,updated,agent) VALUES (?,?,?,?,?,?,1)");
    for (let index = 0; index <= 500; index++) {
      insert.run((1000 + index).toString(16).padStart(24, "0"), `filler-${index}`, join(agents, `agent-filler-${index}.jsonl`), "Filler", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    }
    const targetId = "f".repeat(24);
    insert.run(targetId, "direct-child", join(agents, "agent-direct-child.jsonl"), "Direct target", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z");
    const family = recorder.family(viewed.id);
    expect(family.limited).toBe(true);
    expect(family.members).toHaveLength(501);
    expect(family.launches).toEqual({ direct: targetId });
    expect(family.members.map(member => member.session.id)).toContain(viewed.id);
    expect(family.members.find(member => member.session.id === targetId)).toMatchObject({ parentId: null, spawnEventId: null, depth: null });
  });

  test("does not fabricate parentage from cyclic launch evidence", async () => {
    const fixtureData = await fixture();
    const agents = join(fixtureData.project, "session-a", "subagents");
    await mkdir(agents, { recursive: true });
    const event = (sessionId: string, content: unknown) => JSON.stringify({ type: "assistant", sessionId, message: { role: "assistant", content } });
    await writeFile(fixtureData.file, fixtureData.record("Root") + "\n");
    await writeFile(join(agents, "agent-one.jsonl"), [
      event("one", [{ type: "tool_use", id: "to-two", name: "Agent", input: {} }]),
      event("one", [{ type: "tool_result", tool_use_id: "to-two", content: "agentId: two" }]),
    ].join("\n") + "\n");
    await writeFile(join(agents, "agent-two.jsonl"), [
      event("two", [{ type: "tool_use", id: "to-one", name: "Task", input: {} }]),
      event("two", [{ type: "tool_result", tool_use_id: "to-one", content: "agent_id: one" }]),
    ].join("\n") + "\n");
    const recorder = await fixtureData.open();
    const root = recorder.list(new URLSearchParams()).items.find(session => !session.isAgent)!;
    const family = recorder.family(root.id);
    expect(family.members.filter(member => member.session.isAgent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ parentId: null, spawnEventId: null, spawnToolId: null, depth: null }),
      expect.objectContaining({ parentId: null, spawnEventId: null, spawnToolId: null, depth: null }),
    ]));
  });
});

test("search parser treats phrases and exclusions as data", () => {
  expect(parseSearch('auth "retry budget" -timeout')).toEqual([
    { value: "auth", exclude: false }, { value: "retry budget", exclude: false }, { value: "timeout", exclude: true },
  ]);
});
