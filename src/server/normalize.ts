import { stripAnsi } from "../shared/ansi";
import { resultDecision } from "../shared/decisions";
import { apiRetry, noteFiling } from "../shared/records";
import type { ContentBlock, ReplayEvent } from "../shared/types";

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function searchable(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(searchable).join("\n");
  const record = object(value);
  return Object.entries(record)
    .filter(([key]) => !["signature", "encrypted_content"].includes(key) && !(key === "data" && record.type === "base64"))
    .map(([key, entry]) => `${key}: ${searchable(entry)}`).join("\n");
}

function readableThinking(block: ContentBlock): boolean {
  return block.type === "thinking" && Boolean(string(block.thinking).trim() || string(block.text).trim());
}

export function hasReadableThinking(blocks: ContentBlock[]): boolean {
  return blocks.some(readableThinking);
}

export function isHiddenReasoning(blocks: ContentBlock[]): boolean {
  return blocks.length > 0 && blocks.every(block => block.type === "redacted_thinking" || (block.type === "thinking" && !readableThinking(block)));
}

// Claude Code stores each message of an API request body once, keyed by its hash, in an `api-request-blob` record written
// just before the `api-request` record that sends it. Its assistant turns, tool calls and results, and reasoning repeat
// other records verbatim, so a blob contributes no blocks or tool links, and only the context Claude Code composed for
// the request, such as hook output and reminders, stays searchable. The raw record keeps the whole message.
export const requestMessageType = "api-request-blob";
const copiedBlocks = new Set(["tool_use", "tool_result", "thinking", "redacted_thinking"]);

// When an API request fails for good, or a turn ends without a reply, Claude Code writes an `assistant` record itself:
// `message.model` is `<synthetic>`, an API error also carries `isApiErrorMessage: true` with the error kind in `error`,
// a cause in `apiError`, and the HTTP status, when there was one, in `apiErrorStatus`, and its text is the error or a
// stand-in such as `No response requested.`. None of it is model output, so such a record is never a message, and an
// API error is an error.
export const syntheticModel = "<synthetic>";

export function isApiError(raw: Record<string, unknown>): boolean {
  return raw.isApiErrorMessage === true;
}

export function isStandIn(raw: Record<string, unknown>): boolean {
  return raw.type === "assistant" && (object(raw.message).model === syntheticModel || isApiError(raw));
}

// When the user interrupts a turn, Claude Code writes a `user` record itself whose only content is one of its two
// interruption markers, so the model sees where the turn stopped; the user typed neither. Such a record is the user-side
// counterpart of an assistant stand-in: Claude Code's own card, never a message or a prompt, which is also why
// `promptTitle()` below skips it. Only a record holding exactly a marker is one; a prompt that quotes it stays a prompt.
export const interruptionMarkers = ["[Request interrupted by user]", "[Request interrupted by user for tool use]"];

export function isInterruptionMarker(raw: Record<string, unknown>, blocks: ContentBlock[]): boolean {
  return raw.type === "user" && blocks.length === 1 && blocks[0].type === "text" && interruptionMarkers.includes(string(blocks[0].text).trim());
}

// Claude Code writes a blob only for a message no run of transcript records holds whole, but the user message it sends
// for a prompt merges the prompt with the context composed for it, so that blob repeats the prompt's text block for
// block, as it does any context an `attachment` record keeps in `rendered`. `TranscriptTexts` collects the text of a
// recording's `user` records without tool blocks and its attachments' rendered messages, and a blob's text that one of
// them holds is left out of its searchable text, so a prompt is found once, on its user record, while composed context
// that no record holds stays searchable. Claude Code writes some of those records after the request, so a blob keeping
// a text is listed under it, and `note()` names the blobs a record holding that text arrives too late for. `load`
// supplies the records and blobs already indexed when a read resumes at its cursor without the previous read's
// collection, and runs once a record or blob asks.
export class TranscriptTexts {
  private readonly hashes = new Set<number | bigint>();
  private readonly kept = new Map<number | bigint, Set<number>>();

  constructor(private load?: (texts: TranscriptTexts) => void) {}

  private loaded(): void {
    if (!this.load) return;
    const load = this.load;
    this.load = undefined;
    load(this);
  }

  /** Collects the text a transcript record holds and returns the sequences of the blobs that kept any of it. */
  note(raw: Record<string, unknown>): number[] {
    const texts = transcriptTexts(raw);
    if (!texts.length) return [];
    this.loaded();
    const revised = new Set<number>();
    for (const text of texts) {
      const hash = Bun.hash(text);
      this.hashes.add(hash);
      for (const sequence of this.kept.get(hash) ?? []) revised.add(sequence);
      this.kept.delete(hash);
    }
    return [...revised];
  }

  /** Whether a transcript record holds `text`; when none does, the blob at `sequence` is listed as keeping it. */
  holds(text: string, sequence: number): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    this.loaded();
    const hash = Bun.hash(trimmed);
    if (this.hashes.has(hash)) return true;
    this.kept.set(hash, (this.kept.get(hash) ?? new Set()).add(sequence));
    return false;
  }
}

function messageTexts(content: unknown): string[] {
  if (typeof content === "string") return [content];
  return Array.isArray(content) ? content.flatMap(entry => typeof entry === "string" ? [entry] : object(entry).type === "text" ? [string(object(entry).text)] : []) : [];
}

function transcriptTexts(raw: Record<string, unknown>): string[] {
  let texts: string[] = [];
  if (raw.type === "user") {
    const content = object(raw.message).content;
    const tools = Array.isArray(content) && content.some(entry => ["tool_use", "tool_result"].includes(string(object(entry).type)));
    texts = tools ? [] : messageTexts(content);
  } else if (raw.type === "attachment") {
    texts = [raw.rendered, raw.renderedInHumanTurn].flatMap(rendered => Array.isArray(rendered) ? rendered.flatMap(message => messageTexts(object(message).content)) : []);
  }
  return texts.map(text => text.trim()).filter(Boolean);
}

function requestMessageText(message: Record<string, unknown>, sequence: number, transcript?: TranscriptTexts): string {
  if (message.role === "assistant") return "";
  const held = (text: unknown) => transcript?.holds(string(text), sequence) ?? false;
  if (typeof message.content === "string") return held(message.content) ? "" : message.content;
  return Array.isArray(message.content) ? searchable(message.content.filter(entry => {
    if (typeof entry === "string") return !held(entry);
    const block = object(entry);
    return !copiedBlocks.has(string(block.type)) && !(block.type === "text" && held(block.text));
  })) : "";
}

// A bookkeeping or state record's prompt copy is held by the user record it repeats, so it is left out of the searchable
// text; the rest of the record, such as a permission mode, a worktree path, or a `summary`, stays searchable and in `raw`.
const copiedNoteFields: Record<string, readonly string[]> = { "last-prompt": ["lastPrompt"], "queue-operation": ["content"] };

function noteText(type: string, raw: Record<string, unknown>): string {
  const copied = copiedNoteFields[type];
  return searchable(copied ? Object.fromEntries(Object.entries(raw).filter(([key]) => !copied.includes(key))) : raw);
}

// Claude Code 2.1.30x writes a `relocated` record, with no `cwd` or timestamp, when it moves a session's recording to
// the project folder of a new working directory, as EnterWorktree and ExitWorktree do. Its `relocatedCwd` is that
// directory, so it serves as the record's working directory and the replay marks the change where it happened.
function relocatedCwd(type: string, raw: Record<string, unknown>): string {
  return type === "relocated" ? string(raw.relocatedCwd) : "";
}

export function normalize(raw: Record<string, unknown>, sourceId: string, offset: number, sequence: number, transcript?: TranscriptTexts): ReplayEvent {
  const message = object(raw.message);
  const type = string(raw.type) || "unknown";
  const role = (type === "user" || type === "assistant") && raw.isMeta !== true && raw.isCompactSummary !== true ? type : "system";
  const copy = type === requestMessageType;
  const note = noteFiling(type) !== null;
  const content = copy || note ? undefined : message.content ?? raw.content;
  let blocks: ContentBlock[] = [];
  if (typeof content === "string") blocks = [{ type: "text", text: content }];
  else if (Array.isArray(content)) blocks = content.map(entry => {
    if (typeof entry === "string") return { type: "text", text: entry };
    const block = object(entry);
    return { ...block, type: string(block.type) || "unknown" } as ContentBlock;
  });
  if (!blocks.length && !note && typeof raw.summary === "string") blocks = [{ type: "text", text: raw.summary }];
  const text = copy ? requestMessageText(message, sequence, transcript) : note ? noteText(type, raw) : blocks.length ? searchable(blocks) : searchable(raw);
  // Claude Code 2.1.30x writes a decided result's kind as `toolDenialKind` beside the result, on the record that holds
  // it, and when it loads a user rejection the session's shutdown cut short, marked `interruptedByShutdown`, it files
  // that as an interruption. Once the searchable text is taken, the kind is copied onto each flagged result, so a result
  // kept or shown apart from its record, as `tool_results` stores it, still knows how it was decided.
  if (typeof raw.toolDenialKind === "string") {
    const kind = raw.toolDenialKind === "user-rejected" && raw.interruptedByShutdown === true ? "interrupted" : raw.toolDenialKind;
    blocks = blocks.map(block => block.type === "tool_result" && block.is_error === true ? { ...block, toolDenialKind: kind } : block);
  }
  const tools = blocks.filter(block => block.type === "tool_use");
  const hasTools = blocks.some(block => block.type === "tool_use" || block.type === "tool_result");
  const hasText = blocks.some(block => block.type === "text" && block.text?.trim());
  const stamp = typeof raw.timestamp === "number" ? raw.timestamp : Date.parse(string(raw.timestamp));
  // A result Claude Code marked `is_error` because the user, a permission rule, a hook, or the auto mode classifier
  // stopped the tool, or because the call was interrupted or cancelled, records a decision, not a failure; only the
  // remaining `is_error` results, error-level records, and API error turns are errors. Claude Code's API retry banner is
  // error-level but never an error, should a version write one.
  const decisions = blocks.map(resultDecision);
  return {
    id: `${sourceId}-${offset}`,
    sequence,
    offset,
    type,
    role,
    timestamp: Number.isFinite(stamp) ? new Date(stamp).toISOString() : "",
    blocks,
    text,
    category: role === "system" ? "system" : isStandIn(raw) || isInterruptionMarker(raw, blocks) ? "synthetic" : isHiddenReasoning(blocks) ? "hidden" : hasText ? "message" : hasTools ? "tool" : "thinking",
    toolNames: tools.map(block => block.name || "Unknown tool"),
    error: blocks.some((block, index) => block.is_error === true && !decisions[index]) || raw.is_error === true || (raw.level === "error" && !apiRetry(raw)) || isApiError(raw),
    decision: decisions.find(decision => decision !== null) ?? null,
    parentId: string(raw.parentUuid) || undefined,
    uuid: string(raw.uuid) || undefined,
    cwd: string(raw.cwd) || relocatedCwd(type, raw) || undefined,
    agentId: string(raw.agentId) || undefined,
    raw,
  };
}

function plainValues(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(plainValues).filter(Boolean).join(" ");
  const record = object(value);
  return Object.entries(record)
    .filter(([key]) => !["signature", "encrypted_content"].includes(key) && !(key === "data" && record.type === "base64"))
    .map(([, entry]) => plainValues(entry)).filter(Boolean).join(" ");
}

export function displayText(blocks: ContentBlock[]): string {
  return stripAnsi(blocks.map(block => {
    if (block.type === "text") return string(block.text);
    if (block.type === "thinking") return string(block.thinking);
    if (block.type === "tool_use") return plainValues(block.input);
    if (block.type === "tool_result") return Array.isArray(block.content) ? displayText(block.content) : plainValues(block.content);
    return "";
  }).filter(Boolean).join(" ")).replaceAll("|", " ").replace(/\s+/g, " ").trim();
}

export function termPattern(term: string): RegExp | null {
  const tokens = term.match(/[\p{L}\p{N}]+/gu);
  return tokens ? new RegExp(tokens.join("[^\\p{L}\\p{N}]+"), "iu") : null;
}

export function displaySnippet(raw: string, term: string, words = 28): string {
  let text: string;
  try { text = displayText(normalize(JSON.parse(raw) as Record<string, unknown>, "", 0, 0).blocks); }
  catch { return ""; }
  const pattern = termPattern(term);
  const index = pattern ? text.search(pattern) : text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return "";
  const before = text.slice(0, index).split(" ").filter(Boolean);
  const after = text.slice(index).split(" ").filter(Boolean);
  const lead = Math.min(before.length, Math.floor(words / 2));
  const tail = after.slice(0, Math.max(1, words - lead));
  return `${lead < before.length ? "… " : ""}${[...before.slice(before.length - lead), ...tail].join(" ")}${tail.length < after.length ? " …" : ""}`;
}

// Claude Code's own first-prompt picker, which titles its `--resume` listing, skips the records that slash commands, local
// commands, hooks, interruptions, and the IDE integration write ahead of the user's first prompt, shows a slash command
// with its arguments as `/name args`, and shows a shell command as `! command`. The same rules keep a recording's title in
// agreement with it; a record the rules skip gives no title, so the next user record is tried.
const skippedPrompt = /^(<local-command-stdout>|<local-command-caveat>|<session-start-hook>|\[Request interrupted by user)/;
const attachedContext = /<(system-reminder|ide_opened_file|ide_selection)>[\s\S]*?<\/\1>/g;

function titleText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function promptTitle(event: ReplayEvent): string {
  if (event.role !== "user") return "";
  const text = stripAnsi(event.blocks.filter(block => block.type === "text").map(block => block.text || "").join(" ")).trim();
  if (skippedPrompt.test(text)) return "";
  const command = /^<command-name>([\s\S]*?)<\/command-name>/.exec(text);
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1] ?? "";
    return args.trim() ? titleText(`${command[1].trim()} ${args}`) : "";
  }
  const shell = /^<bash-input>([\s\S]*?)<\/bash-input>/.exec(text);
  if (shell) return shell[1].trim() ? titleText(`! ${shell[1]}`) : "";
  return titleText(text.replace(attachedContext, " ").replace(/<[^>]+>/g, " "));
}

/**
 * The explicit title a record gives its recording, as one line cut to 240 characters, with the rank of its kind; null
 * when it gives none. Claude Code's `--resume` picker titles a session by its agent name (4), else its custom title
 * from `/rename` (3), else its AI title (2), else its summary (1), else its first prompt, each the latest record of its
 * kind; 2.1.302 writes no `summary` records but still honors the ones older versions wrote. The name fields are read
 * from any record that carries them, a `title` from a `custom-title` or `ai-title` record, and a summary only from a
 * `summary` record.
 */
export function explicitTitle(type: string, raw: Record<string, unknown>): { title: string; rank: number } | null {
  const candidates: ReadonlyArray<readonly [number, string]> = [
    [4, string(raw.agentName)],
    [3, string(raw.customTitle) || (type === "custom-title" ? string(raw.title) : "")],
    [2, string(raw.aiTitle) || (type === "ai-title" ? string(raw.title) : "")],
    // The latest summary wins without a `leafUuid` check, because the listing `claude --resume` shows takes its title
    // from Claude Code's lite reader, which reads the last line of the file's tail that holds `"type":"summary"`; only
    // its full conversation loader keys summaries by `leafUuid`. A summary whose `leafUuid` names no record in this
    // recording therefore still titles it. The index reads the whole file, so it also takes a summary written before
    // the tail the lite reader looks at.
    [1, type === "summary" ? string(raw.summary) : ""],
  ];
  for (const [rank, value] of candidates) {
    const title = stripAnsi(value).replace(/\s+/g, " ").trim().slice(0, 240);
    if (title) return { title, rank };
  }
  return null;
}

/** The tool results among a record's blocks that record a decision, each of which `sessions.decisions` counts. */
export function decidedResults(blocks: ContentBlock[]): number {
  return blocks.filter(block => resultDecision(block) !== null).length;
}

export function pathName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || "Unknown workspace";
}
