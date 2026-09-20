import type { ContentBlock, ReplayEvent } from "../../shared/types";

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
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
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
  const previous = before.split("\n");
  const next = after.split("\n");
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) suffix++;

  const lines: DiffLine[] = [
    ...previous.slice(0, prefix).map((value) => ({ kind: "same" as const, value })),
    ...previous.slice(prefix, previous.length - suffix).map((value) => ({ kind: "removed" as const, value })),
    ...next.slice(prefix, next.length - suffix).map((value) => ({ kind: "added" as const, value })),
    ...next.slice(next.length - suffix).map((value) => ({ kind: "same" as const, value })),
  ];

  if (lines.length <= limit) return lines;
  const head = Math.max(8, Math.floor(limit / 2));
  const tail = Math.max(8, limit - head - 1);
  return [...lines.slice(0, head), { kind: "same", value: "… diff truncated …" }, ...lines.slice(-tail)];
}

export function eventRaw(event: ReplayEvent): string {
  return prettyValue(event.raw);
}
