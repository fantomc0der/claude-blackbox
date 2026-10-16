import type { Workspace } from "../../shared/types";

export type WorkspaceSort = "sessions" | "cost" | "name";
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function workspaceSort(value: string | null): WorkspaceSort {
  return value === "cost" || value === "name" ? value : "sessions";
}

/** A case-insensitive substring test that treats both path separators alike, so a filter typed either way finds the folder. */
export function folderMatcher(filter: string): (value: string) => boolean {
  const query = filter.trim().toLocaleLowerCase().replaceAll("\\", "/");
  return value => value.toLocaleLowerCase().replaceAll("\\", "/").includes(query);
}

export interface SourceFolder { path: string; group: string }

/** Every recorded folder the grouping dialog can offer, sorted by path, with the group that already claims it. `filter` narrows the list by path. */
export function sourceFolders(workspaces: Workspace[], filter = ""): SourceFolder[] {
  const matches = folderMatcher(filter);
  return workspaces.flatMap(workspace => workspace.paths.map(path => ({ path, group: workspace.grouped ? workspace.id : "" })))
    .filter(source => matches(source.path))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function visibleWorkspaces(workspaces: Workspace[], sort: WorkspaceSort, filter: string): Workspace[] {
  const matches = folderMatcher(filter);
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
