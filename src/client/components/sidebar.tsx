import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import packageJson from "../../../package.json";
import type { Catalog } from "../../shared/types";
import { compact, usageCost } from "../lib/format";
import type { Navigate } from "../lib/location";
import { visibleWorkspaces, workspaceSort } from "../lib/workspaces";
import { Icon } from "./icon";
import { ReadingWidthControl } from "./reading-width-control";
import { TextSizeControl } from "./text-size-control";
import { ThemeControl } from "./theme-control";

const sortStorageKey = "blackbox:workspace-sort";

function savedSort() {
  try { return workspaceSort(localStorage.getItem(sortStorageKey)); }
  catch { return workspaceSort(null); }
}

export function Sidebar(props: { catalog: Catalog | null; params: URLSearchParams; navigate: Navigate; group: () => void; refresh: () => void; close: () => void; hidden: boolean }) {
  const [sort, setSort] = createSignal(savedSort());
  const [filter, setFilter] = createSignal("");
  const [filterOpen, setFilterOpen] = createSignal(false);
  let filterInput!: HTMLInputElement;
  let filterButton!: HTMLButtonElement;
  const workspaces = createMemo(() => visibleWorkspaces(props.catalog?.workspaces || [], sort(), filter()));
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
  const all = () => !props.params.get("workspace") && !props.params.get("bookmarked") && !props.params.get("days");
  return <aside class="sidebar" aria-label="Workspace navigation" inert={props.hidden}>
    <a class="brand" href="/" onClick={event => { event.preventDefault(); select({ q: null, workspace: null, cwd: null, days: null, bookmarked: null, errors: null, edits: null, model: null, effort: null, tool: null, branch: null, after: null, before: null, agents: null, active: null, pricing: null, minCost: null, maxCost: null, minTokens: null, maxTokens: null, minRecords: null, maxRecords: null }); }}><span class="brand-mark"><Icon name="box" size={23} /></span><span>blackbox<small>FOR CLAUDE CODE</small></span></a>
    <button class="sidebar-mobile-close icon-button" onClick={props.close} aria-label="Close navigation"><Icon name="close" /></button>
    <div class="nav-section-label">FLIGHT RECORDER</div>
    <nav class="primary-nav" aria-label="Recordings">
      <button class={['nav-item', { selected: all() }]} aria-current={all() ? "page" : undefined} onClick={() => select({})}><Icon name="library" /><span>All sessions</span><span class="nav-count">{compact(props.catalog?.sessions || 0)}</span></button>
      <button class={['nav-item', { selected: props.params.get("bookmarked") === "1" }]} onClick={() => select({ bookmarked: "1" })}><Icon name="bookmark" /><span>Bookmarked</span><Show when={props.catalog?.bookmarked}><span class="nav-count">{props.catalog?.bookmarked}</span></Show></button>
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
    <nav class="workspace-nav" aria-label="Workspaces"><For each={workspaces()}>{workspace => <button title={`${workspace.paths.join("\n")}\n${workspace.count} sessions · All-time cost (recorded or estimated): ${usageCost(workspace.usage)}`} aria-current={props.params.get("workspace") === workspace.id ? "page" : undefined} class={['nav-item workspace-nav-item', { selected: props.params.get("workspace") === workspace.id }]} onClick={() => select({ workspace: workspace.id })}>
      <Icon name={workspace.grouped ? "merge" : "folder"} size={16} /><span>{workspace.name}</span><Show when={workspace.grouped}><small>{workspace.paths.length} folders, one history</small></Show><span class="nav-count" title={sort() === "cost" ? `All-time cost (recorded or estimated): ${usageCost(workspace.usage)}. A + means some requests are unpriced.` : `${workspace.count} sessions`}>{sort() === "cost" ? usageCost(workspace.usage) : workspace.count}</span>
    </button>}</For><Show when={props.catalog && !props.catalog.workspaces.length}><p class="nav-empty">Your projects will appear here once a session is recorded.</p></Show><Show when={props.catalog?.workspaces.length && !workspaces().length}><div class="nav-empty" role="status"><p>No matching workspaces.</p><button class="text-button" onClick={() => { setFilter(""); filterInput.focus(); }}>Clear filter</button></div></Show></nav>
    <div class="sidebar-footer"><ThemeControl /><TextSizeControl /><ReadingWidthControl /><div><Icon name="shield" size={17} /><span title="No cloud. No telemetry.">Local. Private. Yours.</span><button class="icon-button tiny" title="Rescan recordings" aria-label="Rescan recordings" onClick={props.refresh}><Icon name="refresh" size={15} /></button></div><span class="version-label">CLAUDE-BLACKBOX <span>V{packageJson.version}</span></span></div>
  </aside>;
}
