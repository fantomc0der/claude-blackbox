import { Show } from "solid-js";
import type { Navigate } from "../lib/location";
import { Icon } from "./icon";

export function includesSubagents(params: URLSearchParams): boolean {
  return params.get("agents") === "1" || params.get("agents") === "only";
}

export function SubagentToggle(props: { params: URLSearchParams; navigate: Navigate; global?: boolean }) {
  return <button class="subagent-toggle" aria-label="Show subagents" aria-pressed={includesSubagents(props.params) ? "true" : "false"}
    title="Applies to all workspaces and session lists" aria-description="Applies to all workspaces and session lists"
    onClick={() => props.navigate({ agents: includesSubagents(props.params) ? null : "1", offset: null })}>
    <Icon name="branch" size={14} /><span class="subagent-toggle-label">Show subagents<Show when={props.global}><small>All workspaces &amp; lists</small></Show></span><span class="subagent-toggle-track" aria-hidden="true" />
  </button>;
}
