import { For, Show } from "solid-js";
import type { Catalog } from "../../shared/types";
import { compact } from "../lib/format";
import type { Navigate } from "../lib/location";
import { Icon } from "./icon";
import { ReadingWidthControl } from "./reading-width-control";
import { TextSizeControl } from "./text-size-control";
import { ThemeControl } from "./theme-control";

export function Sidebar(props: { catalog: Catalog | null; params: URLSearchParams; navigate: Navigate; group: () => void; refresh: () => void; close: () => void; hidden: boolean }) {
  const select = (values: Record<string, string | null>) => {
    props.navigate({ workspace: null, cwd: null, bookmarked: null, days: null, session: null, event: null, offset: null, ...values });
    props.close();
  };
  const all = () => !props.params.get("workspace") && !props.params.get("bookmarked") && !props.params.get("days");
  return <aside class="sidebar" aria-label="Workspace navigation" inert={props.hidden}>
    <a class="brand" href="/" onClick={event => { event.preventDefault(); select({ q: null, errors: null, edits: null, model: null, tool: null, branch: null, after: null, before: null, agents: null, active: null }); }}><span class="brand-mark"><Icon name="box" size={23} /></span><span>blackbox<small>FOR CLAUDE CODE</small></span></a>
    <button class="sidebar-mobile-close icon-button" onClick={props.close} aria-label="Close navigation"><Icon name="close" /></button>
    <div class="nav-section-label">FLIGHT RECORDER</div>
    <nav class="primary-nav" aria-label="Recordings">
      <button class={['nav-item', { selected: all() }]} aria-current={all() ? "page" : undefined} onClick={() => select({})}><Icon name="library" /><span>All sessions</span><span class="nav-count">{compact(props.catalog?.sessions || 0)}</span></button>
      <button class={['nav-item', { selected: props.params.get("bookmarked") === "1" }]} onClick={() => select({ bookmarked: "1" })}><Icon name="bookmark" /><span>Bookmarked</span><Show when={props.catalog?.bookmarked}><span class="nav-count">{props.catalog?.bookmarked}</span></Show></button>
      <button class={['nav-item', { selected: props.params.get("days") === "7" && !props.params.get("workspace") }]} onClick={() => select({ days: "7" })}><Icon name="clock" /><span>Last 7 days</span></button>
    </nav>
    <div class="nav-section-label workspace-label"><span>WORKSPACES</span><button class="icon-button tiny" title="Group workspaces" aria-label="Group workspaces" onClick={props.group}><Icon name="plus" size={16} /></button></div>
    <nav class="workspace-nav" aria-label="Workspaces"><For each={props.catalog?.workspaces || []}>{workspace => <button title={workspace.paths.join("\n")} class={['nav-item workspace-nav-item', { selected: props.params.get("workspace") === workspace.id }]} onClick={() => select({ workspace: workspace.id })}>
      <Icon name={workspace.grouped ? "merge" : "folder"} size={16} /><span>{workspace.name}<Show when={workspace.grouped}><small>{workspace.paths.length} folders, one history</small></Show></span><span class="nav-count">{workspace.count}</span>
    </button>}</For><Show when={props.catalog && !props.catalog.workspaces.length}><p class="nav-empty">Your projects will appear here once a session is recorded.</p></Show></nav>
    <Show when={props.catalog && !props.catalog.groups.length && props.catalog.workspaces.length > 1}><button class="group-hint" title="Group worktrees together" onClick={props.group}><Icon name="merge" size={16} /><span>Group worktrees</span><Icon name="chevron" size={14} /></button></Show>
    <div class="sidebar-footer"><ThemeControl /><TextSizeControl /><ReadingWidthControl /><div><Icon name="shield" size={17} /><span title="No cloud. No telemetry.">Local. Private. Yours.</span><button class="icon-button tiny" title="Rescan recordings" aria-label="Rescan recordings" onClick={props.refresh}><Icon name="refresh" size={15} /></button></div><span class="version-label">CLAUDE-BLACKBOX <span>V0.1.0</span></span></div>
  </aside>;
}
