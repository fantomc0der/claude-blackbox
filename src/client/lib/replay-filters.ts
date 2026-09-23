export const replayKeys = ["replayKind", "replayQ", "replayTool", "replayModel", "replayCwd", "replayAfter", "replayBefore", "replayOffset", "replayErrors"] as const;

export type ReplayFilterValues = {
  kind: string;
  q: string;
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
    tool: params.get("replayTool") || "",
    model: params.get("replayModel") || "",
    cwd: params.get("replayCwd") || "",
    after: params.get("replayAfter") || "",
    before: params.get("replayBefore") || "",
    offset: Number.isSafeInteger(offset) && offset > 0 && offset <= 1_000_000 ? offset : 0,
    errors: params.get("replayErrors") === "1",
  };
}

export function clearReplayFilters(values: Record<string, string | null> = {}) {
  return Object.fromEntries([...replayKeys.map(key => [key, null]), ...Object.entries(values)]) as Record<string, string | null>;
}
