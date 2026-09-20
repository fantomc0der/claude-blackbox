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
  return Object.entries(object(value))
    .filter(([key]) => !["data", "signature", "encrypted_content"].includes(key))
    .map(([key, entry]) => `${key}: ${searchable(entry)}`).join("\n");
}

export function normalize(raw: Record<string, unknown>, sourceId: string, offset: number, sequence: number): ReplayEvent {
  const message = object(raw.message);
  const type = string(raw.type) || "unknown";
  const role = type === "user" || type === "assistant" ? type : "system";
  const content = message.content ?? raw.content;
  let blocks: ContentBlock[] = [];
  if (typeof content === "string") blocks = [{ type: "text", text: content }];
  else if (Array.isArray(content)) blocks = content.map(entry => {
    if (typeof entry === "string") return { type: "text", text: entry };
    const block = object(entry);
    return { ...block, type: string(block.type) || "unknown" } as ContentBlock;
  });
  if (!blocks.length && typeof raw.summary === "string") blocks = [{ type: "text", text: raw.summary }];
  const text = blocks.length ? searchable(blocks) : searchable(raw);
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
    category: role === "system" ? "system" : hasText ? "message" : hasTools ? "tool" : "thinking",
    toolNames: tools.map(block => block.name || "Unknown tool"),
    error: blocks.some(block => block.is_error === true) || raw.is_error === true || raw.level === "error",
    parentId: string(raw.parentUuid) || undefined,
    uuid: string(raw.uuid) || undefined,
    cwd: string(raw.cwd) || undefined,
    agentId: string(raw.agentId) || undefined,
    raw,
  };
}

export function promptTitle(event: ReplayEvent): string {
  if (event.role !== "user") return "";
  return event.blocks.filter(block => block.type === "text").map(block => block.text || "").join(" ")
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function pathName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || "Unknown workspace";
}
