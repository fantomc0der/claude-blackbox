import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { ContentBlock, EventPage, ReplayEvent, Session } from "../../shared/types";
import { isAbort, request } from "../lib/api";
import { contentToText, getToolInput, isRecord, isToolResultEvent, toolPreview, truncate } from "../lib/content";
import { dismissableDetails } from "../lib/dismissable";
import { compact, dateTime, modelName, resumeCommand, tokenCount, usageCost } from "../lib/format";
import { TokenBreakdown, UsageNote } from "./usage-panel";
import { anchoredMenu } from "../lib/anchor";
import type { Navigate } from "../lib/location";
import { clearReplayFilters, replayFilters } from "../lib/replay-filters";
import { withSelectedOption } from "../lib/filter-options";
import { Icon } from "./icon";
import { EventCard } from "./event-card";

type ReplayPage = EventPage & { results: Record<string, ContentBlock> };

function outlineLabel(event: ReplayEvent): string {
  if (event.error) return "Error";
  if (event.toolNames.length) return [...new Set(event.toolNames)].join(" · ");
  if (isToolResultEvent(event)) return "Tool result";
  return event.role === "user" ? "You" : "Claude";
}

function firstValue(value: unknown): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const entries = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  for (const entry of entries) {
    const found = firstValue(entry);
    if (found) return found;
  }
  return "";
}

function outlineBody(event: ReplayEvent): string {
  const prose = (event.blocks.find(block => block.type === "text")?.text || "").replace(/<[^>]+>/g, " ").replace(/^\s*#{1,6}\s+/gm, "").replace(/\s+/g, " ").trim();
  const call = event.blocks.find(block => block.type === "tool_use");
  const result = event.blocks.find(block => block.type === "tool_result");
  const body = prose || (call ? toolPreview(call) || firstValue(getToolInput(call)) : "")
    || (result ? contentToText(result.content).replace(/\s+/g, " ").trim() : "");
  return body && body !== outlineLabel(event) ? truncate(body, 100) : event.type;
}

function SessionActions(props: { session: Session; onBookmark: () => void }) {
  return <div class="session-secondary-actions">
    <button class={['secondary-button', { bookmarked: props.session.bookmarked }]} onClick={props.onBookmark}><Icon name="bookmark" size={16} />{props.session.bookmarked ? "Remove bookmark" : "Bookmark session"}</button>
    <a class="secondary-button" href={`/api/sessions/${props.session.id}/export`} download title="Export original JSONL records"><Icon name="download" size={16} />Export recording</a>
  </div>;
}

export function ReplayPanel(props: { id: string; session: Session | null; revision: number; anchor: string; params: URLSearchParams; navigate: Navigate; changed: () => void; close: () => void; notify: (message: string) => void; libraryCollapsed: boolean; toggleLibrary: () => void; overviewVisible: boolean; toggleOverview: () => void }) {
  let scroll!: HTMLDivElement;
  const initialFilters = untrack(() => replayFilters(props.params));
  const [kind, setKind] = createSignal(untrack(() => props.anchor) ? "all" : initialFilters.kind);
  const [query, setQuery] = createSignal(initialFilters.q);
  const [search, setSearch] = createSignal(initialFilters.q);
  const [offset, setOffset] = createSignal(initialFilters.offset);
  const [tool, setTool] = createSignal(initialFilters.tool);
  const [model, setModel] = createSignal(initialFilters.model);
  const [cwd, setCwd] = createSignal(initialFilters.cwd);
  const [after, setAfter] = createSignal(initialFilters.after);
  const [before, setBefore] = createSignal(initialFilters.before);
  const [errorsOnly, setErrorsOnly] = createSignal(initialFilters.errors);
  const [page, setPage] = createSignal<ReplayPage | null>(null);
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal("");
  const [updated, setUpdated] = createSignal(false);
  const [retry, setRetry] = createSignal(0);
  const [details, setDetails] = createSignal<HTMLDetailsElement>();
  const [detailsMenu, setDetailsMenu] = createSignal<HTMLDivElement>();
  const [filterDetails, setFilterDetails] = createSignal<HTMLDetailsElement>();
  const [filterMenu, setFilterMenu] = createSignal<HTMLDivElement>();
  let atBottom = false;
  let initial = true;
  let lastKey = "";
  let jumpBottom = false;
  let requestSequence = 0;

  createEffect(() => details(), element => element && dismissableDetails(element));
  createEffect(() => ({ details: details(), menu: detailsMenu() }), elements => elements.details && elements.menu && anchoredMenu(elements.details, elements.menu));
  createEffect(() => filterDetails(), element => element && dismissableDetails(element));
  createEffect(() => ({ details: filterDetails(), menu: filterMenu() }), elements => elements.details && elements.menu && anchoredMenu(elements.details, elements.menu));

  createEffect(() => props.anchor, value => {
    if (value) { setKind("all"); setOffset(0); }
  });

  createEffect(() => props.params, params => {
    const next = replayFilters(params);
    if (next.kind !== kind()) setKind(next.kind);
    if (next.q !== query()) { setQuery(next.q); setSearch(next.q); }
    if (next.offset !== offset()) setOffset(next.offset);
    if (next.tool !== tool()) setTool(next.tool);
    if (next.model !== model()) setModel(next.model);
    if (next.cwd !== cwd()) setCwd(next.cwd);
    if (next.after !== after()) setAfter(next.after);
    if (next.before !== before()) setBefore(next.before);
    if (next.errors !== errorsOnly()) setErrorsOnly(next.errors);
  });

  createEffect(() => query(), value => {
    if (value === untrack(search)) return;
    const timer = setTimeout(() => { setSearch(value); setOffset(0); setUpdated(false); props.navigate({ replayQ: value || null, replayOffset: null, event: null, context: null }, true); }, 180);
    return () => clearTimeout(timer);
  });

  createEffect(() => ({ id: props.id, kind: kind(), q: search(), offset: offset(), tool: tool(), model: model(), cwd: cwd(), after: after(), before: before(), errors: errorsOnly(), anchor: props.anchor, context: props.params.get("context") === "1", revision: props.revision, retry: retry() }), state => {
    const sequence = ++requestSequence;
    const controller = new AbortController();
    const params = new URLSearchParams({ kind: state.kind, offset: String(state.offset), limit: "60" });
    if (state.errors) params.set("errors", "1");
    if (state.q) params.set("q", state.q);
    if (state.tool) params.set("tool", state.tool);
    if (state.model) params.set("model", state.model);
    if (state.cwd) params.set("cwd", state.cwd);
    if (state.after) params.set("after", state.after);
    if (state.before) params.set("before", state.before);
    if (state.anchor && !state.offset) { params.set("anchor", state.anchor); if (state.context) params.set("context", "1"); }
    const key = params.toString();
    const navigation = key !== lastKey;
    lastKey = key;
    if (navigation || initial) setPending(true);
    setError("");
    void request<ReplayPage>(`/api/sessions/${state.id}/events?${params}`, { signal: controller.signal }).then(next => {
      if (controller.signal.aborted || sequence !== requestSequence) return;
      next.unfilteredTotal ??= next.total;
      next.facets ??= { tools: [], models: [], directories: [], limited: false };
      const previousPage = page();
      const grew = !navigation && !initial && Boolean(previousPage) && next.unfilteredTotal > previousPage!.unfilteredTotal;
      const narrowed = Boolean(state.q || state.tool || state.model || state.cwd || state.after || state.before || state.errors || !["conversation", "all"].includes(state.kind));
      const follow = !navigation && !initial && !narrowed && atBottom && Boolean(previousPage) && (previousPage!.offset + previousPage!.limit >= previousPage!.total);
      const existing = new Map(page()?.items.map(event => [event.id, event]) || []);
      next.items = next.items.map(event => {
        const previous = existing.get(event.id);
        return previous && JSON.stringify(previous.raw) === JSON.stringify(event.raw) ? previous : event;
      });
      setPage(next); setPending(false);
      if (grew && !follow) setUpdated(true);
      if (follow && grew && next.offset + next.limit < next.total) {
        jumpBottom = true;
        const nextOffset = Math.max(0, next.total - next.limit);
        setOffset(nextOffset);
        props.navigate({ replayOffset: String(nextOffset), event: null, context: null }, true);
      }
      requestAnimationFrame(() => {
        if (sequence !== requestSequence) return;
        if (jumpBottom) { scroll?.scrollTo({ top: scroll.scrollHeight }); jumpBottom = false; }
        else if (navigation || initial) scroll?.scrollTo({ top: 0 });
        else if (follow) scroll?.scrollTo({ top: scroll.scrollHeight });
        if (state.anchor && (navigation || initial)) scroll?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(state.anchor)}"]`)?.scrollIntoView({ block: "center" });
        initial = false;
      });
    }).catch(error => { if (!isAbort(error)) { setError(error.message); setPending(false); } });
    return () => controller.abort();
  });

  const toolIdsOnPage = createMemo(() => new Set(page()?.items.flatMap(event => event.blocks.filter(block => block.type === "tool_use").map(block => block.id)) || []));
  const visibleEvents = createMemo(() => (page()?.items || []).filter(event => {
    if (kind() !== "conversation" || search() || errorsOnly() || event.blocks.length === 0) return true;
    return !event.blocks.every(block => block.type === "tool_result" && toolIdsOnPage().has(block.tool_use_id));
  }));
  const countLabel = () => {
    const total = page()?.total;
    if (total === undefined) return "— records";
    const shown = visibleEvents().length;
    const scope = total === page()?.unfilteredTotal ? compact(total) : `${compact(total)}/${compact(page()!.unfilteredTotal)}`;
    return shown === total ? `${scope} records` : `${compact(shown)} shown · ${scope} records`;
  };
  const workspaceChanges = createMemo(() => {
    const changed = new Set<string>();
    let directory = "";
    for (const event of visibleEvents()) {
      if (event.cwd && event.cwd !== directory) {
        changed.add(event.id);
        directory = event.cwd;
      }
    }
    return changed;
  });
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); props.notify(`${label} copied`); }
    catch { props.notify("Clipboard access failed. Use your browser’s clipboard permission setting."); }
  };
  const bookmark = async () => {
    if (!props.session) return;
    try { await request(`/api/sessions/${props.id}/bookmark`, { method: "PUT", body: JSON.stringify({ bookmarked: !props.session.bookmarked }) }); props.changed(); }
    catch (error) { props.notify(error instanceof Error ? error.message : "Could not update bookmark"); }
  };
  const updateReplay = (values: Record<string, string | null>, replace = false) => {
    setUpdated(false);
    props.navigate({ ...values, replayOffset: values.replayOffset === undefined ? null : values.replayOffset, event: values.event === undefined ? null : values.event, context: values.context === undefined ? null : values.context }, replace);
  };
  const changeKind = (value: string) => {
    setKind(value); setOffset(0);
    updateReplay({ replayKind: value, replayErrors: null });
  };
  const changeErrors = (checked: boolean) => {
    setErrorsOnly(checked); setOffset(0);
    updateReplay({ replayKind: kind(), replayErrors: checked ? "1" : null });
  };
  const showErrors = () => {
    setKind("all"); setErrorsOnly(true); setOffset(0);
    updateReplay({ replayKind: "all", replayErrors: "1" });
  };
  const changeFilter = (key: "replayTool" | "replayModel" | "replayCwd", value: string) => {
    setOffset(0);
    updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null, [key]: value || null });
  };
  const changeDate = (key: "replayAfter" | "replayBefore", value: string) => {
    const other = key === "replayAfter" ? before() : after();
    const resetOther = value && other && (key === "replayAfter" ? value > other : value < other);
    setOffset(0);
    updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null, [key]: value || null, [key === "replayAfter" ? "replayBefore" : "replayAfter"]: resetOther ? null : other || null });
  };
  const resetReplay = () => { setQuery(""); setSearch(""); setKind("all"); setErrorsOnly(false); setOffset(0); updateReplay(clearReplayFilters({ replayKind: "all" })); };
  const revealContext = (id: string) => { setQuery(""); setSearch(""); setKind("all"); setErrorsOnly(false); setOffset(0); updateReplay(clearReplayFilters({ replayKind: "all", event: id, context: "1" })); };
  const isFiltered = () => kind() !== "all" || errorsOnly() || Boolean(search() || tool() || model() || cwd() || after() || before());
  const extraFilterCount = () => [!["conversation", "all"].includes(kind()), errorsOnly(), search(), tool(), model(), cwd(), after(), before()].filter(Boolean).length;
  const timelineLabel = () => {
    const first = page()?.items[0];
    if (page()?.offset) return `CONTINUED · EVENT ${page()!.offset + 1}`;
    if (extraFilterCount() > 0 && first && first.sequence > 0) return `FIRST MATCH · EVENT ${first.sequence + 1}`;
    return "BEGINNING OF RECORDING";
  };
  const latest = () => {
    const target = Math.max(0, (page()?.total || 0) - 60);
    jumpBottom = true;
    const samePage = offset() === target && !props.anchor;
    setOffset(target); setUpdated(false); updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null, replayOffset: target ? String(target) : null });
    if (samePage) requestAnimationFrame(() => { scroll?.scrollTo({ top: scroll.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); jumpBottom = false; });
  };
  const latestUnfiltered = () => {
    const target = Math.max(0, (page()?.unfilteredTotal || 0) - 60);
    const samePage = !isFiltered() && offset() === target && !props.anchor;
    setQuery(""); setSearch(""); setKind("all"); setErrorsOnly(false); setOffset(target);
    jumpBottom = true;
    updateReplay(clearReplayFilters({ replayKind: "all", replayOffset: target ? String(target) : null }));
    if (samePage) requestAnimationFrame(() => { scroll?.scrollTo({ top: scroll.scrollHeight }); jumpBottom = false; });
  };
  const outline = () => visibleEvents().filter(event => event.category === "message" || event.error || event.toolNames.length).slice(0, 24);
  const jumpToEvent = (id: string) => {
    scroll.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  return <section class={['replay-panel', { 'overview-hidden': !props.overviewVisible }]} aria-label="Session replay">
    <header class="replay-panel-heading">
      <div class="replay-title-row">
        <div class="replay-heading-content"><Show when={props.session} fallback={<div class="skeleton-row" />}>{session => <><h2 title={session().title}>{session().title}</h2><div class="replay-usage" aria-label="Session usage"><Show when={session().usage.requests} fallback="No token usage recorded"><span title={tokenCount(session().usage.totalTokens)}>{compact(session().usage.totalTokens)} tokens</span><span>{usageCost(session().usage)} estimated API cost</span><Show when={session().usage.unpricedRequests}><span class="usage-warning">Incomplete pricing</span></Show></Show></div></>}</Show></div>
        <button class="icon-button replay-close" aria-label="Close replay" title="Back to session library" onClick={props.close}><Icon name="close" size={18} /></button>
      </div>
      <div class="replay-actions">
        <Show when={props.session}>{session => <>
          <button class="secondary-button resume-command" onClick={() => void copy(resumeCommand(session()), "Resume command")}><Icon name="terminal" size={15} />Copy resume command</button>
          <SessionActions session={session()} onBookmark={() => void bookmark()} />
          <details class="session-details" ref={setDetails}>
            <summary class="text-button"><span class="session-actions-label">Session actions</span><span class="session-details-label">Session details</span><Icon name="down" size={14} /></summary>
            <div class="session-details-menu" ref={setDetailsMenu} role="region" aria-label="Session details">
              <SessionActions session={session()} onBookmark={() => void bookmark()} />
              <h3>Session details</h3>
              <dl>
                <dt>Title</dt><dd>{session().title}</dd>
                <dt>Original workspace</dt><dd><button class="source-path" title="Copy original working directory" onClick={() => void copy(session().cwd, "Source path")}><Icon name="folder" size={13} /><span>{session().cwd || "Working directory not recorded"}</span><Icon name="copy" size={12} /></button></dd>
                <dt>Branch</dt><dd>{session().branch || "No branch"}</dd>
                <dt>Model</dt><dd>{modelName(session().model)}</dd>
                <dt>Activity</dt><dd>{session().messageCount} messages · {session().toolCount} tools</dd>
                <dt>Est. API cost</dt><dd>{usageCost(session().usage)}</dd>
                <dt>Total tokens</dt><dd>{session().usage.requests ? tokenCount(session().usage.totalTokens) : "Not recorded"}</dd>
                <dt>Session ID</dt><dd><button class="text-button mono" onClick={() => void copy(session().sessionId, "Session ID")}>{session().sessionId}</button></dd>
                <dt>First recorded</dt><dd>{dateTime(session().startedAt)}</dd>
                <dt>Last recorded</dt><dd>{dateTime(session().updatedAt)}</dd>
                <dt>Original transcript</dt><dd class="mono">{session().source}</dd>
                <dt>Source type</dt><dd>{session().isAgent ? "Subagent recording" : "Main recording"}</dd>
              </dl>
              <Show when={session().usage.requests}><TokenBreakdown usage={session().usage} /><UsageNote usage={session().usage} /></Show>
              <p>Read-only replay. Commands are only copied, never executed.</p>
            </div>
          </details>
        </>}</Show>
        <div class="replay-layout-controls" role="group" aria-label="Replay layout">
          <button class="layout-button library-toggle" aria-expanded={props.libraryCollapsed ? "false" : "true"} aria-controls="session-library" onClick={props.toggleLibrary}>{props.libraryCollapsed ? "Show library" : "Hide library"}</button>
          <button class="layout-button overview-toggle" aria-expanded={props.overviewVisible ? "true" : "false"} aria-controls="recording-overview" onClick={props.toggleOverview}>{props.overviewVisible ? "Hide overview" : "Show overview"}</button>
        </div>
      </div>
    </header>
    <div class="replay-controls">
      <div class="replay-tabs" role="group" aria-label="Replay content">
        <For each={[["conversation", "Conversation"], ["all", "All events"], ["tool", "Tools"], ["errors", "Errors"]]}>{([value, label]) =>
          <button class={['replay-tab', { active: value === "errors" ? errorsOnly() : kind() === value && !errorsOnly() }]} aria-pressed={(value === "errors" ? errorsOnly() : kind() === value && !errorsOnly()) ? "true" : "false"} onClick={() => value === "errors" ? showErrors() : changeKind(value)}>{label}</button>
        }</For>
      </div>
      <div class="replay-find"><Icon name="search" size={14} />
        <input aria-label="Find in this recording" placeholder="Find in this recording…" value={query()} onInput={event => setQuery(event.currentTarget.value)} />
        <Show when={query()}><button class="icon-button tiny" aria-label="Clear recording search" onClick={() => setQuery("")}><Icon name="close" size={13} /></button></Show>
        <span class="replay-count" role="status" title={page() ? `${visibleEvents().length} visible cards; ${page()!.total} matching of ${page()!.unfilteredTotal} recorded events` : undefined} aria-label={page() ? `${visibleEvents().length} visible cards; ${page()!.total} matching of ${page()!.unfilteredTotal} recorded events` : "Loading recording"}>{countLabel()}</span>
      </div>
      <details class="replay-filters" ref={setFilterDetails}><summary title="Filter this recording"><Icon name="sliders" size={14} />Filters<Show when={extraFilterCount()}><span class="filter-count">{extraFilterCount()}</span></Show></summary><div class="replay-filter-menu" ref={setFilterMenu} role="region" aria-label="Replay filters"><div class="replay-filter-menu-heading"><h3>Replay filters</h3><button class="icon-button tiny replay-filter-menu-close" aria-label="Close replay filters" onClick={() => { const element = filterDetails(); if (!element) return; element.open = false; element.querySelector<HTMLElement>("summary")?.focus(); }}><Icon name="close" size={15} /></button></div><p class="search-help">{page() ? `${page()!.total} matching of ${page()!.unfilteredTotal} recorded events.` : "Loading recording…"} Filters combine; records stay in their original order.</p>
        <Show when={page()?.facets.limited}><p class="search-help">Up to 200 values per filter are shown. Search still covers all recorded content.</p></Show>
        <label for="replay-focused-view">Focused replay view<select id="replay-focused-view" aria-label="Focused replay view" value={kind()} onChange={event => changeKind(event.currentTarget.value)}><For each={[["conversation", "Conversation"], ["all", "All events"], ["tool", "Tools"], ["prompts", "Prompts"], ["responses", "Responses"], ["edits", "Edits"], ["thinking", "Thinking"], ["system", "System"]]}>{([value, label]) => <option value={value}>{label}</option>}</For></select></label>
        <label for="replay-tool">Observed tool<select id="replay-tool" aria-label="Observed tool" value={tool()} onChange={event => changeFilter("replayTool", event.currentTarget.value)}><option value="">Any tool</option><For each={withSelectedOption(page()?.facets.tools || [], tool())}>{value => <option value={value}>{value}</option>}</For></select></label>
        <label for="replay-model">Recorded model<select id="replay-model" aria-label="Recorded model" value={model()} onChange={event => changeFilter("replayModel", event.currentTarget.value)}><option value="">Any model</option><For each={withSelectedOption(page()?.facets.models || [], model())}>{value => <option value={value}>{value}</option>}</For></select></label>
        <label for="replay-cwd">Working directory<select id="replay-cwd" aria-label="Working directory" value={cwd()} onChange={event => changeFilter("replayCwd", event.currentTarget.value)}><option value="">Any directory</option><For each={withSelectedOption(page()?.facets.directories || [], cwd())}>{value => <option value={value}>{value}</option>}</For></select></label>
        <label class="replay-errors"><input aria-label="Only errors" type="checkbox" checked={errorsOnly()} onChange={event => changeErrors(event.currentTarget.checked)} />Only errors</label>
        <div class="replay-date-range"><label for="replay-after">After UTC<input id="replay-after" aria-label="After UTC" type="date" value={after()} onChange={event => changeDate("replayAfter", event.currentTarget.value)} /></label><label for="replay-before">Before UTC<input id="replay-before" aria-label="Before UTC" type="date" value={before()} onChange={event => changeDate("replayBefore", event.currentTarget.value)} /></label></div>
        <button class="text-button" onClick={resetReplay}>Reset replay filters</button>
      </div></details>
    </div>
    <Show when={error()}><div class="error-banner" role="alert">{error()}<button class="text-button" onClick={() => setRetry(value => value + 1)}>Retry</button></div></Show>
    <div class="replay-body"><div class="replay-scroll" ref={scroll} aria-busy={pending() ? "true" : "false"} onScroll={event => { const element = event.currentTarget; atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
      <div class="replay-timeline"><Show when={pending() && !page()} fallback={<>
        <div class="timeline-marker"><span /><Icon name="clock" size={12} />{timelineLabel()}<span /></div>
        <Show when={page()?.offset}><button class="load-events" onClick={() => { const previous = Math.max(0, page()!.offset - 60); setOffset(previous); updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null, replayOffset: previous ? String(previous) : null }); }}><Icon name="back" size={14} />Previous events</button></Show>
        <For each={visibleEvents()} keyed={event => event.id} fallback={<div class="empty-state compact"><Icon name="search" size={27} /><h3>No events match these filters.</h3><p>Reset filters to return to the full chronological recording.</p><button class="secondary-button" onClick={resetReplay}>Reset replay filters</button></div>}>{event => <EventCard event={event()} results={page()?.results} highlight={search()} showWorkspace={workspaceChanges().has(event().id)} sessionId={props.id} filtered={isFiltered()} selected={event().id === props.anchor} onShowContext={revealContext} />}</For>
        <Show when={page() && page()!.offset + page()!.limit < page()!.total} fallback={<div class="timeline-end"><span class="end-dot" />{extraFilterCount() ? "End of matching records." : "You're all caught up."}<small>{extraFilterCount() ? "Reset filters for the full chronology." : "New activity appears here automatically."}</small></div>}><button class="load-events" onClick={() => { const next = page()!.offset + page()!.limit; setOffset(next); updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null, replayOffset: String(next) }); }}>Next {Math.min(60, page()!.total - page()!.offset - page()!.limit)} events<Icon name="arrow" size={14} /></button></Show>
      </>}><div class="skeleton-list"><For each={[1, 2, 3]}>{() => <div class="skeleton-event" />}</For></div></Show></div>
    </div><aside id="recording-overview" class="replay-inspector" aria-label="Recording overview">
      <p class="eyebrow">AT A GLANCE</p>
      <div class="inspector-stats"><div><strong>{props.session?.messageCount || 0}</strong><span>messages</span></div><div><strong>{props.session?.toolCount || 0}</strong><span>tool calls</span></div><div><strong>{props.session?.errorCount || 0}</strong><span>errors</span></div></div>
      <div class="inspector-source"><span class="eyebrow">ORIGINAL WORKSPACE</span><p>{props.session?.cwd || "Not recorded"}</p><span class="inspector-date">{dateTime(props.session?.startedAt || "")}</span></div>
      <nav class="replay-outline" aria-label="Events on this page"><p class="eyebrow">ON THIS PAGE</p><For each={outline()}>{event => <button onClick={() => jumpToEvent(event.id)} title={event.toolNames.join(", ") || event.type}><span class={['outline-dot', { error: event.error, user: event.role === "user" && !isToolResultEvent(event) }]} /><span><small>{outlineLabel(event)}</small>{outlineBody(event)}</span></button>}</For></nav>
      <p class="inspector-note"><Icon name="shield" size={13} />An original record. Nothing rewritten.</p>
    </aside></div>
    <Show when={updated()}><button class="new-events" onClick={latestUnfiltered}><Icon name="down" size={15} />Recording updated · Show latest unfiltered</button></Show>
    <footer class="replay-footer"><span><Icon name="shield" size={12} />Read-only replay</span><span>{pending() ? "Reading recording…" : `${page() ? Math.min(page()!.offset + 1, page()!.total) : 0}–${Math.min((page()?.offset || 0) + (page()?.items.length || 0), page()?.total || 0)} of ${page()?.total || 0} records`}</span><div><button class="text-button" onClick={() => { setOffset(0); updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null }); }}>Beginning</button><button class="text-button" aria-label="Jump to latest" onClick={latest}><span class="replay-jump-full">Jump to latest</span><span class="replay-jump-short" aria-hidden="true">Latest</span><Icon name="down" size={12} /></button></div></footer>
  </section>;
}
