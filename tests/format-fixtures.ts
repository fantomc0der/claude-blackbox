import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Shape-only synthetic recordings, one per generation of Claude Code's recording format. Every record is built from
 * code with invented content: short prompts, paths under /synthetic, and fake ids. Only the shapes mirror Claude Code:
 * the record types, fields, and nesting each generation writes, as read from the Claude Code 2.1.302 binary and a
 * census of real recordings that kept counts only.
 *
 * `tests/format-generations.test.ts` pins what the index derives from each recording. When Claude Code changes its
 * format, refreshing a fixture here and the numbers there is a deliberate, reviewed step, so each builder says which
 * Claude Code behavior every record mirrors.
 */

export type JsonRecord = Record<string, unknown>;

export type Generation = "2.0" | "2.1.27x" | "2.1.30x" | "future";

export interface FormatFixture {
  generation: Generation;
  sessionId: string;
  cwd: string;
  /** A word of the recording's first prompt that appears in no other record's searchable text but a copy of it. */
  term: string;
  records: JsonRecord[];
}

interface TranscriptOptions { prefix: number; version: string; cwd: string; branch: string; start: string }

/** The session id of a fixture, a fake uuid whose first group names the fixture. */
function sessionOf(prefix: number): string {
  return `0000000${prefix}-5e55-4000-8000-000000000000`;
}

/**
 * A recording under construction. Transcript records get Claude Code's envelope (`parentUuid`, `isSidechain`,
 * `userType`, `cwd`, `sessionId`, `version`, `gitBranch`, `uuid`, `timestamp`), each linked to the previous one, with a
 * clock that advances a second per record. Bookkeeping and state records carry only what Claude Code writes on them.
 */
class Transcript {
  readonly records: JsonRecord[] = [];
  readonly sessionId: string;
  readonly startMs: number;
  cwd: string;
  private ids = 0;
  private parent: string | null = null;
  private clock: number;

  constructor(private readonly options: TranscriptOptions) {
    this.sessionId = sessionOf(options.prefix);
    this.cwd = options.cwd;
    this.startMs = this.clock = Date.parse(options.start);
  }

  /** The uuid the next transcript record takes, for a record Claude Code writes ahead of it. */
  nextUuid(): string {
    return `0000000${this.options.prefix}-0000-4000-8000-${String(this.ids + 1).padStart(12, "0")}`;
  }

  /** A fake id in Claude Code's style for a message, request, or tool call of this recording. */
  id(kind: "msg" | "req" | "toolu", name: string): string {
    return `${kind}_synthetic_${this.options.prefix}_${name}`;
  }

  now(): string {
    return new Date(this.clock).toISOString();
  }

  push(record: JsonRecord): JsonRecord {
    this.records.push(record);
    return record;
  }

  transcript(type: string, fields: JsonRecord): JsonRecord & { uuid: string } {
    this.clock += 1000;
    const uuid = this.nextUuid();
    this.ids++;
    const record = {
      parentUuid: this.parent, isSidechain: false, userType: "external", cwd: this.cwd, sessionId: this.sessionId,
      version: this.options.version, gitBranch: this.options.branch, type, ...fields, uuid, timestamp: this.now(),
    };
    this.parent = uuid;
    this.push(record);
    return record;
  }

  user(content: unknown, fields: JsonRecord = {}) {
    return this.transcript("user", { message: { role: "user", content }, ...fields });
  }

  assistant(message: JsonRecord, fields: JsonRecord = {}) {
    return this.transcript("assistant", { message: { type: "message", role: "assistant", ...message }, ...fields });
  }

  system(subtype: string, fields: JsonRecord) {
    return this.transcript("system", { subtype, ...fields });
  }

  attachment(attachment: JsonRecord) {
    return this.transcript("attachment", { attachment });
  }

  /** A session state or bookkeeping record, which Claude Code writes with the session id and no envelope. */
  state(type: string, fields: JsonRecord = {}): JsonRecord {
    return this.push({ type, ...fields, sessionId: this.sessionId });
  }
}

/** The token counts of one request, split the way the API reports a cache write. */
interface Counts { input: number; output: number; write5m: number; write1h: number; read: number }

function apiCounts(counts: Counts): JsonRecord {
  return {
    input_tokens: counts.input, cache_creation_input_tokens: counts.write5m + counts.write1h,
    cache_read_input_tokens: counts.read, output_tokens: counts.output,
  };
}

function cacheSplit(counts: Counts): JsonRecord {
  return { ephemeral_5m_input_tokens: counts.write5m, ephemeral_1h_input_tokens: counts.write1h };
}

/**
 * `message.usage` as Claude Code 2.1.27x and later record it: the four counts, the cache write split, the request's
 * service tier, speed, and region, and the server-side steps in `iterations`, whose `message` step repeats the
 * top-level counts. A record written while the reply still streams carries the counts the stream started with and its
 * output so far, without the steps.
 */
function usage(counts: Counts, options: { tier?: string; advisor?: JsonRecord; streamedOutput?: number } = {}): JsonRecord {
  const streaming = options.streamedOutput !== undefined;
  const top = { ...apiCounts(counts), ...(streaming && { output_tokens: options.streamedOutput }) };
  return {
    ...top, cache_creation: cacheSplit(counts), service_tier: options.tier ?? "standard", speed: "standard", inference_geo: "global",
    ...(!streaming && { iterations: [{ type: "message", ...apiCounts(counts), cache_creation: cacheSplit(counts) }, ...(options.advisor ? [options.advisor] : [])] }),
  };
}

interface Reply {
  name: string;
  model: string;
  blocks: JsonRecord[];
  counts: Counts;
  stop: "tool_use" | "end_turn";
  tier?: string;
  advisor?: JsonRecord;
  /** The output count on each record written before the last, as the stream reported it then. */
  streamed?: number[];
  /** `thinkingDurationMs` on the record that carries a thinking block. */
  thinkingMs?: number;
  /** Fields Claude Code 2.1.30x adds to every record of a reply, such as `requestedModel`. */
  fields?: JsonRecord;
}

/**
 * One API reply as Claude Code 2.1.27x and later record it: one `assistant` record per content block, all sharing the
 * reply's `message.id` and `requestId`, each with its block's `apiBlockIndex`. Only the last record carries the
 * reply's stop reason and final usage. Returns the content blocks, which a later request sends back.
 */
function reply(t: Transcript, spec: Reply): JsonRecord[] {
  spec.blocks.forEach((block, index) => {
    const last = index === spec.blocks.length - 1;
    t.assistant({
      id: t.id("msg", spec.name), model: spec.model, content: [block], stop_reason: last ? spec.stop : null, stop_sequence: null,
      usage: usage(spec.counts, last ? { tier: spec.tier, advisor: spec.advisor } : { tier: spec.tier, streamedOutput: spec.streamed?.[index] ?? 1 }),
    }, {
      ...(block.type === "thinking" && spec.thinkingMs !== undefined && { thinkingDurationMs: spec.thinkingMs }),
      apiBlockIndex: index, requestId: t.id("req", spec.name), ...spec.fields,
    });
  });
  return spec.blocks;
}

/** A thinking block Claude Code records without its text, kept only for its signature. */
const hiddenThinking = { type: "thinking", thinking: "", signature: "c3ludGhldGljLXNpZ25hdHVyZQ==" };

const text = (value: string) => ({ type: "text", text: value });
const toolUse = (id: string, name: string, input: JsonRecord) => ({ type: "tool_use", id, name, input });
const toolResult = (id: string, content: string, isError = false) => ({ tool_use_id: id, type: "tool_result", content, ...(isError && { is_error: true }) });

// The messages Claude Code writes into a tool result when a decision, rather than a failure, stopped the tool.
const rejected = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const cancelled = "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.";
const interrupted = "[Request interrupted by user for tool use]";

/**
 * Claude Code 2.0 (2.0.14). One `assistant` record per reply holds its text and tool call together, with the request's
 * usage and, as older builds did, the cost Claude Code computed in `costUSD`. There are no session state records. A
 * `summary` record titles the recording, a local command is written as info-level `system` records of subtype
 * `local_command`, a tool failure is a result marked `is_error`, and a refused permission is only the message Claude
 * Code writes into the result, with no `toolDenialKind`.
 */
export function generation20(): FormatFixture {
  const t = new Transcript({ prefix: 1, version: "2.0.14", cwd: "/synthetic/parser", branch: "main", start: "2025-10-14T09:00:00.000Z" });
  const model = "claude-sonnet-4-5-20250929";
  const counts = (input: number, write: number, read: number, output: number) =>
    ({ input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output, service_tier: "standard" });
  const answer = (name: string, content: JsonRecord[], usageCounts: JsonRecord, costUSD: number, stop: string) =>
    t.assistant({ id: t.id("msg", name), model, content, stop_reason: stop, stop_sequence: null, usage: usageCounts }, { requestId: t.id("req", name), costUSD });
  // `/model` run before the first prompt: the command, then its output.
  t.system("local_command", { content: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>", level: "info", isMeta: false });
  t.system("local_command", { content: "<local-command-stdout>Set model to synthetic-default</local-command-stdout>", level: "info", isMeta: false });
  t.user("Tidy the Quillfeather parser module");
  const read = t.id("toolu", "read");
  answer("a", [text("Reading the parser first."), toolUse(read, "Read", { file_path: "/synthetic/parser/src/parse.ts" })], counts(12, 1000, 0, 40), 0.0125, "tool_use");
  // A tool failure: Claude Code wraps the message in `<tool_use_error>` and repeats it in `toolUseResult`.
  t.user([toolResult(read, "<tool_use_error>File does not exist.</tool_use_error>", true)], { toolUseResult: "Error: File does not exist." });
  const edit = t.id("toolu", "edit");
  const change = { file_path: "/synthetic/parser/src/index.ts", old_string: "parseAll", new_string: "parseEach" };
  answer("b", [text("Editing the module instead."), toolUse(edit, "Edit", change)], counts(8, 200, 1000, 60), 0.0075, "tool_use");
  // The user refused the edit, and Claude Code follows the refusal with its interruption marker.
  t.user([toolResult(edit, rejected, true)], { toolUseResult: `Error: ${rejected}` });
  t.user([text(interrupted)]);
  t.user("Keep the change smaller");
  const last = answer("c", [text("Made a smaller change.")], counts(6, 0, 1200, 20), 0.005, "end_turn");
  // Claude Code 2.0 writes the summary that titles a recording in `claude --resume` at the top of the file, keyed by
  // the leaf of the conversation it summarizes.
  t.records.unshift({ type: "summary", summary: "Synthetic parser cleanup", leafUuid: last.uuid });
  return { generation: "2.0", sessionId: t.sessionId, cwd: "/synthetic/parser", term: "Quillfeather", records: t.records };
}

/**
 * Claude Code 2.1.27x (2.1.278). A reply is written a content block at a time (see `reply()`), with usage that splits
 * cache writes and lists its server-side steps. Each turn ends with a `system` record of subtype `turn_duration`, the
 * session's running cost in `cost-state`, and the `last-prompt` and `atis-latch` state records, which Claude Code
 * repeats after every turn. Hooks report through `attachment` records and a `stop_hook_summary`, a reasoning step that
 * shows no text carries the time it took in `thinkingDurationMs`, and a `file-history-snapshot` precedes the prompt.
 */
export function generation2127x(): FormatFixture {
  const t = new Transcript({ prefix: 2, version: "2.1.278", cwd: "/synthetic/garden", branch: "main", start: "2026-08-20T09:00:00.000Z" });
  const model = "claude-opus-5";
  const prompt = "Rename the Brindlewood helper";
  const second = "Now run the garden tests";
  // Claude Code snapshots the files it tracks, keyed by the prompt's uuid, before it writes the prompt.
  t.push({ type: "file-history-snapshot", messageId: t.nextUuid(), snapshot: { messageId: t.nextUuid(), trackedFileBackups: {}, timestamp: t.now() }, isSnapshotUpdate: false });
  t.user(prompt);
  const edit = t.id("toolu", "edit");
  reply(t, {
    name: "a", model, stop: "tool_use", thinkingMs: 1800, streamed: [10, 30], counts: { input: 3, output: 90, write5m: 1500, write1h: 500, read: 8000 },
    blocks: [hiddenThinking, text("Renaming the helper now."), toolUse(edit, "Edit", { file_path: "/synthetic/garden/src/helper.ts", old_string: "oldHelper", new_string: "newHelper" })],
  });
  t.user([toolResult(edit, "The file /synthetic/garden/src/helper.ts has been updated successfully.")],
    { toolUseResult: { filePath: "/synthetic/garden/src/helper.ts", oldString: "oldHelper", newString: "newHelper", userModified: false, replaceAll: false } });
  // A PostToolUse hook that ran and succeeded, reported against the tool call it followed.
  t.attachment({ type: "hook_success", hookName: "PostToolUse:Edit", toolUseID: edit, hookEvent: "PostToolUse", content: "", command: "bun run lint", stdout: "lint passed", stderr: "", exitCode: 0 });
  reply(t, { name: "b", model, stop: "end_turn", counts: { input: 5, output: 40, write5m: 300, write1h: 0, read: 10_000 }, blocks: [text("Renamed it everywhere.")] });
  // A Stop hook that ran without output: Claude Code writes the summary at the suggestion level with no errors.
  t.system("stop_hook_summary", {
    hookCount: 1, hookInfos: [{ command: "bun run format" }], hookErrors: [], preventedContinuation: false, stopReason: "", hasOutput: false,
    level: "suggestion", toolUseID: "synthetic-stop-hook",
  });
  t.system("turn_duration", { durationMs: 42_000, messageCount: 6, isMeta: false });
  const costState = (totalCostUSD: number, totalAPIDuration: number, totalToolDuration: number, totalDuration: number) => t.state("cost-state", {
    totalCostUSD, totalAPIDuration, totalAPIDurationWithoutRetries: totalAPIDuration, totalToolDuration, totalLinesAdded: 1, totalLinesRemoved: 1,
    totalDuration, startTime: t.startMs,
    // Keyed by the model string the session requested, which names its context window.
    modelUsage: { "claude-opus-5[1m]": { inputTokens: 12, outputTokens: 155, cacheReadInputTokens: 28_300, cacheCreationInputTokens: 2450, webSearchRequests: 0, costUSD: totalCostUSD } },
  });
  costState(0.0285, 30_000, 4000, 50_000);
  t.state("last-prompt", { lastPrompt: prompt, leafUuid: t.records.findLast(record => record.type === "assistant")!.uuid });
  t.state("atis-latch", { atis: "" });
  t.state("mode", { mode: "normal" });
  t.state("permission-mode", { permissionMode: "acceptEdits" });
  t.user(second);
  t.attachment({ type: "total_tokens_reminder", text: "Synthetic budget: 150000 tokens left." });
  reply(t, { name: "c", model, stop: "end_turn", counts: { input: 4, output: 25, write5m: 150, write1h: 0, read: 10_300 }, blocks: [text("All synthetic garden tests pass.")] });
  t.system("turn_duration", { durationMs: 18_000, messageCount: 10, isMeta: false });
  costState(0.0353, 45_000, 4000, 70_000);
  t.state("last-prompt", { lastPrompt: second, leafUuid: t.records.findLast(record => record.type === "assistant")!.uuid });
  t.state("atis-latch", { atis: "" });
  return { generation: "2.1.27x", sessionId: t.sessionId, cwd: "/synthetic/garden", term: "Brindlewood", records: t.records };
}

/** Nests a value `depth` objects deep. */
function nested(depth: number): JsonRecord {
  let value: JsonRecord = { leaf: "synthetic" };
  for (let level = 1; level < depth; level++) value = { level: value };
  return value;
}

/**
 * Claude Code 2.1.30x (2.1.302): everything 2.1.27x writes, plus the API request log, more session state, and the
 * kind of every decision. Before each request Claude Code writes the messages it adds as `api-request-blob` records,
 * keyed by hash and untimed, then a timestamped `api-request` that lists them, after an `api-request-shape` for a new
 * request shape. A queued prompt is a `queue-operation`; the title can come from an `ai-title` and an `agent-name`, which
 * outranks it; a pull request is a `pr-link`; a move to a worktree is a `relocated` record. A result a decision stopped
 * carries `toolDenialKind` on its record. A request that fails for good, and a turn that ends without a reply, are
 * written by Claude Code itself as `assistant` records with the `<synthetic>` model. Replies name the requested and the
 * advisor model, and a server-side advisor step lists its own model in `iterations`.
 *
 * `future` builds the same session as a newer Claude Code (2.2.0) might write it, adding a record of an unknown type, a
 * `system` record of an unknown subtype, an `attachment` of an unknown type, and a valid record 30 levels deep.
 */
export function generation2130x(future = false): FormatFixture {
  const prefix = future ? 4 : 3, version = future ? "2.2.0" : "2.1.302";
  const t = new Transcript({ prefix, version, cwd: "/synthetic/harbor", branch: "feature/streams", start: "2026-10-15T09:00:00.000Z" });
  const model = "claude-opus-5-5";
  const fields = { requestedModel: "claude-opus-5-5[1m]", advisorModel: "claude-fable-5-1" };
  const prompts = ["Port the Wrenfield importer to streams", "Retry the port with a smaller batch", "Continue the port in the worktree"];
  const reminder = text("<system-reminder>Synthetic reminder: follow the harbor style guide.</system-reminder>");
  // The request log: each new message once as a blob, then the request that sends it after those it keeps.
  let requests = 0, kept = 0, lastRequest = "";
  const send = (messages: JsonRecord[]) => {
    const tail = messages.map((message, index) => {
      const hash = `synthetic-hash-${prefix}-${requests + 1}-${index}`;
      t.state("api-request-blob", { hash, message });
      return hash;
    });
    const id = `synthetic-request-${prefix}-${++requests}`;
    t.state("api-request", {
      id, timestamp: t.now(), version, querySource: "repl_main_thread", shapeHash: "synthetic-shape",
      params: { model, max_tokens: 32_000 }, ...(kept > 0 && { base: lastRequest }), keep: kept, tail, requestDigest: `synthetic-digest-${requests}`,
    });
    kept += tail.length;
    lastRequest = id;
  };
  const decided = (id: string, content: string, toolDenialKind: string) => t.user([toolResult(id, content, true)], { toolUseResult: `Error: ${content}`, toolDenialKind });
  const endTurn = (prompt: string) => {
    t.state("last-prompt", { lastPrompt: prompt, leafUuid: t.records.findLast(record => record.type === "assistant")!.uuid });
    t.state("atis-latch", { atis: "" });
  };
  // The tracker keeps the advisor's tokens and cost under the advisor's own model.
  const costState = (totalCostUSD: number, totalAPIDuration: number, totalToolDuration: number, opus: number, advisor: number) => t.state("cost-state", {
    totalCostUSD, totalAPIDuration, totalAPIDurationWithoutRetries: totalAPIDuration, totalToolDuration, totalLinesAdded: 0, totalLinesRemoved: 0,
    totalDuration: totalAPIDuration + totalToolDuration, startTime: t.startMs,
    modelUsage: {
      "claude-opus-5-5[1m]": { inputTokens: 22, outputTokens: 440, cacheReadInputTokens: 14_000, cacheCreationInputTokens: 4400, webSearchRequests: 0, costUSD: opus },
      "claude-fable-5-1": { inputTokens: 800, outputTokens: 64, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: advisor },
    },
  });

  // Turn 1: four requests, each stopped by a different decision after the first tool ran.
  t.push({ type: "file-history-snapshot", messageId: t.nextUuid(), snapshot: { messageId: t.nextUuid(), trackedFileBackups: {}, timestamp: t.now() }, isSnapshotUpdate: false });
  t.user(prompts[0]);
  t.state("api-request-shape", { shapeHash: "synthetic-shape", timestamp: t.now(), version, shape: { model, tools: ["Read", "Edit", "Bash", "WebFetch"] } });
  // The prompt as sent: Claude Code adds the context it composed to the user's words.
  send([{ role: "user", content: [reminder, text(prompts[0])] }]);
  const read = t.id("toolu", "read");
  const first = reply(t, {
    name: "a", model, stop: "tool_use", thinkingMs: 2400, streamed: [12, 50], fields, counts: { input: 6, output: 120, write5m: 3000, write1h: 0, read: 0 },
    // A server-side advisor step: the API lists its tokens apart from the top-level counts, under its own model.
    advisor: { type: "advisor_message", model: "claude-fable-5-1", input_tokens: 800, output_tokens: 64, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    blocks: [hiddenThinking, text("Reading the importer first."), toolUse(read, "Read", { file_path: "/synthetic/harbor/src/importer.ts" })],
  });
  const readResult = toolResult(read, "     1\texport function importAll() {}\n");
  t.user([readResult], { toolUseResult: { type: "text", file: { filePath: "/synthetic/harbor/src/importer.ts", numLines: 1, startLine: 1, totalLines: 1 } } });
  t.attachment({ type: "hook_success", hookName: "PostToolUse:Read", toolUseID: read, hookEvent: "PostToolUse", content: "", command: "bun run lint", stdout: "lint passed", stderr: "", exitCode: 0 });
  if (future) t.attachment({ type: "context_digest", digest: "Cobaltreach context digest from a newer Claude Code" });
  send([{ role: "assistant", content: first }, { role: "user", content: [readResult] }]);
  const edit = t.id("toolu", "edit");
  const second = reply(t, {
    name: "b", model, stop: "tool_use", fields, counts: { input: 4, output: 80, write5m: 400, write1h: 0, read: 3000 },
    blocks: [toolUse(edit, "Edit", { file_path: "/synthetic/harbor/src/importer.ts", old_string: "importAll", new_string: "importStream" })],
  });
  decided(edit, rejected, "user-rejected");
  send([{ role: "assistant", content: second }, { role: "user", content: [toolResult(edit, rejected, true)] }]);
  const remove = t.id("toolu", "rm");
  // Served at the priority tier, which the API bills above the standard rates.
  const third = reply(t, {
    name: "c", model, stop: "tool_use", tier: "priority", fields, counts: { input: 3, output: 60, write5m: 200, write1h: 0, read: 3400 },
    blocks: [toolUse(remove, "Bash", { command: "rm -rf /synthetic/harbor/tmp", description: "Clear the scratch folder" })],
  });
  // A PreToolUse hook stopped the call; Claude Code files a hook's denial as a permission rule.
  const blocked = "Execution stopped by PreToolUse hook: synthetic policy forbids rm -rf";
  decided(remove, blocked, "permission-rule");
  send([{ role: "assistant", content: third }, { role: "user", content: [toolResult(remove, blocked, true)] }]);
  const test = t.id("toolu", "test"), fetch = t.id("toolu", "fetch");
  reply(t, {
    name: "d", model, stop: "tool_use", streamed: [30], fields, counts: { input: 5, output: 110, write5m: 300, write1h: 0, read: 3600 },
    blocks: [toolUse(test, "Bash", { command: "bun test", description: "Run the tests" }), toolUse(fetch, "WebFetch", { url: "https://example.invalid/synthetic-streams", prompt: "Summarize the stream API" })],
  });
  // The next prompt, typed while the tools ran, waits in Claude Code's queue.
  t.state("queue-operation", { operation: "enqueue", timestamp: t.now(), content: prompts[1] });
  // The user pressed Escape: the fetch was dropped before it ran and the test run was cut short, and Claude Code
  // follows them with its interruption marker.
  decided(fetch, cancelled, "cancelled");
  decided(test, interrupted, "interrupted");
  t.user([text(interrupted)]);
  t.system("turn_duration", { durationMs: 30_000, messageCount: 18, pendingBackgroundAgentCount: 0, pendingWorkflowCount: 0, isMeta: false });
  costState(0.0402, 30_000, 5000, 0.029, 0.0112);
  endTurn(prompts[0]);
  t.state("ai-title", { aiTitle: "Port the importer to streams" });
  t.state("pr-link", { prNumber: 7, prUrl: "https://example.invalid/synthetic/harbor/pull/7", prRepository: "synthetic/harbor", timestamp: t.now() });
  if (future) t.state("session-insight", { content: "Cobaltreach insight from a newer Claude Code" });
  t.state("mode", { mode: "normal" });
  t.state("permission-mode", { permissionMode: "default" });

  // Turn 2: the queued prompt, whose request failed for good on the usage limit.
  t.user(prompts[1]);
  send([{ role: "user", content: [text(prompts[1])] }]);
  const standIn = (name: string, content: string, extra: JsonRecord = {}) => t.assistant({
    id: t.id("msg", name), model: "<synthetic>", stop_reason: "stop_sequence", stop_sequence: "", content: [text(content)],
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  }, extra);
  // The request that failed for good: Claude Code records the error kind, its cause, and the HTTP status beside its text.
  standIn("e", "API Error: Synthetic usage limit reached", { isApiErrorMessage: true, error: "rate_limit", apiError: "usage_limit_reached", apiErrorStatus: 429, requestId: t.id("req", "e") });
  // The turn's stand-in for a reply that never came, which carries no error marks.
  standIn("g", "No response requested.");
  if (future) t.system("plan_checkpoint", { content: "Cobaltreach plan checkpoint saved", level: "info", isMeta: false });
  t.system("turn_duration", { durationMs: 2000, messageCount: 21, pendingBackgroundAgentCount: 0, pendingWorkflowCount: 0, isMeta: false });
  endTurn(prompts[1]);
  // EnterWorktree moved the recording to the worktree's project folder and stamped the move.
  const worktree = "/synthetic/harbor/.claude/worktrees/streams";
  t.state("relocated", { relocatedCwd: worktree });
  t.cwd = worktree;
  t.state("agent-name", { agentName: "Stream porter" });

  // Turn 3, in the worktree.
  t.user(prompts[2]);
  t.attachment({ type: "total_tokens_reminder", text: "Synthetic budget: 120000 tokens left." });
  send([{ role: "user", content: [text(prompts[2])] }]);
  reply(t, { name: "f", model, stop: "end_turn", fields, counts: { input: 4, output: 70, write5m: 250, write1h: 250, read: 4000 }, blocks: [text("Continued the port in the worktree.")] });
  t.system("stop_hook_summary", {
    hookCount: 1, hookInfos: [{ command: "bun run format" }], hookErrors: [], hookAdditionalContext: [], preventedContinuation: false, stopReason: "",
    hasOutput: false, level: "suggestion", toolUseID: "synthetic-stop-hook", hookLabel: "Stop", totalDurationMs: 300,
  });
  if (future) t.attachment({ type: "structured_output", data: nested(28) });
  t.system("turn_duration", { durationMs: 25_000, messageCount: 24, pendingBackgroundAgentCount: 0, pendingWorkflowCount: 0, isMeta: false });
  costState(0.0512, 52_000, 6000, 0.04, 0.0112);
  endTurn(prompts[2]);
  return { generation: future ? "future" : "2.1.30x", sessionId: t.sessionId, cwd: "/synthetic/harbor", term: "Wrenfield", records: t.records };
}

/** Every generation's fixture, oldest first. */
export function formatFixtures(): FormatFixture[] {
  return [generation20(), generation2127x(), generation2130x(), generation2130x(true)];
}

/** Writes each fixture as Claude Code lays a recording out: `projects/<cwd with separators as dashes>/<session id>.jsonl`. */
export async function writeFormatFixtures(dataDir: string, fixtures: FormatFixture[]): Promise<Map<Generation, string>> {
  const paths = new Map<Generation, string>();
  for (const fixture of fixtures) {
    const folder = join(dataDir, "projects", fixture.cwd.replace(/[^A-Za-z0-9]/g, "-"));
    await mkdir(folder, { recursive: true });
    const path = join(folder, `${fixture.sessionId}.jsonl`);
    await writeFile(path, fixture.records.map(record => JSON.stringify(record)).join("\n") + "\n");
    paths.set(fixture.generation, path);
  }
  return paths;
}
