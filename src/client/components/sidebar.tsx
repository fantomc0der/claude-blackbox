import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import packageJson from "../../../package.json";
import type { Catalog, IndexProgress } from "../../shared/types";
import { compact, usageCost } from "../lib/format";
import type { Navigate } from "../lib/location";
import { visibleWorkspaces, workspaceSort } from "../lib/workspaces";
import { Icon } from "./icon";
import { IndexStatus } from "./index-status";
import { ReadingWidthControl } from "./reading-width-control";
import { TextSizeControl } from "./text-size-control";
import { ThemeControl } from "./theme-control";
import { includesSubagents, SubagentToggle } from "./subagent-toggle";

const sortStorageKey = "blackbox:workspace-sort";

function savedSort() {
  try { return workspaceSort(localStorage.getItem(sortStorageKey)); }
  catch { return workspaceSort(null); }
}

export function Sidebar(props: { catalog: Catalog | null; indexing: IndexProgress | null; refreshing: boolean; params: URLSearchParams; navigate: Navigate; group: () => void; refresh: () => void; close: () => void; hidden: boolean }) {
  const [sort, setSort] = createSignal(savedSort());
  const [filter, setFilter] = createSignal("");
  const [filterOpen, setFilterOpen] = createSignal(false);
  let filterInput!: HTMLInputElement;
  let filterButton!: HTMLButtonElement;
  const workspaces = createMemo(() => visibleWorkspaces((props.catalog?.workspaces || [])
    .map(workspace => includesSubagents(props.params) ? workspace : { ...workspace, count: workspace.mainCount ?? workspace.count })
    .filter(workspace => workspace.count > 0), sort(), filter()));
  const workspaceIds = createMemo(() => workspaces().map(workspace => workspace.id));
  const workspaceById = createMemo(() => new Map(workspaces().map(workspace => [workspace.id, workspace])));
  const sessions = () => includesSubagents(props.params) ? props.catalog?.sessions : props.catalog?.mainSessions ?? props.catalog?.sessions;
  const bookmarked = () => includesSubagents(props.params) ? props.catalog?.bookmarked : props.catalog?.mainBookmarked ?? props.catalog?.bookmarked;
  createEffect(() => filterOpen(), open => { if (open) filterInput.focus(); });
  const changeSort = (value: string) => {
    const next = workspaceSort(value);
    setSort(next);
    try { localStorage.setItem(sortStorageKey, next); }
    catch {}
  };
  const closeFilter = () => { setFilter(""); setFilterOpen(false); filterButton.focus(); };
  const select = (values: Record<string, string | null>) => {
    props.navigate({ workspace: null, cwd: null, bookmarked: null, days: null, session: null, event: null, offset: null, ...values });
    props.close();
  };
  const reset = () => select({ ...Object.fromEntries(["q", "errors", "edits", "model", "effort", "effortMissing", "tool", "branch", "after", "before", "agents", "active", "pricing", "minCost", "maxCost", "minTokens", "maxTokens", "minRecords", "maxRecords"].map(key => [key, null])) });
  const all = () => !props.params.get("workspace") && !props.params.get("bookmarked") && !props.params.get("days");
  return <aside class="sidebar" aria-label="Workspace navigation" inert={props.hidden}>
    <a class="brand" href="/" onClick={event => { event.preventDefault(); reset(); }}><span class="brand-mark"><Icon name="box" size={23} /></span><span>blackbox<small>FOR CLAUDE CODE</small></span></a>
    <button class="sidebar-mobile-close icon-button" onClick={props.close} aria-label="Close navigation"><Icon name="close" /></button>
    <nav class="primary-nav" aria-label="Recordings">
      <button class={['nav-item', { selected: all() }]} aria-current={all() ? "page" : undefined} onClick={() => select({})}><Icon name="library" /><span>All sessions</span><span class="nav-count">{compact(sessions() || 0)}</span></button>
      <button class={['nav-item', { selected: props.params.get("bookmarked") === "1" }]} onClick={() => select({ bookmarked: "1" })}><Icon name="bookmark" /><span>Bookmarked</span><Show when={bookmarked()}><span class="nav-count">{bookmarked()}</span></Show></button>
      <button class={['nav-item', { selected: props.params.get("days") === "7" && !props.params.get("workspace") }]} onClick={() => select({ days: "7", after: null, before: null })}><Icon name="clock" /><span>Last 7 days</span></button>
    </nav>
    <div class="nav-section-label workspace-label"><span>WORKSPACES</span><button class="text-button workspace-group" title="Group workspaces" aria-label="Group workspaces" onClick={props.group}><Icon name="merge" size={14} /><span>Group</span></button></div>
    <div class="workspace-controls">
      <select aria-label="Sort workspaces" value={sort()} onChange={event => changeSort(event.currentTarget.value)} title="Sort all workspaces. Cost includes all sessions and folders in each group, independent of session filters.">
        <option value="sessions">Most sessions</option><option value="cost">Highest cost (est.)</option><option value="name">Folder name (A–Z)</option>
      </select>
      <button ref={filterButton} class="icon-button workspace-filter-toggle" aria-label={filterOpen() ? "Clear and close workspace filter" : "Filter workspaces"} title={filterOpen() ? "Clear and close workspace filter" : "Filter by workspace name or folder path"} aria-expanded={filterOpen() ? "true" : "false"} aria-controls="workspace-filter" onClick={() => filterOpen() ? closeFilter() : setFilterOpen(true)}><Icon name="search" size={16} /></button>
    </div>
    <div class="workspace-filter" id="workspace-filter" hidden={!filterOpen()}>
      <input ref={filterInput} type="search" aria-label="Filter workspaces by name or path" placeholder="Name or folder path…" value={filter()} onInput={event => setFilter(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFilter(); } }} />
    </div>
    <nav class="workspace-nav" aria-label="Workspaces"><For each={workspaceIds()}>{id => {
      const workspace = () => workspaceById().get(id)!;
      return <button title={`${workspace().paths.join("\n")}\n${workspace().count} sessions · All-time cost including subagents (recorded or estimated): ${usageCost(workspace().usage)}`} aria-current={props.params.get("workspace") === id ? "page" : undefined} class={['nav-item workspace-nav-item', { selected: props.params.get("workspace") === id }]} onClick={() => select({ workspace: id })}>
        <Icon name={workspace().grouped ? "merge" : "folder"} size={16} /><span>{workspace().name}</span><Show when={workspace().grouped}><small>{workspace().paths.length} folders, one history</small></Show><span class="nav-count" title={sort() === "cost" ? `All-time cost including subagents (recorded or estimated): ${usageCost(workspace().usage)}. A + means some requests are unpriced.` : `${workspace().count} sessions`}>{sort() === "cost" ? usageCost(workspace().usage) : workspace().count}</span>
      </button>;
    }}</For><Show when={props.catalog && !workspaces().length}><div class="nav-empty" role="status"><p>{!props.catalog?.workspaces.length ? "Your projects will appear here once a session is recorded." : filter() ? "No matching workspaces." : "No workspaces with visible sessions."}</p><Show when={filter() && props.catalog?.workspaces.length}><button class="text-button" onClick={() => { setFilter(""); filterInput.focus(); }}>Clear filter</button></Show></div></Show></nav>
    <div class="sidebar-footer"><SubagentToggle params={props.params} navigate={props.navigate} global /><ThemeControl /><TextSizeControl /><ReadingWidthControl /><IndexStatus catalog={props.catalog} progress={props.indexing} refreshing={props.refreshing} refresh={props.refresh} /><div><Icon name="shield" size={17} /><span title="No cloud. No telemetry.">Local. Private. Yours.</span><span class="version-label" title="Claude Blackbox version"><span>V{packageJson.version}</span></span></div></div>
  </aside>;
}
