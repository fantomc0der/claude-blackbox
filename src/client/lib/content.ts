import type { ContentBlock, ReplayEvent } from "../../shared/types";
import { stripAnsi } from "../../shared/ansi";
import { diffLines } from "diff";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function getToolInput(block: ContentBlock): Record<string, unknown> {
  return isRecord(block.input) ? block.input : {};
}

export function contentToText(content: ContentBlock["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(blockToText).filter(Boolean).join("\n");
}

export function blockToText(block: ContentBlock): string {
  return getString(block.text) ?? getString(block.thinking) ?? contentToText(block.content);
}

export function formatEventTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp || "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function toolTitle(name?: string): string {
  if (!name) return "Tool";
  return name.startsWith("mcp__") ? name.slice(5).split("__").filter(Boolean).join(" · ") || name : name;
}

export function isToolResultEvent(event: Pick<ReplayEvent, "blocks">): boolean {
  return event.blocks.length > 0 && event.blocks.every(block => block.type === "tool_result");
}

export function isRequestMessage(event: Pick<ReplayEvent, "type">): boolean {
  return event.type === "api-request-blob";
}

/** A record Claude Code wrote itself in place of a model turn: an API error, or a stand-in such as `No response requested.`. */
export function isStandIn(event: Pick<ReplayEvent, "category">): boolean {
  return event.category === "synthetic";
}

export function isApiError(event: Pick<ReplayEvent, "raw">): boolean {
  return event.raw.isApiErrorMessage === true;
}

// Claude Code notes the kind of a failed request (`rate_limit`, `invalid_request`, `billing_error`, or `unknown`) and
// the HTTP status when there was one. Both are recorded content, so the label keeps them short and leaves out a status
// that is not one.
export function apiErrorLabel(event: Pick<ReplayEvent, "raw">): string {
  const parts = ["API error"];
  const kind = getString(event.raw.error)?.trim().replace(/_/g, " ");
  if (kind && kind !== "unknown") parts.push(truncate(kind, 40));
  const status = isRecord(event.raw.apiError) ? event.raw.apiError.status : undefined;
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) parts.push(`HTTP ${status}`);
  return parts.join(" · ");
}

export interface RequestMessageRun {
  messages: ReplayEvent[];
  /** The run opens a page that has records before it, so more of it may be on the previous page. */
  partial: boolean;
}

// Claude Code writes the messages an API request adds as a run of `api-request-blob` records directly before the
// `api-request` record that lists their hashes in `tail`. Each run whose request follows it on the page is keyed by
// that request's id; copies the request does not list are left out of its run.
export function requestMessageRuns(events: readonly ReplayEvent[], continued = false): Map<string, RequestMessageRun> {
  const runs = new Map<string, RequestMessageRun>();
  let run: ReplayEvent[] = [];
  for (const event of events) {
    const follows = run.length > 0 && run[run.length - 1].sequence + 1 === event.sequence;
    if (isRequestMessage(event)) {
      if (follows) run.push(event);
      else run = [event];
      continue;
    }
    if (event.type === "api-request" && follows) {
      const tail = Array.isArray(event.raw.tail) ? new Set(event.raw.tail) : undefined;
      let start = run.length;
      while (start > 0 && (!tail || tail.has(run[start - 1].raw.hash))) start--;
      if (start < run.length) runs.set(event.id, { messages: run.slice(start), partial: continued && run[start] === events[0] });
    }
    run = [];
  }
  return runs;
}

// The command, path, query, or pattern a call was made with, in the order the summary row prefers them. The row also
// previews a delegated task's description or prompt, which are not arguments to copy.
const argumentKeys = ["command", "file_path", "notebook_path", "path", "query", "pattern"] as const;
const argumentKinds: Record<(typeof argumentKeys)[number], ToolArgumentKind> = { command: "command", file_path: "path", notebook_path: "path", path: "path", query: "query", pattern: "pattern" };
const previewKeys: readonly string[] = [...argumentKeys, "description", "prompt"];
const pathPreviewKeys = new Set(["file_path", "notebook_path", "path"]);

function firstInputKey<Key extends string>(input: Record<string, unknown>, keys: readonly Key[]): Key | undefined {
  return keys.find(candidate => {
    const value = input[candidate];
    return typeof value === "string" && value.trim() !== "";
  });
}

export type ToolArgumentKind = "command" | "path" | "query" | "pattern";

// The recorded argument the summary row previews, whole: escape sequences and control characters are dropped and the
// ends trimmed, as the code panels' Copy cleans their text, but inner whitespace stays so a multi-line command copies
// intact. Absent when the call has no such argument, or only escape codes.
export function toolArgument(block: ContentBlock): { kind: ToolArgumentKind; value: string } | undefined {
  const input = getToolInput(block);
  const key = firstInputKey(input, argumentKeys);
  if (!key) return undefined;
  const value = stripAnsi(input[key] as string).trim();
  return value ? { kind: argumentKinds[key], value } : undefined;
}

// The cap only bounds pathological inputs such as long heredocs; the summary
// row's CSS ellipsis decides how much of this the current viewport shows.
// Paths split before their final segment so the file name can stay visible
// while the directory gives up space first.
export function toolPreviewParts(block: ContentBlock): { head: string; tail: string } {
  const input = getToolInput(block);
  const key = firstInputKey(input, previewKeys);
  if (!key) return { head: "", tail: "" };
  const value = stripAnsi(input[key] as string).replace(/\s+/g, " ").trim();
  if (!pathPreviewKeys.has(key)) return { head: truncate(value, 1000), tail: "" };
  const split = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) + 1;
  const head = value.slice(0, split), tail = truncate(value.slice(split), 1000), room = 1000 - tail.length;
  return { head: head.length <= room ? head : room > 1 ? `…${head.slice(head.length - room + 1)}` : "", tail };
}

export function toolPreview(block: ContentBlock): string {
  const { head, tail } = toolPreviewParts(block);
  return head + tail;
}

export function truncate(value: string, maximum = 240): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

export function prettyValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Whether any recorded string or scalar inside a value contains the term, ignoring case. Recorded content is
// unbounded, so the scan stops after a budget of characters and treats anything beyond it as not mentioning the term.
export const mentionsBudget = 200_000;
export function mentions(value: unknown, term: string): boolean {
  const needle = term.toLowerCase();
  let remaining = mentionsBudget;
  const scan = (text: string) => { remaining -= text.length; return remaining >= 0 && text.toLowerCase().includes(needle); };
  const visit = (entry: unknown): boolean => remaining > 0 && (typeof entry === "string" ? scan(entry)
    : typeof entry === "number" || typeof entry === "boolean" ? scan(String(entry))
    : Array.isArray(entry) ? entry.some(visit) : isRecord(entry) && Object.values(entry).some(visit));
  return Boolean(needle) && visit(value);
}

export function isImageBlock(block: ContentBlock): boolean {
  return block.type === "image";
}

export function contentImages(content: ContentBlock["content"]): ContentBlock[] {
  return Array.isArray(content) ? content.filter(isImageBlock) : [];
}

export function resultImages(result?: ContentBlock): ContentBlock[] {
  return result ? contentImages(result.content) : [];
}

export function resultText(result?: ContentBlock): string {
  if (!result) return "";
  return blockToText(result) || (resultImages(result).length ? "" : prettyValue(result.content ?? result));
}

export interface ImageMeta {
  format: string;
  size: string;
}

export function imageMediaType(source?: ContentBlock["source"]): string {
  const mediaType = source?.media_type?.toLowerCase().split(";")[0]?.trim() ?? "";
  return mediaType === "image/jpg" || mediaType === "image/pjpeg" ? "image/jpeg" : mediaType;
}

export function imageMeta(source?: ContentBlock["source"]): ImageMeta {
  const subtype = imageMediaType(source).replace(/^image\//, "");
  const format = subtype === "jpeg" ? "JPEG" : subtype === "svg+xml" ? "SVG" : subtype.toUpperCase() || "Image";
  const data = typeof source?.data === "string" ? source.data.replace(/\s/g, "") : "";
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = Math.max(0, Math.floor((data.length * 3) / 4) - padding);
  const size = bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
  return { format, size };
}

export function safeDataImage(source?: ContentBlock["source"]): string | undefined {
  if (!source || source.type !== "base64" || !source.data) return undefined;
  const mediaType = imageMediaType(source);
  if (!/^image\/(png|gif|jpeg|webp|avif|bmp)$/.test(mediaType)) return undefined;
  if (!/^[a-z0-9+/=\s]+$/i.test(source.data)) return undefined;
  return `data:${mediaType};base64,${source.data.replace(/\s/g, "")}`;
}

export interface DiffLine {
  kind: "same" | "added" | "removed";
  value: string;
}

export function boundedDiff(before: string, after: string, limit = 80): DiffLine[] {
  if (before.length + after.length > 400_000) return [{ kind: "same", value: "Large edit — open the raw event for complete before/after content." }];
  const changes = diffLines(before, after, { timeout: 35, maxEditLength: 1000 });
  if (!changes) return [{ kind: "same", value: "Complex edit — open the raw event for complete before/after content." }];
  const lines: DiffLine[] = [];
  for (const change of changes) {
    const values = change.value.split(/\r?\n/);
    if (change.value.endsWith("\n")) values.pop();
    const kind: DiffLine["kind"] = change.added ? "added" : change.removed ? "removed" : "same";
    if (kind === "same" && values.length > 8) {
      lines.push(...values.slice(0, 3).map((value): DiffLine => ({ kind, value })), { kind, value: `… ${values.length - 6} unchanged lines …` }, ...values.slice(-3).map((value): DiffLine => ({ kind, value })));
    } else lines.push(...values.map((value): DiffLine => ({ kind, value })));
  }
  if (lines.length <= limit) return lines;
  const head = Math.max(8, Math.floor(limit / 2));
  const tail = Math.max(8, limit - head - 1);
  return [...lines.slice(0, head), { kind: "same", value: "… diff shortened; complete strings are in the raw event …" }, ...lines.slice(-tail)];
}

export function eventRaw(event: ReplayEvent): string {
  return prettyValue(event.raw);
}
