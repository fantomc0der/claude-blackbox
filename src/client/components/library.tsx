import { For, onSettled, Show } from "solid-js";
import type { Catalog, Session, SessionPage } from "../../shared/types";
import { anchoredMenu } from "../lib/anchor";
import { dismissableDetails } from "../lib/dismissable";
import { compact, dateTime, modelName, searchHighlight, timeAgo, tokenCount, usageCost } from "../lib/format";
import type { Navigate } from "../lib/location";
import { clearReplayFilters } from "../lib/replay-filters";
import { withSelectedOption } from "../lib/filter-options";
import { Icon } from "./icon";
import { Highlight } from "./highlight";
import { UsagePanel } from "./usage-panel";

interface LibraryProps {
  catalog: Catalog | null; page: SessionPage | null; pending: boolean; params: URLSearchParams;
  navigate: Navigate; query: string; setQuery: (query: string) => void;
  searchRef: (element: HTMLInputElement) => void;
}

export function Library(props: LibraryProps) {
  let filters!: HTMLDetailsElement, filterMenu!: HTMLDivElement;
  onSettled(() => { const releases = [dismissableDetails(filters), anchoredMenu(filters, filterMenu)]; return () => { for (const release of releases) release(); }; });
  const closeFilters = () => { filters.open = false; filters.querySelector("summary")!.focus(); };
  const selected = () => props.params.get("session");
  const workspace = () => props.catalog?.workspaces.find(workspace => workspace.id === props.params.get("workspace"));
  const filter = (values: Record<string, string | null>) => props.navigate({ offset: null, ...values });
  const archiveKeys = ["q", "workspace", "cwd", "days", "bookmarked", "errors", "edits", "model", "effort", "effortMissing", "tool", "branch", "after", "before", "agents", "active", "pricing", "minCost", "maxCost", "minTokens", "maxTokens", "minRecords", "maxRecords"];
  const clear = () => {
    props.setQuery("");
    filter(Object.fromEntries(archiveKeys.map(key => [key, null])));
  };
  const chips = () => {
    const pricing = { complete: "Fully priced", partial: "Partially priced", unpriced: "Usage, no price", missing: "No usage recorded" }[props.params.get("pricing") || ""];
    const labels: Record<string, string> = { workspace: workspace()?.name || "Workspace", cwd: "Source folder", bookmarked: "Bookmarked", days: `Last ${props.params.get("days")} days`, errors: "Has errors", edits: "File changes", model: modelName(props.params.get("model") || ""), effort: `Effort: ${props.params.get("effort")}`, tool: props.params.get("tool") || "", branch: `Branch: ${props.params.get("branch")}`, after: `From ${props.params.get("after")}`, before: `To ${props.params.get("before")}`, agents: props.params.get("agents") === "only" ? "Subagents only" : "Main sessions only", active: "Recently active", pricing: `Pricing: ${pricing}`, minCost: `Est. cost from $${props.params.get("minCost")}`, maxCost: `Est. cost through $${props.params.get("maxCost")}`, minTokens: `Tokens from ${props.params.get("minTokens")}`, maxTokens: `Tokens through ${props.params.get("maxTokens")}`, minRecords: `Records from ${props.params.get("minRecords")}`, maxRecords: `Records through ${props.params.get("maxRecords")}` };
    labels.effortMissing = "Effort: not recorded";
    return Object.entries(labels).filter(([key]) => props.params.get(key));
  };
  const bookmarksOnly = () => props.params.get("bookmarked") === "1" && !props.params.get("q") && !props.query && chips().length === 1;
  const countUnit = () => `${props.query ? " result" : " recording"}${props.page?.total === 1 ? "" : "s"}`;
  const openSession = (session: Session) => props.navigate(clearReplayFilters({ session: session.id, event: session.matchEventId || null, context: null }));
  const discovering = () => Boolean(props.query.trim() || props.params.get("q") || props.params.get("workspace") || chips().length);
  const sort = () => props.params.get("sort") || "recent";
  const recordedSpan = (session: Session) => {
    const milliseconds = Date.parse(session.updatedAt) - Date.parse(session.startedAt);
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
    const minutes = Math.floor(milliseconds / 60_000);
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };
  const changeRange = (key: string, integer = false) => (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const value = input.value.trim();
    const numeric = Number(value);
    const paired = props.params.get(key.startsWith("min") ? key.replace("min", "max") : key.replace("max", "min"));
    const pairedNumber = paired === null ? null : Number(paired);
    const invalid = Boolean(value) && (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(numeric) || numeric < 0 || numeric > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(numeric)) || (pairedNumber !== null && (key.startsWith("min") ? numeric > pairedNumber : numeric < pairedNumber)));
    input.setCustomValidity(invalid ? "Enter a nonnegative range with a minimum no greater than its maximum." : "");
    if (invalid) { input.reportValidity(); return; }
    filter({ [key]: value || null });
  };
  return <section id="session-library" class={['library', { 'library-split': Boolean(selected()) }]} aria-label="Session library">
    <header class="library-heading"><div><h1>{selected() ? "Session library" : props.params.get("bookmarked") ? "Worth coming back to." : workspace() ? workspace()!.name : discovering() ? "Session library" : <>Good work leaves <span>a trail.</span></>}</h1><Show when={!selected() && !discovering()}><p class="library-description">Every prompt, every breakthrough, every detour. All right here.</p></Show></div></header>
    <Show when={!selected() && !discovering()}><dl class="overview" aria-label="Archive totals">
      <div class="stat"><dt>Recordings</dt><dd>{compact(props.catalog?.sessions || 0)}</dd></div>
      <div class="stat"><dt>Workspaces</dt><dd>{props.catalog?.workspaces.length || 0}</dd></div>
      <div class="stat"><dt>Tool calls</dt><dd>{compact(props.catalog?.tools || 0)}</dd></div>
    </dl></Show>
    <UsagePanel page={props.page} pending={props.pending} filterDirectory={cwd => filter({ cwd })} filterModel={(model, effort) => filter({ model, effort, effortMissing: effort === null ? "1" : null })} />
    <div class="discovery-controls">
      <div class="search-box"><Icon name="search" size={19} /><input ref={props.searchRef} aria-label="Search all recordings" placeholder="Search prompts, code, tool output…" value={props.query} onInput={event => props.setQuery(event.currentTarget.value)} onKeyDown={event => {
        if (event.key === "Escape") { props.setQuery(""); filter({ q: null }); }
        if (event.key === "ArrowDown") { event.preventDefault(); document.querySelector<HTMLButtonElement>(".session-row")?.focus(); }
      }} /><Show when={props.query} fallback={<kbd>Ctrl K</kbd>}><button class="icon-button tiny" aria-label="Clear search" onClick={() => { props.setQuery(""); filter({ q: null }); }}><Icon name="close" size={16} /></button></Show></div>
      <div class="filter-row"><div class="filter-tabs" role="group" aria-label="Quick filters">
        <button class={['filter-tab', { active: !props.params.get("edits") && !props.params.get("errors") }]} aria-pressed={!props.params.get("edits") && !props.params.get("errors") ? "true" : "false"} onClick={() => filter({ edits: null, errors: null })}>All sessions</button>
        <button class={['filter-tab', { active: props.params.get("edits") === "1" }]} aria-pressed={props.params.get("edits") === "1" ? "true" : "false"} onClick={() => filter({ edits: props.params.get("edits") ? null : "1" })}><Icon name="edit" size={14} />With edits</button>
        <button class={['filter-tab', { active: props.params.get("errors") === "1" }]} aria-pressed={props.params.get("errors") === "1" ? "true" : "false"} onClick={() => filter({ errors: props.params.get("errors") ? null : "1" })}><Icon name="alert" size={14} />With errors</button>
      </div><details class="filter-popover" ref={filters}><summary aria-label="Filter recordings"><Icon name="sliders" size={16} /><span>Filters</span><Show when={chips().length}><span class="filter-count">{chips().length}</span></Show></summary><div class="filter-menu" ref={filterMenu}>
        <div class="filter-menu-heading"><h3>Refine your recordings</h3><button class="icon-button tiny filter-menu-close" aria-label="Close filters" onClick={closeFilters}><Icon name="close" size={16} /></button></div>
        <Show when={props.catalog?.facetsLimited}><p class="search-help">Up to 200 values per filter are shown. Full-record search still covers omitted or unusual metadata.</p></Show>
        <label>Model<select aria-label="Model" value={props.params.get("model") || ""} onChange={event => filter({ model: event.currentTarget.value || null })}><option value="">All models</option><Show when={props.params.get("model") && !props.catalog?.models.includes(props.params.get("model")!)}><option value={props.params.get("model")!}>{modelName(props.params.get("model")!)}</option></Show><For each={props.catalog?.models || []}>{model => <option value={model}>{modelName(model)}</option>}</For></select></label>
        <label>Effort<select aria-label="Effort" value={props.params.get("effortMissing") === "1" ? "missing" : props.params.get("effort") ? `recorded:${props.params.get("effort")}` : ""} onChange={event => { const value = event.currentTarget.value; filter({ effort: value.startsWith("recorded:") ? value.slice(9) : null, effortMissing: value === "missing" ? "1" : null }); }}><option value="">Any effort</option><For each={withSelectedOption(props.catalog?.efforts || [], props.params.get("effort") || "")}>{effort => <option value={`recorded:${effort}`}>{effort}</option>}</For><option value="missing">Not recorded</option></select></label>
        <label>Last activity (UTC dates)<select value={props.params.get("days") || ""} onChange={event => filter({ days: event.currentTarget.value || null, after: null, before: null })}><option value="">Any time</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
        <Show when={workspace()}><label>Original source<select aria-label="Original source" value={props.params.get("cwd") || ""} onChange={event => filter({ cwd: event.currentTarget.value || null })}><option value="">All source folders</option><For each={workspace()?.paths || []}>{path => <option value={path}>{path || "Unknown source"}</option>}</For></select></label></Show>
        <label>Tool used<select value={props.params.get("tool") || ""} onChange={event => filter({ tool: event.currentTarget.value || null })}><option value="">Any tool</option><option value="mcp__">All MCP tools</option><For each={withSelectedOption(props.catalog?.toolsUsed || [], props.params.get("tool") || "").filter(tool => tool !== "mcp__")}>{tool => <option value={tool}>{tool}</option>}</For></select></label>
        <label>Git branch<input placeholder="Exact branch name" value={props.params.get("branch") || ""} onChange={event => filter({ branch: event.currentTarget.value.trim() || null })} /></label>
        <div class="date-fields"><label>From<input type="date" value={props.params.get("after") || ""} onChange={event => filter({ after: event.currentTarget.value || null, days: null })} /></label><label>Through<input type="date" value={props.params.get("before") || ""} onChange={event => filter({ before: event.currentTarget.value || null, days: null })} /></label></div>
        <Show when={props.params.get("after") && props.params.get("before") && props.params.get("after")! > props.params.get("before")!}><p class="usage-warning" role="alert">The start date must not be after the end date.</p></Show>
        <label>Agent recordings<select value={props.params.get("agents") || ""} onChange={event => filter({ agents: event.currentTarget.value || null })}><option value="">Main and subagents</option><option value="0">Main sessions only</option><option value="only">Subagents only</option></select></label>
        <label>Pricing<select value={props.params.get("pricing") || ""} onChange={event => filter({ pricing: event.currentTarget.value || null })}><option value="">Any pricing state</option><option value="complete">Fully priced</option><option value="partial">Partially priced</option><option value="unpriced">Usage, no price</option><option value="missing">No usage recorded</option></select></label>
        <details class="filter-range-group"><summary>Usage &amp; record ranges</summary><div class="filter-range-fields">
          <fieldset><legend>Estimated cost (USD)</legend><label>From<input aria-label="Minimum estimated cost (USD)" type="number" min="0" step="any" inputmode="decimal" value={props.params.get("minCost") || ""} onChange={changeRange("minCost")} /></label><label>Through<input aria-label="Maximum estimated cost (USD)" type="number" min="0" step="any" inputmode="decimal" value={props.params.get("maxCost") || ""} onChange={changeRange("maxCost")} /></label><p>Requires complete pricing; excludes partial or missing estimates.</p></fieldset>
          <fieldset><legend>Total tokens</legend><label>From<input type="number" min="0" step="1" inputmode="numeric" value={props.params.get("minTokens") || ""} onChange={changeRange("minTokens", true)} /></label><label>Through<input type="number" min="0" step="1" inputmode="numeric" value={props.params.get("maxTokens") || ""} onChange={changeRange("maxTokens", true)} /></label><p>Requires recorded usage.</p></fieldset>
          <fieldset><legend>Recording records</legend><label>From<input type="number" min="0" step="1" inputmode="numeric" value={props.params.get("minRecords") || ""} onChange={changeRange("minRecords", true)} /></label><label>Through<input type="number" min="0" step="1" inputmode="numeric" value={props.params.get("maxRecords") || ""} onChange={changeRange("maxRecords", true)} /></label><p>Messages, tools, and other captured events.</p></fieldset>
        </div></details>
        <label class="checkbox-label"><input type="checkbox" checked={props.params.get("active") === "1"} onChange={event => filter({ active: event.currentTarget.checked ? "1" : null })} />Active in the last 2 minutes</label>
        <button class="text-button" onClick={clear}>Reset all filters</button><p class="search-help">Filters select whole recordings, including all their usage. Models match any recorded request; dates use last activity in UTC.</p><p class="search-help">Search: <code>"exact phrase" -exclude</code><br />Searches messages, code, and tool output.</p>
      </div></details></div>
      <Show when={chips().length}><div class="active-filters"><For each={chips()}>{([key, label]) => <button class="filter-chip" title={`Remove ${label}`} onClick={() => filter({ [key]: null, ...(key === "workspace" ? { cwd: null } : {}) })}>{label}<Icon name="close" size={12} /></button>}</For><button class="clear-filters" onClick={clear}>Clear all</button></div></Show>
    </div>
    <div class="list-caption"><span>{props.query ? "SEARCH RESULTS" : "RECORDINGS"}<span class="result-count" aria-live="polite">{props.page?.total ?? "—"}<span class="count-unit">{countUnit()}</span></span><Show when={props.pending}><span class="loading-dot" /></Show></span><select aria-label="Sort recordings" value={sort()} onChange={event => filter({ sort: event.currentTarget.value === "recent" ? null : event.currentTarget.value })}><option value="recent">Newest activity</option><option value="oldest">Oldest activity</option><option value="activity">Most records</option><option value="cost">Highest cost (est.)</option><option value="cost-asc">Lowest cost (est.)</option><option value="tokens">Most tokens</option><option value="tokens-asc">Fewest tokens</option><option value="errors">Most errors</option><option value="tools">Most tool calls</option><option value="duration">Longest recorded span</option><option value="title">Title (A–Z)</option></select></div>
    <div class="recordings-scroll" aria-busy={props.pending ? "true" : "false"} onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".session-row")];
      const index = rows.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
      if (index !== -1) { event.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, index + step))]?.focus(); }
    }}>
      <Show when={props.page} fallback={<div class="skeleton-list"><For each={[1, 2, 3, 4, 5]}>{() => <div class="skeleton-row" />}</For></div>}>
        <For each={props.page?.items || []} fallback={<div class="empty-state"><span class="empty-icon"><Icon name={!props.catalog?.sessions ? "box" : bookmarksOnly() ? "bookmark" : "search"} size={32} /></span><h2>{!props.catalog?.sessions ? (props.catalog && !props.catalog.indexedAt ? "Indexing your recordings…" : "Your next session starts the story.") : bookmarksOnly() ? "No bookmarks yet." : "No trails match this search."}</h2><p>{!props.catalog?.sessions ? (props.catalog && !props.catalog.indexedAt ? "The first index of a large history can take a few minutes. Recordings appear here as they are read." : "Use Claude Code in a project, then come back. Your recordings will appear here automatically.") : bookmarksOnly() ? "Bookmark a session from its replay to keep it here." : "Try a different phrase or give your filters a little more room."}</p><Show when={props.catalog?.sessions} fallback={<code class="empty-source">{props.catalog?.dataDir}</code>}><Show when={bookmarksOnly()} fallback={<button class="secondary-button" onClick={clear}>Clear search & filters</button>}><button class="secondary-button" onClick={() => filter({ bookmarked: null })}>Browse all sessions</button></Show></Show></div>}>
          {session => <button class={['session-row', { selected: selected() === session.id }]} data-session-id={session.id} aria-current={selected() === session.id ? "true" : undefined} onClick={() => openSession(session)}>
            <span class={['session-symbol', { 'has-error': session.errorCount > 0 }]}><Icon name={session.isAgent ? "branch" : session.hasEdits ? "edit" : "message"} size={18} /></span>
            <span class="session-main"><span class="session-title" title={session.title}><span class="session-title-text"><Highlight text={session.title} term={searchHighlight(props.query)} /></span><Show when={session.bookmarked}><Icon name="bookmark" size={13} /></Show></span><Show when={session.snippet} fallback={<span class="session-path" title={session.cwd}><Icon name="folder" size={12} /><span class="session-workspace">{session.workspace}</span><span class="meta-dot">·</span><span class="row-branch" title={session.branch || "No branch recorded"}><Icon name="branch" size={12} /><span class="session-branch-name">{session.branch || "No branch recorded"}</span></span></span>}><span class="session-snippet"><Highlight text={session.snippet!} term={searchHighlight(props.query)} /></span></Show></span>
            <span class="session-model" title={props.params.get("model") ? `Contains ${props.params.get("model")}. Latest recorded model: ${session.model || "not recorded"}.` : session.model || "Model not recorded"}><span class="model-dot" /><span class="session-model-name">{modelName(props.params.get("model") || session.model)}</span><Show when={props.params.get("model")}><small>matched</small></Show></span>
            <span class="session-activity"><span title="Messages" aria-label={`${session.messageCount} messages`}><Icon name="message" size={13} />{session.messageCount}</span><span title="Tool calls" aria-label={`${session.toolCount} tool calls`}><Icon name="terminal" size={13} />{session.toolCount}</span></span>
            <span class="session-trailing"><span class="session-time" title={dateTime(session.updatedAt)}><Show when={session.active}><span class="live-dot" /></Show>{timeAgo(session.updatedAt)}</span><Show when={sort() === "errors"}><span class="session-sort-metric">{session.errorCount} {session.errorCount === 1 ? "error" : "errors"}</span></Show><Show when={sort() === "tools"}><span class="session-sort-metric">{session.toolCount} tools</span></Show><Show when={sort() === "duration" && recordedSpan(session)}><span class="session-sort-metric">{recordedSpan(session)} span incl. pauses</span></Show><Show when={sort() === "activity"}><span class="session-sort-metric">{session.eventCount} records</span></Show><Show when={session.usage.requests}><span class="session-usage" title={`${tokenCount(session.usage.totalTokens)} tokens · ${usageCost(session.usage)} estimated USD API cost${session.usage.unpricedRequests ? ' (incomplete)' : ''}`}><span class="session-usage-tokens">{compact(session.usage.totalTokens)} tokens · </span>{usageCost(session.usage)}<span class="session-cost-label"> est.</span></span></Show></span><Icon name="chevron" size={15} class="row-chevron" />
          </button>}
        </For>
      </Show>
    </div>
    <footer class="library-footer"><span><Icon name="shield" size={13} /><Show when={props.catalog?.demo} fallback="Only on your machine">Synthetic demo recordings</Show></span><Show when={props.page && props.page.total > props.page.limit}><div class="pagination"><button class="icon-button tiny" disabled={!props.page?.offset} aria-label="Previous recordings" onClick={() => filter({ offset: String(Math.max(0, (props.page?.offset || 0) - 50)) })}><Icon name="back" size={15} /></button><span>{(props.page?.offset || 0) + 1}–{Math.min((props.page?.offset || 0) + (props.page?.limit || 0), props.page?.total || 0)}</span><button class="icon-button tiny" disabled={(props.page?.offset || 0) + (props.page?.limit || 0) >= (props.page?.total || 0)} aria-label="Next recordings" onClick={() => props.navigate({ offset: String((props.page?.offset || 0) + 50) })}><Icon name="arrow" size={15} /></button></div></Show></footer>
  </section>;
}
