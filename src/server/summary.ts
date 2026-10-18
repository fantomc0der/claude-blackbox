import { posix, win32 } from "node:path";
import { createHash } from "node:crypto";
import { stripAnsi } from "../shared/ansi";
import { commandCategory, commandParts, commandSteps } from "./command-parts";
import { object, promptLine, string } from "./normalize";
import type { Decision } from "../shared/decisions";
import type { SessionSummary, SummaryChange, SummaryCommand, SummaryCommandGroup, SummaryFile, SummaryFolder, SummaryPrompt, SummaryRead, SummaryRecord, SummaryRun, SummaryScratchpad } from "../shared/types";
export { commandParts, commandSteps } from "./command-parts";

/** Tools whose calls change the file their input names. Read is collected separately. */
export const changeTools = ["edit", "write", "multiedit", "notebookedit"] as const;
/** Tools whose calls run a shell command, and the search tools the Commands run view lists beside them. */
export const commandTools = ["bash", "powershell"] as const;
export const searchTools = ["grep", "glob", "websearch"] as const;
export const fetchTools = ["webfetch"] as const;

const fileLimit = 500;
const changeLimit = 100;
const folderLimit = 50;
const promptLimit = 500;
const commandLimit = 500;
const runLimit = 100;
const groupLimit = 30;
const textLimit = 1000;
const lineLimit = 200;
/** The group for commands whose program cannot be read, and for the programs past `groupLimit`. */
export const otherProgram = "Other";

/** A folder the recording started in, moved to, or added with `/add-dir`, in recording order. */
export interface SummaryRoot { path: string; added: boolean; record: SummaryRecord }

/** A user message record with the text it carries, in recording order; `promptLine()` decides whether it is a prompt. */
export interface SummaryMessage { text: string; sequence: number; record: SummaryRecord }

/** A record that holds a failure, a decided tool, or both, for counting under the prompt it followed. */
export interface SummaryOutcome { sequence: number; error: boolean; stopped: boolean }

/**
 * One Edit, Write, MultiEdit, NotebookEdit, or Read call, with the path its input names as recorded. `error` means its
 * result was a failure; `decision` means a decision stopped it, or an interruption or cancellation ended it, as
 * `resultDecision()` reads its result.
 */
export interface SummaryCall { tool: string; path: string; cwd: string; error: boolean; decision: Decision | null; record: SummaryRecord }

/**
 * One shell, search, or WebFetch call. `text` is the command, pattern, query, or URL as recorded, `detail`
 * the search scope or fetch prompt, `background` whether a command was started in the background, and
 * `pending` whether the recording holds no result for it yet. `error` and `decision` read its result as a
 * `SummaryCall`'s do.
 */
export interface SummaryRunCall { tool: string; text: string; detail: string; background: boolean; error: boolean; decision: Decision | null; pending: boolean; record: SummaryRecord }

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const cap = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

// Recorded paths come from whichever machine made the recording, not the one serving it, so the style follows the
// path itself: a drive letter, a UNC prefix, or a backslash means Windows.
function isWindows(path: string): boolean {
  return /^[a-z]:|^\\\\|\\/i.test(path);
}

function isWindowsAbsolute(path: string): boolean {
  return /^[a-z]:[\\/]|^\\\\/i.test(path);
}

function sameKey(left: string, right: string, windows: boolean): boolean {
  const key = (value: string) => windows ? value.replace(/\\/g, "/").toLowerCase() : value;
  return key(left) === key(right);
}

/**
 * The path a call's input names, made absolute against the recorded working directory when it is relative. The working
 * directory's style decides how a relative path joins it. A leading `~` names a home directory the recording does not
 * record, so that path stays as written.
 */
export function resolveRecorded(path: string, cwd: string): string {
  const value = path.trim();
  if (!value) return "";
  if (/^~(?:[\\/]|$)/.test(value)) return value;
  if (isWindowsAbsolute(value)) return win32.normalize(value);
  if (!isWindows(value) && value.startsWith("/")) return posix.normalize(value);
  if (isWindowsAbsolute(cwd)) return win32.resolve(cwd, value);
  if (!isWindows(cwd) && cwd.startsWith("/")) return posix.resolve(cwd, value.replace(/\\/g, "/"));
  return value;
}

/** The path below `root`, "" for the root itself, or null when `root` does not contain `path`. */
export function within(path: string, root: string): string | null {
  const windows = isWindows(root) || isWindows(path);
  const base = root.replace(/[\\/]+$/, "");
  if (!sameKey(path.slice(0, base.length), base, windows)) return null;
  if (path.length === base.length) return "";
  return /[\\/]/.test(path[base.length]) ? path.slice(base.length + 1) : null;
}

/**
 * The scratchpad directory containing `path`, or null. Claude Code gives each session a scratchpad for temporary files
 * under its temp directory, `claude-<uid>` on macOS and Linux or `claude` on Windows, below the system temp location or
 * a `CLAUDE_CODE_TMPDIR` override: then the project path with every character but letters and digits replaced by `-`,
 * the session id, and `scratchpad`, as in `%TEMP%\claude\C--code-app\<session id>\scratchpad\check.py` or
 * `/tmp/claude-1000/-home-me-app/<session id>/scratchpad/check.py`. Only that whole shape counts, so a project folder
 * that happens to be named `scratchpad` does not.
 */
export function scratchpadRoot(path: string): string | null {
  const match = /^(.*[\\/]claude(?:-[^\\/]+)?[\\/][^\\/]+[\\/][0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}[\\/]scratchpad)[\\/]+[^\\/]/i.exec(path);
  return match?.[1] ?? null;
}

function fileKey(path: string): string {
  return isWindows(path) ? path.replace(/\\/g, "/").toLowerCase() : path;
}

/** A folder path normalized in its own style, without trailing separators except on a drive or filesystem root. */
function folderPath(path: string): string {
  const normalized = isWindows(path) ? win32.normalize(path) : posix.normalize(path);
  const trimmed = normalized.replace(/[\\/]+$/, "");
  return trimmed && !/^[a-z]:$/i.test(trimmed) ? trimmed : normalized;
}

/** The text a recorded message carries, joined across its text blocks. */
export function recordText(raw: unknown): string {
  const record = object(raw);
  const content = object(record.message).content ?? record.content;
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map(entry => typeof entry === "string" ? entry : string(object(entry).text)).join("\n") : "";
}

/** The content blocks of a recorded message, where its tool calls live. */
export function contentBlocks(raw: unknown): unknown[] {
  const record = object(raw);
  const content = object(record.message).content ?? record.content;
  return Array.isArray(content) ? content : [];
}

/**
 * Whether a recorded message is the `/add-dir` slash command itself. Claude Code records the command as a message that
 * starts with its tags, so prose that quotes or discusses the command does not count.
 */
export function isAddDirCommand(text: string): boolean {
  return /^\s*<command-name>\s*\/add-dir\s*<\/command-name>/.test(text);
}

/**
 * The directory a recorded `/add-dir` output says was added, or null for any other outcome. Claude Code also reports
 * directories that were already added or sit inside the working directory; neither adds a folder, so only the "Added"
 * wording counts as evidence.
 */
export function addedDirectory(text: string): string | null {
  const stdout = /^\s*<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(text)?.[1];
  if (stdout === undefined) return null;
  return /^Added ([\s\S]+?) as a working directory\b/.exec(stripAnsi(stdout).trim())?.[1].trim() || null;
}

function byPath(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }) || (left < right ? -1 : left > right ? 1 : 0);
}

type Tally = { count: number; errors: number; stopped: number };
const tally = (entry: Tally, run: Pick<SummaryRun, "error" | "decision">) => {
  entry.count++;
  if (run.error) entry.errors++;
  if (run.decision) entry.stopped++;
};

/**
 * Deduplicates a recording's shell commands by a single program or Other, and its searches and fetches by tool.
 * A command is the same whenever its recorded text is, whichever shell ran it; a search or fetch is
 * the same when its tool, text, and detail are. Each command keeps its latest runs, so the last run is always listed,
 * and the groups of programs run most sit first, with the catch-all group last. A multi-step command stays in Other
 * and is also listed, as a step row, under each program it calls at the top level, as `commandSteps()` finds them.
 */
export function buildCommands(runs: SummaryRunCall[]): Pick<SessionSummary, "commands" | "searches" | "fetches" | "commandCount" | "commandRuns" | "searchCount" | "searchRuns" | "fetchCount" | "fetchRuns" | "limited"> {
  type Entry = { command: SummaryCommand; text: string; tool: string; program: string; first: number; last: number };
  const commands = new Map<string, Entry>();
  const searches = new Map<string, Entry>();
  const fetches = new Map<string, Entry>();
  let limited = false;
  const totals = { commands: 0, searches: 0, fetches: 0 };
  runs.forEach((call, order) => {
    const search = (searchTools as readonly string[]).includes(call.tool.toLowerCase());
    const fetch = (fetchTools as readonly string[]).includes(call.tool.toLowerCase());
    const text = stripAnsi(call.text).replace(/\r\n?/g, "\n").trim();
    if (!text) return;
    const key = JSON.stringify(search || fetch ? [call.tool.toLowerCase(), call.detail, text] : ["shell", text]);
    const entries = search ? searches : fetch ? fetches : commands;
    let entry = entries.get(key);
    if (!entry) {
      const { program, head, lines } = search || fetch ? { program: call.tool, head: cap(collapse(text), lineLimit), lines: 1 } : commandParts(text, call.tool);
      entries.set(key, entry = { command: { key: createHash("sha256").update(key).digest("hex"), text: cap(text, textLimit), head, lines, detail: cap(call.detail, lineLimit), count: 0, errors: 0, stopped: 0, runs: [] }, text, tool: call.tool, program, first: order, last: order });
    } else if (!search && !fetch) {
      // A text the shells read differently has no program, and one both shells ran has no steps either way.
      if (entry.program !== commandParts(text, call.tool).program) entry.program = "";
      if (entry.tool.toLowerCase() !== call.tool.toLowerCase()) entry.tool = "";
    }
    totals[search ? "searches" : fetch ? "fetches" : "commands"]++;
    tally(entry.command, call);
    entry.last = order;
    if (entry.command.runs.length >= runLimit) { entry.command.runs.shift(); limited = true; }
    entry.command.runs.push({ ...call.record, tool: call.tool, error: call.error, decision: call.decision, background: call.background, pending: call.pending });
  });

  // The groups of the programs run most sit first, ties in the order the programs were first run; the catch-all group
  // is last. It is kept apart from the named groups rather than under a reserved name, so a program that happens to be
  // called "other" keeps a group of its own. Within a group the commands sit in the order they were first run.
  const group = (entries: Map<string, Entry>) => {
    type Group = { group: SummaryCommandGroup; first: number; rows: { command: SummaryCommand; first: number }[] };
    const groups = new Map<string, Group>();
    let other: Group | null = null;
    const list = [...entries.values()].sort((left, right) => right.last - left.last);
    if (list.length > commandLimit) limited = true;
    const listed = list.slice(0, commandLimit);
    const open = (name: string, first: number): Group => ({ group: { name, category: entries === searches ? "search" : entries === fetches ? "network" : commandCategory(name), count: 0, errors: 0, stopped: 0, commands: [] }, first, rows: [] });
    const place = (found: Group, entry: Entry, command: SummaryCommand) => {
      found.group.count += command.count; found.group.errors += command.errors; found.group.stopped += command.stopped;
      found.first = Math.min(found.first, entry.first);
      found.rows.push({ command, first: entry.first });
    };
    for (const entry of listed) {
      const key = entry.program.toLowerCase();
      let found = groups.get(key);
      if (!found && key && groups.size < groupLimit) groups.set(key, found = open(entry.program, entry.first));
      if (!found) {
        if (key) limited = true;
        found = other ??= { group: { name: otherProgram, category: "other", count: 0, errors: 0, stopped: 0, commands: [] }, first: entry.first, rows: [] };
      }
      place(found, entry, entry.command);
    }
    // A multi-step command's top-level calls join the groups of the programs that have a category and of the programs
    // run on their own, so a chain never adds a group for `cd` or `echo`. A program lists the command once, from its
    // first call, and the command's Other row names the groups that list it.
    if (entries === commands) for (const entry of listed) {
      if (entry.program || !entry.tool) continue;
      const rows = new Map<string, { found: Group; command: SummaryCommand }>();
      for (const step of commandSteps(entry.text, entry.tool)) {
        const key = step.program.toLowerCase();
        if (step.consumer || rows.has(key)) continue;
        let found = groups.get(key);
        if (!found && commandCategory(step.program) !== "shell" && groups.size < groupLimit) groups.set(key, found = open(step.program, entry.first));
        if (found) rows.set(key, { found, command: { ...entry.command, key: `${entry.command.key}:${key}`, head: step.head, step: { line: step.line, step: step.step, steps: step.steps } } });
      }
      if (!rows.size) continue;
      const names = [...rows.values()].map(row => row.found.group.name);
      entry.command.also = names;
      for (const row of rows.values()) {
        row.command.also = names.filter(name => name !== row.found.group.name);
        place(row.found, entry, row.command);
      }
    }
    const sorted = [...groups.values()].sort((left, right) => right.group.count - left.group.count || left.first - right.first);
    if (other) sorted.push(other);
    return sorted.map(entry => ({ ...entry.group, commands: entry.rows.sort((left, right) => left.first - right.first).map(row => row.command) }));
  };
  return { commands: group(commands), searches: group(searches), fetches: group(fetches), commandCount: commands.size, commandRuns: totals.commands, searchCount: searches.size, searchRuns: totals.searches, fetchCount: fetches.size, fetchRuns: totals.fetches, limited };
}

/**
 * The prompts among a recording's user messages, in order, each counting the outcomes recorded after it and before the
 * next prompt. Outcomes ahead of the first prompt count under none.
 */
export function buildPrompts(messages: SummaryMessage[], outcomes: SummaryOutcome[]): { prompts: SummaryPrompt[]; count: number; limited: boolean } {
  const prompts: SummaryPrompt[] = [];
  const sequences: number[] = [];
  let count = 0;
  for (const message of messages) {
    const line = promptLine(message.text);
    if (!line) continue;
    count++;
    sequences.push(message.sequence);
    if (prompts.length < promptLimit) prompts.push({ ...message.record, kind: line.kind, text: line.text, errors: 0, stopped: 0 });
  }
  // Every prompt claims the outcomes up to the next one, so an outcome after a prompt the limit cut is not counted
  // under the last prompt listed.
  let index = -1;
  for (const outcome of [...outcomes].sort((left, right) => left.sequence - right.sequence)) {
    while (index + 1 < sequences.length && sequences[index + 1] <= outcome.sequence) index++;
    if (index < 0 || index >= prompts.length) continue;
    if (outcome.error) prompts[index].errors++;
    if (outcome.stopped) prompts[index].stopped++;
  }
  return { prompts, count, limited: count > prompts.length };
}

/**
 * Groups a recording's changed and read files under the folders it worked in, lists its prompts, and groups its commands
 * and searches by program and tool as `buildCommands()` does. Each file joins the deepest folder that contains it; files
 * outside every folder are listed under their scratchpad directory when they have one, otherwise on their own. A file
 * that was ever changed is not listed as read.
 */
export function buildSummary(roots: SummaryRoot[], calls: SummaryCall[], messages: SummaryMessage[] = [], outcomes: SummaryOutcome[] = [], runs: SummaryRunCall[] = []): SessionSummary {
  const typed = buildPrompts(messages, outcomes);
  let limited = typed.limited;
  const folders = new Map<string, SummaryFolder>();
  for (const root of roots) {
    if (!root.path.trim()) continue;
    const path = folderPath(root.path.trim());
    const key = fileKey(path);
    let folder = folders.get(key);
    if (!folder) {
      if (folders.size >= folderLimit) { limited = true; continue; }
      folders.set(key, folder = { path, working: null, added: null, files: [] });
    }
    if (root.added) folder.added ??= root.record;
    else folder.working ??= root.record;
  }

  const changed = new Map<string, { path: string; count: number; errors: number; stopped: number; changes: SummaryChange[] }>();
  const read = new Map<string, { path: string; reads: number; record: SummaryRecord }>();
  for (const call of calls) {
    const path = resolveRecorded(call.path, call.cwd);
    if (!path) continue;
    const key = fileKey(path);
    if (call.tool.toLowerCase() === "read") {
      if (call.error || call.decision) continue;
      const entry = read.get(key);
      if (entry) entry.reads++;
      else read.set(key, { path, reads: 1, record: call.record });
      continue;
    }
    let entry = changed.get(key);
    if (!entry) changed.set(key, entry = { path, count: 0, errors: 0, stopped: 0, changes: [] });
    entry.count++;
    if (call.error) entry.errors++;
    if (call.decision) entry.stopped++;
    if (entry.changes.length < changeLimit) entry.changes.push({ ...call.record, tool: call.tool, error: call.error, decision: call.decision });
    else limited = true;
  }
  for (const key of changed.keys()) read.delete(key);

  const list = [...folders.values()];
  const place = (path: string) => {
    let best: { folder: SummaryFolder; display: string } | null = null;
    for (const folder of list) {
      const display = within(path, folder.path);
      if (display && (!best || folder.path.length > best.folder.path.length)) best = { folder, display };
    }
    return best;
  };

  const scratchpads = new Map<string, SummaryScratchpad>();
  const other: SummaryFile[] = [];
  const changedFiles = [...changed.values()];
  if (changedFiles.length > fileLimit) limited = true;
  for (const file of changedFiles.slice(0, fileLimit)) {
    const home = place(file.path);
    if (home) { home.folder.files.push({ ...file, display: home.display }); continue; }
    const root = scratchpadRoot(file.path);
    if (!root) { other.push({ ...file, display: file.path }); continue; }
    let scratchpad = scratchpads.get(fileKey(root));
    if (!scratchpad) scratchpads.set(fileKey(root), scratchpad = { path: root, files: [] });
    scratchpad.files.push({ ...file, display: within(file.path, root) || file.path });
  }
  for (const folder of list) folder.files.sort((left, right) => byPath(left.display, right.display));
  for (const scratchpad of scratchpads.values()) scratchpad.files.sort((left, right) => byPath(left.display, right.display));
  other.sort((left, right) => byPath(left.path, right.path));

  const readFiles = [...read.values()];
  if (readFiles.length > fileLimit) limited = true;
  const order = new Map(list.map((folder, index) => [folder.path, index]));
  // Reads sort by their folder's order, then the ones in scratchpads, then the ones outside every folder.
  const rank = (read: SummaryRead) => order.get(read.folder) ?? (read.folder ? list.length : list.length + 1);
  const reads: SummaryRead[] = readFiles.slice(0, fileLimit).map(file => {
    const home = place(file.path);
    const root = home ? null : scratchpadRoot(file.path);
    const display = home ? home.display : root ? within(file.path, root) || file.path : file.path;
    return { ...file.record, path: file.path, display, folder: home?.folder.path ?? root ?? "", reads: file.reads };
  }).sort((left, right) => rank(left) - rank(right) || byPath(left.display, right.display));

  const built = buildCommands(runs);
  return { folders: list, scratchpads: [...scratchpads.values()], other, read: reads, prompts: typed.prompts, ...built, changedFiles: changed.size, readFiles: read.size, promptCount: typed.count, limited: limited || built.limited };
}

/** Every record a summary points at, for looking up their positions under the replay filters. */
export function summaryRecordIds(summary: SessionSummary): string[] {
  const ids = new Set<string>();
  for (const folder of summary.folders) {
    if (folder.working) ids.add(folder.working.id);
    if (folder.added) ids.add(folder.added.id);
  }
  const files = [...summary.folders.flatMap(folder => folder.files), ...summary.scratchpads.flatMap(scratchpad => scratchpad.files), ...summary.other];
  for (const file of files) for (const change of file.changes) ids.add(change.id);
  for (const file of summary.read) ids.add(file.id);
  for (const prompt of summary.prompts) ids.add(prompt.id);
  for (const group of [...summary.commands, ...summary.searches, ...summary.fetches]) for (const command of group.commands) for (const run of command.runs) ids.add(run.id);
  return [...ids];
}

/** A copy of `summary` whose records carry their positions; records missing from `positions` are hidden by the filters. */
export function placeSummary(summary: SessionSummary, positions: Map<string, number>): SessionSummary {
  const at = <T extends SummaryRecord>(record: T): T => ({ ...record, position: positions.get(record.id) ?? null });
  const file = (entry: SummaryFile): SummaryFile => ({ ...entry, changes: entry.changes.map(at) });
  const group = (entry: SummaryCommandGroup): SummaryCommandGroup => ({ ...entry, commands: entry.commands.map(command => ({ ...command, runs: command.runs.map(at) })) });
  return {
    ...summary,
    folders: summary.folders.map(folder => ({ ...folder, working: folder.working && at(folder.working), added: folder.added && at(folder.added), files: folder.files.map(file) })),
    scratchpads: summary.scratchpads.map(scratchpad => ({ ...scratchpad, files: scratchpad.files.map(file) })),
    other: summary.other.map(file),
    read: summary.read.map(at),
    prompts: summary.prompts.map(at),
    commands: summary.commands.map(group),
    searches: summary.searches.map(group),
    fetches: summary.fetches.map(group),
  };
}
