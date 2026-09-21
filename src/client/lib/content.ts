import type { ContentBlock, ReplayEvent } from "../../shared/types";
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

export function toolPreview(block: ContentBlock): string {
  const input = getToolInput(block);
  const candidates = [
    input.command,
    input.file_path,
    input.path,
    input.query,
    input.pattern,
    input.description,
    input.prompt,
  ];
  const value = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? truncate(value.replace(/\s+/g, " "), 96) : "";
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

export function resultText(result?: ContentBlock): string {
  return result ? blockToText(result) || prettyValue(result.content ?? result) : "";
}

export function safeDataImage(source?: ContentBlock["source"]): string | undefined {
  if (!source || source.type !== "base64" || !source.data) return undefined;
  const mediaType = source.media_type?.toLowerCase() ?? "";
  if (!/^image\/(png|gif|jpeg|webp|avif)$/.test(mediaType)) return undefined;
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
