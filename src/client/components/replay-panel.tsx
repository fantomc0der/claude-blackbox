import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { ContentBlock, EventPage, Session } from "../../shared/types";
import { isAbort, request } from "../lib/api";
import { dateTime, modelName, resumeCommand } from "../lib/format";
import type { Navigate } from "../lib/location";
import { Icon } from "./icon";
import { EventCard } from "./event-card";

type ReplayPage = EventPage & { results: Record<string, ContentBlock> };

export function ReplayPanel(props: { id: string; session: Session | null; revision: number; anchor: string; navigate: Navigate; changed: () => void; notify: (message: string) => void; libraryCollapsed: boolean; toggleLibrary: () => void }) {
  let scroll!: HTMLDivElement;
  const [kind, setKind] = createSignal(untrack(() => props.anchor) ? "all" : "conversation");
  const [query, setQuery] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [offset, setOffset] = createSignal(0);
  const [page, setPage] = createSignal<ReplayPage | null>(null);
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal("");
  const [updated, setUpdated] = createSignal(false);
  const [retry, setRetry] = createSignal(0);
  const [focused, setFocused] = createSignal(false);
  const [overview, setOverview] = createSignal(true);
  let atBottom = false;
  let initial = true;
  let lastKey = "";
  let jumpBottom = false;
  let requestSequence = 0;

  createEffect(() => props.anchor, value => {
    if (value) { setKind("all"); setOffset(0); }
  });

  createEffect(() => query(), value => {
    if (value === untrack(search)) return;
    const timer = setTimeout(() => { setSearch(value); setOffset(0); }, 180);
    return () => clearTimeout(timer);
  });

  createEffect(() => ({ id: props.id, kind: kind(), q: search(), offset: offset(), anchor: props.anchor, revision: props.revision, retry: retry() }), state => {
    const sequence = ++requestSequence;
    const controller = new AbortController();
    const params = new URLSearchParams({ kind: state.kind === "errors" ? "all" : state.kind, offset: String(state.offset), limit: "60" });
    if (state.kind === "errors") params.set("errors", "1");
    if (state.q) params.set("q", state.q);
    if (state.anchor && !state.q && !state.offset) params.set("anchor", state.anchor);
    const key = params.toString();
    const navigation = key !== lastKey;
    lastKey = key;
    if (navigation || initial) setPending(true);
    setError("");
    void request<ReplayPage>(`/api/sessions/${state.id}/events?${params}`, { signal: controller.signal }).then(next => {
      if (controller.signal.aborted || sequence !== requestSequence) return;
      const grew = Boolean(page() && next.total > page()!.total);
      const follow = !navigation && !initial && atBottom && (page()!.offset + page()!.limit >= page()!.total);
      const existing = new Map(page()?.items.map(event => [event.id, event]) || []);
      next.items = next.items.map(event => {
        const previous = existing.get(event.id);
        return previous && JSON.stringify(previous.raw) === JSON.stringify(event.raw) ? previous : event;
      });
      setPage(next); setPending(false);
      if (grew && !follow) setUpdated(true);
      if (follow && grew && next.offset + next.limit < next.total) { jumpBottom = true; setOffset(Math.max(0, next.total - next.limit)); }
      requestAnimationFrame(() => {
        if (sequence !== requestSequence) return;
        if (jumpBottom) { scroll?.scrollTo({ top: scroll.scrollHeight }); jumpBottom = false; }
        else if (navigation || initial) scroll?.scrollTo({ top: 0 });
        else if (follow) scroll?.scrollTo({ top: scroll.scrollHeight });
        initial = false;
      });
    }).catch(error => { if (!isAbort(error)) { setError(error.message); setPending(false); } });
    return () => controller.abort();
  });

  const toolIdsOnPage = createMemo(() => new Set(page()?.items.flatMap(event => event.blocks.filter(block => block.type === "tool_use").map(block => block.id)) || []));
  const visibleEvents = createMemo(() => (page()?.items || []).filter(event => {
    if (kind() === "all" || search() || kind() === "errors" || event.blocks.length === 0) return true;
    return !event.blocks.every(block => block.type === "tool_result" && toolIdsOnPage().has(block.tool_use_id));
  }));
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); props.notify(`${label} copied`); }
    catch { props.notify("Clipboard access failed. Use your browser’s clipboard permission setting."); }
  };
  const bookmark = async () => {
    if (!props.session) return;
    try { await request(`/api/sessions/${props.id}/bookmark`, { method: "PUT", body: JSON.stringify({ bookmarked: !props.session.bookmarked }) }); props.changed(); }
    catch (error) { props.notify(error instanceof Error ? error.message : "Could not update bookmark"); }
  };
  const changeKind = (value: string) => { setKind(value); setOffset(0); props.navigate({ event: null }, true); };
  const latest = () => {
    const target = Math.max(0, (page()?.total || 0) - 60);
    jumpBottom = true;
    const samePage = offset() === target && !props.anchor;
    setOffset(target); setUpdated(false); props.navigate({ event: null }, true);
    if (samePage) requestAnimationFrame(() => { scroll?.scrollTo({ top: scroll.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); jumpBottom = false; });
  };
  const outline = () => visibleEvents().filter(event => event.category === "message" || event.error || event.toolNames.length).slice(0, 24);
  const jumpToEvent = (id: string) => {
    scroll.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  return <section class={['replay-panel', { 'replay-focused': focused(), 'overview-hidden': !overview() }]} aria-label="Session replay">
    <header class="replay-panel-heading"><div class="replay-overline"><span><span class="live-dot" />SESSION REPLAY</span><div class="replay-layout-controls" role="group" aria-label="Replay layout">
      <button class="layout-button library-toggle" aria-expanded={props.libraryCollapsed ? "false" : "true"} aria-controls="session-library" onClick={props.toggleLibrary}>{props.libraryCollapsed ? "Show library" : "Hide library"}</button>
      <button class="layout-button reading-toggle" aria-pressed={focused() ? "true" : "false"} onClick={() => setFocused(value => !value)}>Focused reading</button>
      <button class="layout-button overview-toggle" aria-expanded={overview() ? "true" : "false"} aria-controls="recording-overview" onClick={() => setOverview(value => !value)}>{overview() ? "Hide overview" : "Show overview"}</button>
      <button class="icon-button tiny" aria-label="Close replay" title="Back to session library" onClick={() => props.navigate({ session: null, event: null })}><Icon name="close" size={18} /></button>
    </div></div>
      <Show when={props.session} fallback={<div class="skeleton-row" />}>{session => <>
        <h2>{session().title}</h2>
        <button class="source-path" title="Copy original working directory" onClick={() => void copy(session().cwd, "Source path")}><Icon name="folder" size={13} /><span>{session().cwd || "Working directory not recorded"}</span><Icon name="copy" size={12} /></button>
        <div class="replay-session-meta"><span><Icon name="branch" size={13} />{session().branch || "No branch"}</span><span class="model-label"><span class="model-dot" />{modelName(session().model)}</span><span>{session().messageCount} messages</span><span>{session().toolCount} tools</span></div>
        <div class="replay-actions"><button class="primary-button small" onClick={() => void copy(resumeCommand(session()), "Resume command")}><Icon name="terminal" size={15} />Copy resume command</button><button class={['icon-button', { bookmarked: session().bookmarked }]} aria-label={session().bookmarked ? "Remove bookmark" : "Bookmark session"} title={session().bookmarked ? "Remove bookmark" : "Bookmark session"} onClick={() => void bookmark()}><Icon name="bookmark" size={17} /></button><a class="icon-button" href={`/api/sessions/${props.id}/export`} download title="Export original JSONL records" aria-label="Export recording"><Icon name="download" size={17} /></a><details class="session-details"><summary class="text-button">Details</summary><div class="session-details-menu"><dl><dt>Session ID</dt><dd><button class="text-button mono" onClick={() => void copy(session().sessionId, "Session ID")}>{session().sessionId}</button></dd><dt>First recorded</dt><dd>{dateTime(session().startedAt)}</dd><dt>Last recorded</dt><dd>{dateTime(session().updatedAt)}</dd><dt>Original transcript</dt><dd class="mono">{session().source}</dd><dt>Source type</dt><dd>{session().isAgent ? "Subagent recording" : "Main recording"}</dd></dl><p>Read-only replay. Commands are only copied, never executed.</p></div></details></div>
      </>}</Show>
    </header>
    <div class="replay-controls">
      <div class="replay-tabs" role="group" aria-label="Replay content">
        <For each={[["conversation", "Conversation"], ["all", "All events"], ["tool", "Tools"], ["errors", "Errors"]]}>{([value, label]) =>
          <button class={['replay-tab', { active: kind() === value }]} aria-pressed={kind() === value ? "true" : "false"} onClick={() => changeKind(value)}>{label}</button>
        }</For>
      </div>
      <div class="replay-find"><Icon name="search" size={14} />
        <input aria-label="Find in this recording" placeholder="Find in this recording…" value={query()} onInput={event => setQuery(event.currentTarget.value)} />
        <Show when={query()}><button class="icon-button tiny" aria-label="Clear recording search" onClick={() => setQuery("")}><Icon name="close" size={13} /></button></Show>
        <span>{page()?.total ?? "—"} events</span>
      </div>
    </div>
    <Show when={error()}><div class="error-banner" role="alert">{error()}<button class="text-button" onClick={() => setRetry(value => value + 1)}>Retry</button></div></Show>
    <div class="replay-body"><div class="replay-scroll" ref={scroll} aria-busy={pending() ? "true" : "false"} onScroll={event => { const element = event.currentTarget; atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
      <div class="replay-timeline"><Show when={pending() && !page()} fallback={<>
        <div class="timeline-marker"><span /><Icon name="clock" size={12} />{page()?.offset ? `CONTINUED · EVENT ${page()!.offset + 1}` : "BEGINNING OF RECORDING"}<span /></div>
        <Show when={page()?.offset}><button class="load-events" onClick={() => { setOffset(Math.max(0, page()!.offset - 60)); props.navigate({ event: null }, true); }}><Icon name="back" size={14} />Previous events</button></Show>
        <For each={visibleEvents()} keyed={event => event.id} fallback={<div class="empty-state compact"><Icon name="search" size={27} /><h3>No events match.</h3><p>Choose another event type or search phrase.</p></div>}>{event => <EventCard event={event()} results={page()?.results} highlight={search()} />}</For>
        <Show when={page() && page()!.offset + page()!.limit < page()!.total} fallback={<div class="timeline-end"><span class="end-dot" />You're all caught up.<small>New activity appears here automatically.</small></div>}><button class="load-events" onClick={() => { setOffset(page()!.offset + page()!.limit); props.navigate({ event: null }, true); }}>Next {Math.min(60, page()!.total - page()!.offset - page()!.limit)} events<Icon name="arrow" size={14} /></button></Show>
      </>}><div class="skeleton-list"><For each={[1, 2, 3]}>{() => <div class="skeleton-event" />}</For></div></Show></div>
    </div><aside id="recording-overview" class="replay-inspector" aria-label="Recording overview">
      <p class="eyebrow">AT A GLANCE</p>
      <div class="inspector-stats"><div><strong>{props.session?.messageCount || 0}</strong><span>messages</span></div><div><strong>{props.session?.toolCount || 0}</strong><span>tool calls</span></div><div><strong>{props.session?.errorCount || 0}</strong><span>errors</span></div></div>
      <div class="inspector-source"><span class="eyebrow">ORIGINAL WORKSPACE</span><p>{props.session?.cwd || "Not recorded"}</p><span class="inspector-date">{dateTime(props.session?.startedAt || "")}</span></div>
      <nav class="replay-outline" aria-label="Events on this page"><p class="eyebrow">ON THIS PAGE</p><For each={outline()}>{event => <button onClick={() => jumpToEvent(event.id)} title={event.toolNames.join(", ") || event.type}><span class={['outline-dot', { error: event.error, user: event.role === "user" }]} /><span><small>{event.error ? "Error" : event.toolNames.length ? event.toolNames.join(" · ") : event.role === "user" ? "You" : "Claude"}</small>{event.blocks.find(block => block.type === "text")?.text?.replace(/<[^>]+>/g, "").slice(0, 100) || event.toolNames.join(", ") || event.type}</span></button>}</For></nav>
      <p class="inspector-note"><Icon name="shield" size={13} />An original record. Nothing rewritten.</p>
    </aside></div>
    <Show when={updated()}><button class="new-events" onClick={latest}><Icon name="down" size={15} />Recording updated · Jump to latest</button></Show>
    <footer class="replay-footer"><span><Icon name="shield" size={12} />Read-only replay</span><span>{pending() ? "Reading recording…" : `${page() ? Math.min(page()!.offset + 1, page()!.total) : 0}–${Math.min((page()?.offset || 0) + (page()?.items.length || 0), page()?.total || 0)} of ${page()?.total || 0} events`}</span><button class="text-button" onClick={latest}>Jump to latest<Icon name="down" size={12} /></button></footer>
  </section>;
}
