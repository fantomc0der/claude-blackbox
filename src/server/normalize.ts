import { stripAnsi } from "../shared/ansi";
import { isSessionState } from "../shared/records";
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

function requestMessageText(message: Record<string, unknown>): string {
  if (message.role === "assistant") return "";
  if (typeof message.content === "string") return message.content;
  return Array.isArray(message.content) ? searchable(message.content.filter(entry => !copiedBlocks.has(string(object(entry).type)))) : "";
}

// A session state record's prompt copy is held by the user record it repeats, so it is left out of the searchable text;
// the rest of the record, such as a permission mode or a worktree path, stays searchable and in `raw`.
const copiedStateFields: Record<string, readonly string[]> = { "last-prompt": ["lastPrompt"], "queue-operation": ["content"] };

function sessionStateText(type: string, raw: Record<string, unknown>): string {
  const copied = copiedStateFields[type];
  return searchable(copied ? Object.fromEntries(Object.entries(raw).filter(([key]) => !copied.includes(key))) : raw);
}

export function normalize(raw: Record<string, unknown>, sourceId: string, offset: number, sequence: number): ReplayEvent {
  const message = object(raw.message);
  const type = string(raw.type) || "unknown";
  const role = (type === "user" || type === "assistant") && raw.isMeta !== true && raw.isCompactSummary !== true ? type : "system";
  const copy = type === requestMessageType;
  const state = isSessionState(type);
  const content = copy || state ? undefined : message.content ?? raw.content;
  let blocks: ContentBlock[] = [];
  if (typeof content === "string") blocks = [{ type: "text", text: content }];
  else if (Array.isArray(content)) blocks = content.map(entry => {
    if (typeof entry === "string") return { type: "text", text: entry };
    const block = object(entry);
    return { ...block, type: string(block.type) || "unknown" } as ContentBlock;
  });
  if (!blocks.length && !state && typeof raw.summary === "string") blocks = [{ type: "text", text: raw.summary }];
  const text = copy ? requestMessageText(message) : state ? sessionStateText(type, raw) : blocks.length ? searchable(blocks) : searchable(raw);
  const tools = blocks.filter(block => block.type === "tool_use");
  const hasTools = blocks.some(block => block.type === "tool_use" || block.type === "tool_result");
  const hasText = blocks.some(block => block.type === "text" && block.text?.trim());
  const stamp = typeof raw.timestamp === "number" ? raw.timestamp : Date.parse(string(raw.timestamp));
  return {
    id: `${sourceId}-${offset}`,
    sequence,
    offset,
    type,
    role,
    timestamp: Number.isFinite(stamp) ? new Date(stamp).toISOString() : "",
    blocks,
    text,
    category: role === "system" ? "system" : isHiddenReasoning(blocks) ? "hidden" : hasText ? "message" : hasTools ? "tool" : "thinking",
    toolNames: tools.map(block => block.name || "Unknown tool"),
    error: blocks.some(block => block.is_error === true) || raw.is_error === true || raw.level === "error",
    parentId: string(raw.parentUuid) || undefined,
    uuid: string(raw.uuid) || undefined,
    cwd: string(raw.cwd) || undefined,
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

export function pathName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || "Unknown workspace";
}
