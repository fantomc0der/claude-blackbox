import { posix, win32 } from "node:path";
import { stripAnsi } from "../shared/ansi";
import { object, string } from "./normalize";
import type { Decision } from "../shared/decisions";
import type { SessionSummary, SummaryChange, SummaryFile, SummaryFolder, SummaryRead, SummaryRecord, SummaryScratchpad } from "../shared/types";

/** Tools whose calls change the file their input names. Read is collected separately. */
export const changeTools = ["edit", "write", "multiedit", "notebookedit"] as const;

const fileLimit = 500;
const changeLimit = 100;
const folderLimit = 50;

/** A folder the recording started in, moved to, or added with `/add-dir`, in recording order. */
export interface SummaryRoot { path: string; added: boolean; record: SummaryRecord }

/**
 * One Edit, Write, MultiEdit, NotebookEdit, or Read call, with the path its input names as recorded. `error` means its
 * result was a failure; `decision` means a decision stopped it, or an interruption or cancellation ended it, as
 * `resultDecision()` reads its result.
 */
export interface SummaryCall { tool: string; path: string; cwd: string; error: boolean; decision: Decision | null; record: SummaryRecord }

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

/**
 * Groups a recording's changed and read files under the folders it worked in. Each file joins the deepest folder that
 * contains it; files outside every folder are listed under their scratchpad directory when they have one, otherwise on
 * their own. A file that was ever changed is not listed as read.
 */
export function buildSummary(roots: SummaryRoot[], calls: SummaryCall[]): SessionSummary {
  let limited = false;
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

  return { folders: list, scratchpads: [...scratchpads.values()], other, read: reads, changedFiles: changed.size, readFiles: read.size, limited };
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
  return [...ids];
}

/** A copy of `summary` whose records carry their positions; records missing from `positions` are hidden by the filters. */
export function placeSummary(summary: SessionSummary, positions: Map<string, number>): SessionSummary {
  const at = <T extends SummaryRecord>(record: T): T => ({ ...record, position: positions.get(record.id) ?? null });
  const file = (entry: SummaryFile): SummaryFile => ({ ...entry, changes: entry.changes.map(at) });
  return {
    ...summary,
    folders: summary.folders.map(folder => ({ ...folder, working: folder.working && at(folder.working), added: folder.added && at(folder.added), files: folder.files.map(file) })),
    scratchpads: summary.scratchpads.map(scratchpad => ({ ...scratchpad, files: scratchpad.files.map(file) })),
    other: summary.other.map(file),
    read: summary.read.map(at),
  };
}
