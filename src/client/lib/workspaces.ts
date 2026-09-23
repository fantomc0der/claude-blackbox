import type { Workspace } from "../../shared/types";

export type WorkspaceSort = "sessions" | "cost" | "name";
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function workspaceSort(value: string | null): WorkspaceSort {
  return value === "cost" || value === "name" ? value : "sessions";
}

export function visibleWorkspaces(workspaces: Workspace[], sort: WorkspaceSort, filter: string): Workspace[] {
  const query = filter.trim().toLocaleLowerCase().replaceAll("\\", "/");
  const matches = (value: string) => value.toLocaleLowerCase().replaceAll("\\", "/").includes(query);
  return workspaces.filter(workspace => matches(workspace.name) || workspace.paths.some(matches)).sort((left, right) => {
    const byName = names.compare(left.name, right.name) || names.compare(left.id, right.id) || left.id.localeCompare(right.id);
    if (sort === "sessions") return right.count - left.count || byName;
    if (sort === "cost") {
      const leftPriced = left.usage.requests > left.usage.unpricedRequests;
      const rightPriced = right.usage.requests > right.usage.unpricedRequests;
      return Number(rightPriced) - Number(leftPriced) || right.usage.costUSD - left.usage.costUSD || byName;
    }
    return byName;
  });
}
