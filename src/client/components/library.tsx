import { For, onSettled, Show } from "solid-js";
import type { Catalog, Session, SessionPage } from "../../shared/types";
import { anchoredMenu } from "../lib/anchor";
import { dismissableDetails } from "../lib/dismissable";
import { compact, dateTime, modelName, searchHighlight, timeAgo } from "../lib/format";
import type { Navigate } from "../lib/location";
import { Icon } from "./icon";
import { Highlight } from "./highlight";

interface LibraryProps {
  catalog: Catalog | null; page: SessionPage | null; pending: boolean; params: URLSearchParams;
  navigate: Navigate; query: string; setQuery: (query: string) => void;
  searchRef: (element: HTMLInputElement) => void; group: () => void;
}

export function Library(props: LibraryProps) {
  let filters!: HTMLDetailsElement, filterMenu!: HTMLDivElement;
  onSettled(() => { dismissableDetails(filters); anchoredMenu(filters, filterMenu); });
  const closeFilters = () => { filters.open = false; filters.querySelector("summary")!.focus(); };
  const selected = () => props.params.get("session");
  const workspace = () => props.catalog?.workspaces.find(workspace => workspace.id === props.params.get("workspace"));
  const filter = (values: Record<string, string | null>) => props.navigate({ offset: null, ...values });
  const clear = () => {
    props.setQuery("");
    filter(Object.fromEntries(["q", "workspace", "cwd", "days", "bookmarked", "errors", "edits", "model", "tool", "branch", "after", "before", "agents", "active"].map(key => [key, null])));
  };
  const chips = () => {
    const labels: Record<string, string> = { workspace: workspace()?.name || "Workspace", cwd: "Source folder", bookmarked: "Bookmarked", days: `Last ${props.params.get("days")} days`, errors: "Has errors", edits: "File changes", model: modelName(props.params.get("model") || ""), tool: props.params.get("tool") || "", branch: `Branch: ${props.params.get("branch")}`, after: `From ${props.params.get("after")}`, before: `To ${props.params.get("before")}`, agents: "Main sessions only", active: "Recently active" };
    return Object.entries(labels).filter(([key]) => props.params.get(key));
  };
  const bookmarksOnly = () => props.params.get("bookmarked") === "1" && !props.params.get("q") && !props.query && chips().length === 1;
  const countUnit = () => `${props.query ? " result" : " recording"}${props.page?.total === 1 ? "" : "s"}`;
  const openSession = (session: Session) => props.navigate({ session: session.id, event: session.matchEventId || null });
  return <section id="session-library" class={['library', { 'library-split': Boolean(selected()) }]} aria-label="Session library">
    <header class="library-heading"><div><p class="eyebrow">YOUR DEVELOPMENT, DOCUMENTED</p><h1>{selected() ? "Session library" : props.params.get("bookmarked") ? "Worth coming back to." : workspace() ? workspace()!.name : <>Good work leaves <span>a trail.</span></>}</h1><p class="library-description">Every prompt, every breakthrough, every detour. All right here.</p></div><button class="secondary-button heading-group" onClick={props.group}><Icon name="merge" size={16} />Group workspaces</button></header>
    <Show when={!selected()}><div class="overview">
      <div class="stat"><span class="stat-label"><Icon name="library" size={15} />RECORDED SESSIONS</span><strong>{compact(props.catalog?.sessions || 0)}</strong><span class="stat-note">Your complete local history</span></div>
      <div class="stat"><span class="stat-label"><Icon name="folder" size={15} />WORKSPACES</span><strong>{props.catalog?.workspaces.length || 0}</strong><span class="stat-note">Across projects & worktrees</span></div>
      <div class="stat"><span class="stat-label"><Icon name="terminal" size={15} />TOOL CALLS</span><strong>{compact(props.catalog?.tools || 0)}</strong><span class="stat-note">Every step of the process</span></div>
      <div class="archive-note"><div class="signal-art" aria-hidden="true"><For each={[15, 27, 18, 40, 29, 54, 34, 45, 25, 36, 17, 24]}>{height => <span style={{ height: `${height}px` }} />}</For></div><div><span class="eyebrow">NOTHING LOST.</span><p>Pick up the thread.<br />Find your next idea.</p></div></div>
    </div></Show>
    <div class="discovery-controls">
      <div class="search-box"><Icon name="search" size={19} /><input ref={props.searchRef} aria-label="Search all recordings" placeholder="Search prompts, code, tool output…" value={props.query} onInput={event => props.setQuery(event.currentTarget.value)} onKeyDown={event => {
        if (event.key === "Escape") { props.setQuery(""); filter({ q: null }); }
        if (event.key === "ArrowDown") { event.preventDefault(); document.querySelector<HTMLButtonElement>(".session-row")?.focus(); }
      }} /><Show when={props.query} fallback={<kbd>Ctrl K</kbd>}><button class="icon-button tiny" aria-label="Clear search" onClick={() => { props.setQuery(""); filter({ q: null }); }}><Icon name="close" size={16} /></button></Show></div>
      <div class="filter-row"><div class="filter-tabs" role="group" aria-label="Quick filters">
        <button class={['filter-tab', { active: !props.params.get("edits") && !props.params.get("errors") }]} onClick={() => filter({ edits: null, errors: null })}>All sessions</button>
        <button class={['filter-tab', { active: props.params.get("edits") === "1" }]} onClick={() => filter({ edits: props.params.get("edits") ? null : "1" })}><Icon name="edit" size={14} />With edits</button>
        <button class={['filter-tab', { active: props.params.get("errors") === "1" }]} onClick={() => filter({ errors: props.params.get("errors") ? null : "1" })}><Icon name="alert" size={14} />With errors</button>
      </div><details class="filter-popover" ref={filters}><summary aria-label="Filter recordings"><Icon name="sliders" size={16} /><span>Filters</span><Show when={chips().length}><span class="filter-count">{chips().length}</span></Show></summary><div class="filter-menu" ref={filterMenu}>
        <div class="filter-menu-heading"><h3>Refine your recordings</h3><button class="icon-button tiny filter-menu-close" aria-label="Close filters" onClick={closeFilters}><Icon name="close" size={16} /></button></div>
        <label>Model<select value={props.params.get("model") || ""} onChange={event => filter({ model: event.currentTarget.value || null })}><option value="">All models</option><For each={props.catalog?.models || []}>{model => <option value={model}>{modelName(model)}</option>}</For></select></label>
        <label>Recorded<select value={props.params.get("days") || ""} onChange={event => filter({ days: event.currentTarget.value || null })}><option value="">Any time</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
        <Show when={workspace()}><label>Original source<select aria-label="Original source" value={props.params.get("cwd") || ""} onChange={event => filter({ cwd: event.currentTarget.value || null })}><option value="">All source folders</option><For each={workspace()?.paths || []}>{path => <option value={path}>{path || "Unknown source"}</option>}</For></select></label></Show>
        <label>Tool used<select value={props.params.get("tool") || ""} onChange={event => filter({ tool: event.currentTarget.value || null })}><option value="">Any tool</option><For each={["Bash", "PowerShell", "Read", "Edit", "Write", "Grep", "Glob", "Task", "Agent", "WebSearch", "WebFetch", "mcp__"]}>{tool => <option value={tool}>{tool === "mcp__" ? "MCP tools" : tool}</option>}</For></select></label>
        <label>Git branch<input placeholder="Exact branch name" value={props.params.get("branch") || ""} onChange={event => filter({ branch: event.currentTarget.value.trim() || null })} /></label>
        <div class="date-fields"><label>From<input type="date" value={props.params.get("after") || ""} onChange={event => filter({ after: event.currentTarget.value || null, days: null })} /></label><label>Through<input type="date" value={props.params.get("before") || ""} onChange={event => filter({ before: event.currentTarget.value || null, days: null })} /></label></div>
        <label class="checkbox-label"><input type="checkbox" checked={props.params.get("agents") !== "0"} onChange={event => filter({ agents: event.currentTarget.checked ? null : "0" })} />Include subagent recordings</label>
        <label class="checkbox-label"><input type="checkbox" checked={props.params.get("active") === "1"} onChange={event => filter({ active: event.currentTarget.checked ? "1" : null })} />Active in the last 2 minutes</label>
        <button class="text-button" onClick={clear}>Reset all filters</button><p class="search-help">Search: <code>"exact phrase" -exclude</code><br />Searches messages, code, and tool output.</p>
      </div></details></div>
      <Show when={chips().length}><div class="active-filters"><For each={chips()}>{([key, label]) => <button class="filter-chip" title={`Remove ${label}`} onClick={() => filter({ [key]: null, ...(key === "workspace" ? { cwd: null } : {}) })}>{label}<Icon name="close" size={12} /></button>}</For><button class="clear-filters" onClick={clear}>Clear all</button></div></Show>
    </div>
    <div class="list-caption"><span>{props.query ? "SEARCH RESULTS" : "RECORDINGS"}<span class="result-count" aria-live="polite">{props.page?.total ?? "—"}<span class="count-unit">{countUnit()}</span></span><Show when={props.pending}><span class="loading-dot" /></Show></span><select aria-label="Sort recordings" value={props.params.get("sort") || "recent"} onChange={event => filter({ sort: event.currentTarget.value })}><option value="recent">Newest first</option><option value="oldest">Oldest first</option><option value="activity">Most activity</option></select></div>
    <div class="recordings-scroll" aria-busy={props.pending ? "true" : "false"} onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".session-row")];
      const index = rows.indexOf(document.activeElement as HTMLButtonElement);
      const style = getComputedStyle(event.currentTarget);
      const columns = style.display === "grid" ? style.gridTemplateColumns.split(" ").length : 1;
      const step = event.key === "ArrowDown" ? columns : event.key === "ArrowUp" ? -columns : event.key === "ArrowRight" ? 1 : -1;
      if (index !== -1) { event.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, index + step))]?.focus(); }
    }}>
      <Show when={props.page} fallback={<div class="skeleton-list"><For each={[1, 2, 3, 4, 5]}>{() => <div class="skeleton-row" />}</For></div>}>
        <For each={props.page?.items || []} fallback={<div class="empty-state"><span class="empty-icon"><Icon name={!props.catalog?.sessions ? "box" : bookmarksOnly() ? "bookmark" : "search"} size={32} /></span><h2>{!props.catalog?.sessions ? "Your next session starts the story." : bookmarksOnly() ? "No bookmarks yet." : "No trails match this search."}</h2><p>{!props.catalog?.sessions ? "Use Claude Code in a project, then come back. Your recordings will appear here automatically." : bookmarksOnly() ? "Bookmark a session from its replay to keep it here." : "Try a different phrase or give your filters a little more room."}</p><Show when={props.catalog?.sessions} fallback={<code class="empty-source">{props.catalog?.dataDir}</code>}><Show when={bookmarksOnly()} fallback={<button class="secondary-button" onClick={clear}>Clear search & filters</button>}><button class="secondary-button" onClick={() => filter({ bookmarked: null })}>Browse all sessions</button></Show></Show></div>}>
          {session => <button class={['session-row', { selected: selected() === session.id }]} data-session-id={session.id} aria-current={selected() === session.id ? "true" : undefined} onClick={() => openSession(session)}>
            <span class={['session-symbol', { 'has-error': session.errorCount > 0 }]}><Icon name={session.isAgent ? "branch" : session.hasEdits ? "edit" : "message"} size={18} /></span>
            <span class="session-main"><span class="session-title"><Highlight text={session.title} term={searchHighlight(props.query)} /><Show when={session.bookmarked}><Icon name="bookmark" size={13} /></Show></span><Show when={session.snippet} fallback={<span class="session-path" title={session.cwd}><Icon name="folder" size={12} />{session.workspace}<span class="meta-dot">·</span><span class="row-branch"><Icon name="branch" size={12} />{session.branch || "No branch recorded"}</span></span>}><span class="session-snippet"><Highlight text={session.snippet!} term={searchHighlight(props.query)} /></span></Show></span>
            <span class="session-model" title={session.model}><span class="model-dot" />{modelName(session.model)}</span>
            <span class="session-activity"><span title="Messages"><Icon name="message" size={13} />{session.messageCount}</span><span title="Tool calls"><Icon name="terminal" size={13} />{session.toolCount}</span></span>
            <span class="session-time" title={dateTime(session.updatedAt)}><Show when={session.active}><span class="live-dot" /></Show>{timeAgo(session.updatedAt)}</span><Icon name="chevron" size={15} class="row-chevron" />
          </button>}
        </For>
      </Show>
    </div>
    <footer class="library-footer"><span><Icon name="shield" size={13} /><Show when={props.catalog?.demo} fallback="Only on your machine">Synthetic demo recordings</Show></span><Show when={props.page && props.page.total > props.page.limit}><div class="pagination"><button class="icon-button tiny" disabled={!props.page?.offset} aria-label="Previous recordings" onClick={() => filter({ offset: String(Math.max(0, (props.page?.offset || 0) - 50)) })}><Icon name="back" size={15} /></button><span>{(props.page?.offset || 0) + 1}–{Math.min((props.page?.offset || 0) + (props.page?.limit || 0), props.page?.total || 0)}</span><button class="icon-button tiny" disabled={(props.page?.offset || 0) + (props.page?.limit || 0) >= (props.page?.total || 0)} aria-label="Next recordings" onClick={() => props.navigate({ offset: String((props.page?.offset || 0) + 50) })}><Icon name="arrow" size={15} /></button></div></Show></footer>
  </section>;
}
