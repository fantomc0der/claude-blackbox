import { replayKeys } from "./replay-filters";

export function sessionDestination(id: string, event: string | null = null) {
  return { ...Object.fromEntries(replayKeys.map(key => [key, null])), session: id, event, context: null };
}

export function sessionHref(params: URLSearchParams, id: string, event: string | null = null) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(sessionDestination(id, event))) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return `/?${next}`;
}

export function isPlainNavigation(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

const replayPositions = new Map<string, number>();

export function replayPositionKey(id: string, params: URLSearchParams) {
  return JSON.stringify([id, ...[...replayKeys, "event", "context"].map(key => params.get(key))]);
}

export function rememberReplayPosition(key: string, position: number) {
  replayPositions.delete(key);
  replayPositions.set(key, position);
  if (replayPositions.size > 60) replayPositions.delete(replayPositions.keys().next().value!);
}

export function recalledReplayPosition(key: string) {
  return replayPositions.get(key);
}
