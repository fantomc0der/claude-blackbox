import type { Session } from "../../shared/types";

export const replayKeys = ["replayKind", "replayQ", "replayOnly", "replayTool", "replayModel", "replayCwd", "replayAfter", "replayBefore", "replayOffset", "replayErrors"] as const;

export type ReplayFilterValues = {
  kind: string;
  q: string;
  /** Whether the find term also narrows the replay to matching records, rather than only highlighting them. */
  only: boolean;
  tool: string;
  model: string;
  cwd: string;
  after: string;
  before: string;
  offset: number;
  errors: boolean;
};

export function replayFilters(params: URLSearchParams): ReplayFilterValues {
  const requestedKind = params.get("replayKind") || (params.get("event") ? "all" : "conversation");
  const kind = ["conversation", "all", "message", "tool", "thinking", "system", "prompts", "responses", "edits"].includes(requestedKind) ? requestedKind : "conversation";
  const rawOffset = params.get("replayOffset") || "0";
  const offset = /^\d+$/.test(rawOffset) ? Number(rawOffset) : 0;
  return {
    kind,
    q: params.get("replayQ") || "",
    only: params.get("replayOnly") === "1",
    tool: params.get("replayTool") || "",
    model: params.get("replayModel") || "",
    cwd: params.get("replayCwd") || "",
    after: params.get("replayAfter") || "",
    before: params.get("replayBefore") || "",
    offset: Number.isSafeInteger(offset) && offset > 0 && offset <= 1_000_000 ? offset : 0,
    errors: params.get("replayErrors") === "1",
  };
}

// The anchor offset is counted inside the opening view, so a search hit must open on a view that shows its record.
// Conversation shows messages, reasoning, and Claude Code's stand-ins such as API errors; it leaves out system and
// hidden-reasoning records and folds a tool result into its call's card, so those hits, and any hit of unknown kind,
// open on All events.
export function matchReplayKind(match: Pick<Session, "matchCategory" | "matchRole">): "conversation" | "all" {
  if (match.matchCategory === "message" || match.matchCategory === "thinking" || match.matchCategory === "synthetic") return "conversation";
  return match.matchCategory === "tool" && match.matchRole === "assistant" ? "conversation" : "all";
}

export function clearReplayFilters(values: Record<string, string | null> = {}) {
  return Object.fromEntries([...replayKeys.map(key => [key, null]), ...Object.entries(values)]) as Record<string, string | null>;
}
