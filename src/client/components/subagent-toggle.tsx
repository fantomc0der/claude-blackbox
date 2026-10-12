import type { Navigate } from "../lib/location";
import { Icon } from "./icon";

export function includesSubagents(params: URLSearchParams): boolean {
  return params.get("agents") === "1" || params.get("agents") === "only";
}

export function SubagentToggle(props: { params: URLSearchParams; navigate: Navigate }) {
  return <button class="subagent-toggle" aria-label="Show subagents" aria-pressed={includesSubagents(props.params) ? "true" : "false"}
    title="Applies to all workspaces and session lists. Usage totals include subagent cost either way." aria-description="Applies to all workspaces and session lists. Usage totals include subagent cost either way."
    onClick={() => props.navigate({ agents: includesSubagents(props.params) ? null : "1", offset: null })}>
    <Icon name="branch" size={14} /><span class="subagent-toggle-label">Show subagents</span><span class="subagent-toggle-track" aria-hidden="true" />
  </button>;
}
