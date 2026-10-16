import { createEffect, createMemo, createSignal, flush, For, Show, untrack } from "solid-js";
import type { ContentBlock, EventPage, FindMatches, ReplayEvent, Session, SessionFamily } from "../../shared/types";
import { stripAnsi } from "../../shared/ansi";
import { isAbort, request } from "../lib/api";
import { contentToText, getToolInput, isRecord, isToolResultEvent, toolPreview, truncate } from "../lib/content";
import { dismissableDetails } from "../lib/dismissable";
import { compact, dateTime, folderName, modelName, recordedRange, resumeCommand, searchHighlight, tokenCount, usageCost, withLocalDays } from "../lib/format";
import { TokenBreakdown, UsageNote } from "./usage-panel";
import { anchoredMenu } from "../lib/anchor";
import type { Navigate } from "../lib/location";
import { clearReplayFilters, replayFilters } from "../lib/replay-filters";
import { withSelectedOption } from "../lib/filter-options";
import { Icon } from "./icon";
import { EventCard, type SubagentNavigation } from "./event-card";
import { SubagentDialog } from "./subagent-dialog";
import { SessionFamilyNavigation } from "./session-family";
import { ReplayTimeline } from "./replay-timeline";
import { isPlainNavigation, recalledReplayPosition, rememberReplayPosition, replayPositionKey, sessionDestination, sessionHref } from "../lib/session-navigation";

type ReplayPage = EventPage & { results: Record<string, ContentBlock>; calls: Record<string, ContentBlock> };

const pageSize = 60;

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
  const body = stripAnsi(prose || (call ? toolPreview(call) || firstValue(getToolInput(call)) : "")
    || (result ? contentToText(result.content).replace(/\s+/g, " ").trim() : "")).trim();
  return body && body !== outlineLabel(event) ? truncate(body, 100) : event.type;
}

function SessionActions(props: { session: Session }) {
  return <div class="session-secondary-actions">
    <a class="secondary-button" href={`/api/sessions/${props.session.id}/export`} download title="Export original JSONL records"><Icon name="download" size={16} />Export recording</a>
  </div>;
}

const ProvenanceSeparator = () => <span class="meta-dot" aria-hidden="true">·</span>;

// Where and when the recording happened, on one line under the title at every pane width. Values truncate in place
// (the folder first) and narrow panes drop the times and the model; the Session details menu keeps the full values.
function Provenance(props: { session: Session }) {
  return <p class="replay-provenance">
    <span class="provenance-folder" title={props.session.cwd || "Working directory not recorded"}><Icon name="folder" size={12} /><span class="visually-hidden">Folder </span><span class="provenance-value">{props.session.cwd ? folderName(props.session.cwd) : "Folder not recorded"}</span></span><ProvenanceSeparator />
    <span class="provenance-branch" title={props.session.branch || "No branch recorded"}><Icon name="branch" size={12} /><span class="visually-hidden">Branch </span><span class="provenance-value">{props.session.branch || "No branch"}</span></span><ProvenanceSeparator />
    <span class="provenance-dates" title={`First recorded ${dateTime(props.session.startedAt)}. Last recorded ${dateTime(props.session.updatedAt)}.`}><span class="visually-hidden">Recorded </span><span class="provenance-value provenance-times">{recordedRange(props.session.startedAt, props.session.updatedAt)}</span><span class="provenance-value provenance-days">{recordedRange(props.session.startedAt, props.session.updatedAt, { days: true })}</span></span><ProvenanceSeparator />
    <span class="provenance-model" title={props.session.model || "Model not recorded"}><span class="visually-hidden">Model </span><span class="provenance-value">{modelName(props.session.model)}</span></span>
  </p>;
}

export function ReplayPanel(props: { id: string; session: Session | null; revision: number; anchor: string; params: URLSearchParams; navigate: Navigate; traversal: () => boolean; changed: () => void; close: () => void; notify: (message: string) => void; libraryCollapsed: boolean; toggleLibrary: () => void; overviewVisible: boolean; toggleOverview: () => void }) {
  let scroll!: HTMLDivElement;
  const initialFilters = untrack(() => replayFilters(props.params));
  const [kind, setKind] = createSignal(initialFilters.kind);
  const [query, setQuery] = createSignal(initialFilters.q);
  const [search, setSearch] = createSignal(initialFilters.q);
  const [only, setOnly] = createSignal(initialFilters.only);
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
  const [family, setFamily] = createSignal<SessionFamily | null>(null);
  const [familyPending, setFamilyPending] = createSignal(true);
  const [familyError, setFamilyError] = createSignal("");
  const [familyRetry, setFamilyRetry] = createSignal(0);
  const [previewId, setPreviewId] = createSignal("");
  const [restoreScroll, setRestoreScroll] = createSignal<(() => void) | null>(null);
  const familyRoot = () => family()?.members.find(member => member.session.id === family()?.rootId)?.session || null;
  const sessionTitle = () => (props.session?.isAgent ? family()?.members.find(member => member.session.id === props.id)?.label : null) || props.session?.title || "";
  const resumeTarget = () => props.session?.isAgent ? familyRoot() : props.session;
  let positionKey = untrack(() => replayPositionKey(props.id, props.params));
  const href = (id: string, event: string | null = null) => sessionHref(props.params, id, event);
  const openSession = (id: string, event: string | null = null) => {
    rememberReplayPosition(positionKey, scroll?.scrollTop || 0);
    setPreviewId("");
    props.navigate(sessionDestination(id, event));
  };
  const followSession = (event: MouseEvent, id: string, anchor: string | null = null) => {
    if (!isPlainNavigation(event)) return;
    event.preventDefault();
    openSession(id, anchor);
  };
  const subagentNavigation = createMemo<SubagentNavigation>(() => {
    const members = new Map(family()?.members.map(member => [member.session.id, member]) || []);
    const targets = Object.fromEntries(Object.entries(family()?.launches || {}).flatMap(([toolId, id]) => {
      const member = members.get(id);
      return member ? [[toolId, { id, label: member.label }]] : [];
    }));
    return { targets, pending: familyPending(), failed: Boolean(familyError()), href, follow: followSession, preview: setPreviewId };
  });
  createEffect(() => ({ id: props.id, revision: props.revision, retry: familyRetry() }), state => {
    const controller = new AbortController();
    setFamilyPending(true); setFamilyError("");
    void request<SessionFamily>(`/api/sessions/${state.id}/family`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setFamily(data); })
      .catch(error => { if (!controller.signal.aborted && !isAbort(error)) { setFamily(null); setFamilyError(error.message); } })
      .finally(() => { if (!controller.signal.aborted) setFamilyPending(false); });
    return () => controller.abort();
  });
  createEffect(() => ({ restore: restoreScroll(), ready: !familyPending() && props.session?.id === props.id }), state => {
    if (!state.restore || !state.ready) return;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => state.restore?.()); });
    return () => cancelAnimationFrame(frame);
  });
  const [details, setDetails] = createSignal<HTMLDetailsElement>();
  const [detailsMenu, setDetailsMenu] = createSignal<HTMLDivElement>();
  const [filterDetails, setFilterDetails] = createSignal<HTMLDetailsElement>();
  const [filterMenu, setFilterMenu] = createSignal<HTMLDivElement>();
  let initial = true;
  let lastKey = "";
  let jumpBottom = false;
  let following = false;
  let requestSequence = 0;
  // The record the reader chose on the timeline, revealed when a page holding it arrives. Matched on arrival rather
  // than per request, because clearing an anchor re-runs the request that the seek started.
  let seekTarget: number | null = null;
  let announceRange = false;
  const [announcement, setAnnouncement] = createSignal("");
  // The find term always highlights and can be stepped through; it narrows the records only while the reader asks for
  // matching records alone.
  const narrowTerm = () => only() ? search() : "";
  const filterQuery = createMemo(() => {
    const params = new URLSearchParams({ kind: kind() });
    if (errorsOnly()) params.set("errors", "1");
    for (const [key, value] of [["q", narrowTerm()], ["tool", tool()], ["model", model()], ["cwd", cwd()], ["after", after()], ["before", before()]]) if (value) params.set(key!, value!);
    return withLocalDays(params.toString());
  });
  // Measured when needed rather than cached from scroll events: expanding a card at the end of the page moves the
  // reader away from the end without any scroll event, and a cached flag would then snap them back on the next refresh.
  const nearEnd = () => Boolean(scroll) && scroll.scrollHeight > scroll.clientHeight && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
  // Marks the replay's own find term, or else the term a library search matched. The library query only highlights:
  // its phrase-per-term semantics differ from the replay's substring find, so it never narrows the records shown.
  const highlight = () => search() || searchHighlight(props.params.get("q") || "");

  createEffect(() => details(), element => element && dismissableDetails(element));
  createEffect(() => ({ details: details(), menu: detailsMenu() }), elements => elements.details && elements.menu && anchoredMenu(elements.details, elements.menu));
  createEffect(() => filterDetails(), element => element && dismissableDetails(element));
  createEffect(() => ({ details: filterDetails(), menu: filterMenu() }), elements => elements.details && elements.menu && anchoredMenu(elements.details, elements.menu));

  createEffect(() => props.anchor, value => {
    if (value) { setKind(replayFilters(untrack(() => props.params)).kind); setOffset(0); }
  });

  createEffect(() => props.params, params => {
    const next = replayFilters(params);
    if (next.kind !== kind()) setKind(next.kind);
    if (next.q !== query()) { setQuery(next.q); setSearch(next.q); }
    if (next.only !== only()) setOnly(next.only);
    if (next.offset !== offset()) setOffset(next.offset);
    if (next.tool !== tool()) setTool(next.tool);
    if (next.model !== model()) setModel(next.model);
    if (next.cwd !== cwd()) setCwd(next.cwd);
    if (next.after !== after()) setAfter(next.after);
    if (next.before !== before()) setBefore(next.before);
    if (next.errors !== errorsOnly()) setErrorsOnly(next.errors);
  });

  // Narrowing replaces the records, so it starts them over; a highlight alone leaves the reader on their page.
  const commitQuery = (value: string) => {
    if (value === untrack(search)) return;
    setSearch(value); setUpdated(false);
    if (untrack(only)) { setOffset(0); props.navigate({ replayQ: value || null, replayOffset: null, event: null, context: null }, true); }
    else props.navigate({ replayQ: value || null }, true);
  };
  createEffect(() => query(), value => {
    if (value === untrack(search)) return;
    const timer = setTimeout(() => commitQuery(value), 180);
    return () => clearTimeout(timer);
  });

  // Every record the find term matches under the other filters, so stepping can reach matches on pages not loaded yet.
  // The key ties the list to the term and filters it was fetched for; a live refresh keeps showing the previous list.
  const matchKey = () => search() ? `${filterQuery()}\n${search()}` : "";
  const [matchState, setMatchState] = createSignal<{ key: string; data: FindMatches } | null>(null);
  const matches = createMemo(() => { const state = matchState(); return state && state.key === matchKey() ? state.data : null; });
  const [currentMatch, setCurrentMatch] = createSignal("");
  const matchIndex = createMemo(() => currentMatch() ? matches()?.items.findIndex(item => item.id === currentMatch()) ?? -1 : -1);
  // A step requested before its term's matches arrived, taken as soon as they do.
  let pendingStep: -1 | 0 | 1 = 0;
  // The match a step moved to on another page, revealed once that page is on screen.
  let pendingMatch = "";
  let findInput!: HTMLInputElement;
  // The key whose list could not be fetched. Highlighting does not depend on the list, so only stepping waits on a retry,
  // which the next step or term change makes.
  const [matchFailure, setMatchFailure] = createSignal("");
  const [matchRetry, setMatchRetry] = createSignal(0);
  const matchesFailed = () => Boolean(matchKey()) && matchFailure() === matchKey() && !matches();
  createEffect(() => ({ id: props.id, key: matchKey(), filters: filterQuery(), find: search(), revision: props.revision, retry: matchRetry() }), state => {
    if (!state.key) { pendingStep = 0; return; }
    const controller = new AbortController();
    const params = new URLSearchParams(state.filters);
    params.set("find", state.find);
    void request<FindMatches>(`/api/sessions/${state.id}/matches?${params}`, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setMatchState({ key: state.key, data });
      setMatchFailure("");
      // Writes settle on the next flush, so apply this one before the step reads the list.
      if (pendingStep) { const direction = pendingStep; pendingStep = 0; flush(); step(direction); }
    }).catch(error => {
      if (isAbort(error) || untrack(matchState)?.key === state.key) return;
      setMatchState(null); setMatchFailure(state.key);
      pendingStep = 0;
    });
    return () => controller.abort();
  });

  createEffect(() => ({ id: props.id, kind: kind(), q: narrowTerm(), offset: offset(), tool: tool(), model: model(), cwd: cwd(), after: after(), before: before(), errors: errorsOnly(), anchor: props.anchor, context: props.params.get("context") === "1", revision: props.revision, retry: retry() }), state => {
    const sequence = ++requestSequence;
    const controller = new AbortController();
    const params = new URLSearchParams(filterQuery());
    params.set("offset", String(state.offset)); params.set("limit", String(pageSize));
    if (state.anchor && !state.offset) { params.set("anchor", state.anchor); if (state.context) params.set("context", "1"); }
    const key = params.toString();
    const navigation = key !== lastKey;
    const nextPositionKey = replayPositionKey(state.id, untrack(() => props.params));
    // A remembered reading position is only restored when browser history brings the reader back; a fresh navigation
    // to a recording starts at the beginning (or at its anchored event).
    const savedPosition = (navigation || initial) && untrack(() => props.traversal()) ? recalledReplayPosition(nextPositionKey) : undefined;
    if (navigation && !jumpBottom) following = false;
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
      // Whether the reader was at the end of the recording's last page before this refresh rendered anything new.
      const atEnd = !navigation && !initial && !narrowed && Boolean(previousPage) && (previousPage!.offset + previousPage!.limit >= previousPage!.total) && nearEnd();
      const overflow = next.offset + next.limit < next.total;
      const existing = new Map(page()?.items.map(event => [event.id, event]) || []);
      next.items = next.items.map(event => {
        const previous = existing.get(event.id);
        return previous && JSON.stringify(previous.raw) === JSON.stringify(event.raw) ? previous : event;
      });
      setPage(next); setPending(false);
      const target = seekTarget !== null && seekTarget >= next.offset && seekTarget < next.offset + next.items.length ? seekTarget : null;
      if (target !== null) seekTarget = null;
      if (announceRange && navigation) { announceRange = false; setAnnouncement(`Records ${Math.min(next.offset + 1, next.total)} to ${next.offset + next.items.length} of ${next.total}`); }
      let keepAtEnd = false;
      if (grew && atEnd && overflow && following) {
        // Jump to latest was requested earlier and the reader stayed at the end, so keep showing the newest records.
        jumpBottom = true;
        const nextOffset = Math.max(0, next.total - next.limit);
        setOffset(nextOffset);
        props.navigate({ replayOffset: String(nextOffset), event: null, context: null }, true);
      } else if (grew && atEnd && !overflow) keepAtEnd = true;
      else if (grew) { setUpdated(true); following = false; }
      setRestoreScroll(() => () => {
        if (sequence !== requestSequence) return;
        positionKey = nextPositionKey;
        if (jumpBottom) { scroll?.scrollTo({ top: scroll.scrollHeight }); jumpBottom = false; }
        else if (target !== null) {
          const card = pendingMatch && cardOf(pendingMatch);
          pendingMatch = "";
          if (card) revealAnchor(card); else revealPosition(next, target);
        }
        else if (navigation || initial) scroll?.scrollTo({ top: savedPosition ?? 0 });
        else if (keepAtEnd) scroll?.scrollTo({ top: scroll.scrollHeight });
        if (state.anchor && savedPosition === undefined && (navigation || initial)) revealAnchor(state.anchor);
        initial = false;
        setRestoreScroll(null);
      });
    }).catch(error => { if (!isAbort(error)) { setError(error.message); setPending(false); } });
    return () => controller.abort();
  });

  const toolIdsOnPage = createMemo(() => new Set(page()?.items.flatMap(event => event.blocks.filter(block => block.type === "tool_use").map(block => block.id)) || []));
  // Conversation and Tools fold a tool result into its call's card when both are on the page, so each tool reads once.
  const visibleEvents = createMemo(() => (page()?.items || []).filter(event => {
    if (!["conversation", "tool"].includes(kind()) || narrowTerm() || errorsOnly() || event.blocks.length === 0) return true;
    return !event.blocks.every(block => block.type === "tool_result" && toolIdsOnPage().has(block.tool_use_id));
  }));
  // One count, in the same records as the footer's range; a folded result is still a record, shown inside its call.
  const countLabel = () => {
    const current = page();
    if (!current) return "— records";
    return current.total === current.unfilteredTotal ? `${compact(current.total)} records` : `${compact(current.total)} of ${compact(current.unfilteredTotal)} records`;
  };
  const countDetail = () => {
    const current = page();
    if (!current) return "Loading recording";
    const scope = current.total === current.unfilteredTotal ? `${current.total.toLocaleString()} records` : `${current.total.toLocaleString()} of ${current.unfilteredTotal.toLocaleString()} records in this view`;
    return current.items.length > visibleEvents().length ? `${scope}. Tool results appear inside their calls.` : scope;
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
  // The toggle shows the reader's choice at once and sends it as an explicit state, so quick repeated presses settle on
  // the last one. The refreshed session confirms the choice; once nothing is saving, the session is the truth again.
  // Saves run one after another, so the server always receives the presses in the order they were made.
  const [bookmarkChoice, setBookmarkChoice] = createSignal<boolean | null>(null);
  let bookmarkSaves = 0, bookmarkQueue: Promise<unknown> = Promise.resolve();
  const bookmarked = () => bookmarkChoice() ?? Boolean(props.session?.bookmarked);
  createEffect(() => props.session?.bookmarked, value => { if (value === untrack(bookmarkChoice) || !bookmarkSaves) setBookmarkChoice(null); });
  const bookmark = async () => {
    if (!props.session) return;
    const next = !bookmarked();
    setBookmarkChoice(next);
    bookmarkSaves++;
    const save = bookmarkQueue.then(() => request(`/api/sessions/${props.id}/bookmark`, { method: "PUT", body: JSON.stringify({ bookmarked: next }) }));
    bookmarkQueue = save.catch(() => undefined);
    try { await save; props.changed(); }
    catch (error) { setBookmarkChoice(null); props.notify(error instanceof Error ? error.message : "Could not update bookmark"); }
    finally { bookmarkSaves--; }
  };
  const updateReplay = (values: Record<string, string | null>, replace = false) => {
    rememberReplayPosition(positionKey, scroll?.scrollTop || 0);
    setUpdated(false);
    seekTarget = null;
    pendingMatch = "";
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
  // Carries a term still waiting on the find debounce, which would otherwise be read back from the URL as empty.
  const changeOnly = (checked: boolean) => {
    setSearch(query()); setOnly(checked); setOffset(0);
    updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null, replayQ: query() || null, replayOnly: checked ? "1" : null });
  };
  const resetReplay = () => { setQuery(""); setSearch(""); setOnly(false); setKind("conversation"); setErrorsOnly(false); setOffset(0); updateReplay(clearReplayFilters()); };
  const revealContext = (id: string) => { setQuery(""); setSearch(""); setOnly(false); setKind("all"); setErrorsOnly(false); setOffset(0); updateReplay(clearReplayFilters({ replayKind: "all", event: id, context: "1" })); };
  const isFiltered = () => kind() !== "all" || errorsOnly() || Boolean(narrowTerm() || tool() || model() || cwd() || after() || before());
  const extraFilterCount = () => [!["conversation", "all"].includes(kind()), errorsOnly(), narrowTerm(), tool(), model(), cwd(), after(), before()].filter(Boolean).length;
  // Tabs are views, not filters: the badge counts only narrowing that the active tab does not already show.
  // The Errors tab is the unfocused errors-only view, so errors on top of a focused view counts that view.
  const tabView = () => errorsOnly() ? kind() === "all" : ["conversation", "tool", "all"].includes(kind());
  const filterBadgeCount = () => [!tabView(), narrowTerm(), tool(), model(), cwd(), after(), before()].filter(Boolean).length;
  const timelineLabel = () => {
    const first = page()?.items[0];
    if (page()?.offset) return `CONTINUED · EVENT ${(first ? first.sequence : page()!.offset) + 1}`;
    if (extraFilterCount() > 0 && first && first.sequence > 0) return `FIRST MATCH · EVENT ${first.sequence + 1}`;
    return "BEGINNING OF RECORDING";
  };
  const latest = () => {
    const target = Math.max(0, (page()?.total || 0) - 60);
    jumpBottom = true;
    following = true;
    const samePage = offset() === target && !props.anchor;
    setOffset(target); setUpdated(false); updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null, replayOffset: target ? String(target) : null });
    if (samePage) requestAnimationFrame(() => { scroll?.scrollTo({ top: scroll.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); jumpBottom = false; });
  };
  const latestUnfiltered = () => {
    const target = Math.max(0, (page()?.unfilteredTotal || 0) - 60);
    const samePage = !isFiltered() && offset() === target && !props.anchor;
    setQuery(""); setSearch(""); setOnly(false); setKind("all"); setErrorsOnly(false); setOffset(target);
    jumpBottom = true;
    following = true;
    updateReplay(clearReplayFilters({ replayKind: "all", replayOffset: target ? String(target) : null }));
    if (samePage) requestAnimationFrame(() => { scroll?.scrollTo({ top: scroll.scrollHeight }); jumpBottom = false; });
  };
  const revealPosition = (current: ReplayPage, position: number) => {
    if (position <= current.offset) { scroll?.scrollTo({ top: 0 }); return; }
    // Conversation and Tools can fold a tool-result card into its call, so fall forward to the next card that is on screen.
    for (const event of current.items.slice(position - current.offset)) {
      const card = scroll?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(event.id)}"]`);
      if (card) { card.scrollIntoView({ block: "start" }); return; }
    }
    scroll?.scrollTo({ top: 0 });
  };
  // Brings the anchored card's header to the top of the transcript, under the replay tabs. The page's first card is
  // already there, so the page start stays in view above it.
  const revealAnchor = (id: string) => {
    const card = scroll?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`);
    if (!card) return;
    if (card === scroll.querySelector(".replay-event")) scroll.scrollTo({ top: 0 });
    else card.scrollIntoView({ block: "start" });
  };
  const goTo = (target: number) => {
    const current = page();
    if (!current) return;
    const start = Math.max(0, Math.min(target, current.total - pageSize));
    if (start === offset() && !props.anchor) {
      // When that page is still loading, reveal the record once it lands rather than against the previous page.
      if (start === current.offset) revealPosition(current, target);
      else seekTarget = target;
      return;
    }
    setOffset(start);
    updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null, replayOffset: start ? String(start) : null });
    seekTarget = target;
  };
  // The card on this page that shows a record. Conversation and Tools fold a tool result into its call's card, so a match
  // in the output is shown, and selected, on the call.
  const cardOf = (id: string) => {
    const visible = visibleEvents();
    if (visible.some(event => event.id === id)) return id;
    const calls = new Set(page()?.items.find(event => event.id === id)?.blocks.flatMap(block => block.type === "tool_result" && block.tool_use_id ? [block.tool_use_id] : []));
    return calls.size ? visible.find(event => event.blocks.some(block => block.type === "tool_use" && block.id && calls.has(block.id)))?.id || "" : "";
  };
  const matchCard = createMemo(() => matchIndex() >= 0 ? cardOf(currentMatch()) : "");
  // The record at the top of the transcript, where the first step starts looking so the reader does not lose their place.
  const readingPosition = () => {
    const current = page();
    if (!current || !scroll) return 0;
    const top = scroll.getBoundingClientRect().top;
    for (const card of scroll.querySelectorAll<HTMLElement>(".replay-event[data-event-id]")) {
      if (card.getBoundingClientRect().bottom <= top + 1) continue;
      const index = current.items.findIndex(event => event.id === card.dataset.eventId);
      if (index >= 0) return current.offset + index;
    }
    return current.offset;
  };
  const step = (direction: -1 | 1) => {
    const list = matches()?.items;
    if (!list?.length) return;
    let index = matchIndex();
    if (index < 0) {
      const from = readingPosition();
      index = direction > 0 ? list.findIndex(item => item.position >= from) : list.findLastIndex(item => item.position < from);
      if (index < 0) index = direction > 0 ? 0 : list.length - 1;
    } else index = (index + direction + list.length) % list.length;
    // A call and its output can both match yet share one card; move on to the next match on another card so every step
    // visibly goes somewhere. When every other match is on the current card, take the next record anyway: the selection
    // stays put but the position still advances, so the count never claims a step that did not happen.
    if (matchCard()) {
      for (let next = index, tried = 1; tried < list.length; tried++, next = (next + direction + list.length) % list.length) {
        if (cardOf(list[next].id) !== matchCard()) { index = next; break; }
      }
    }
    const match = list[index];
    setCurrentMatch(match.id);
    const current = page();
    if (current && current.items[match.position - current.offset]?.id === match.id) {
      // A page an earlier step is still fetching must not reveal that older match over this one.
      pendingMatch = "";
      const card = cardOf(match.id);
      if (card) revealAnchor(card);
      return;
    }
    goTo(match.position);
    pendingMatch = seekTarget === match.position ? match.id : "";
  };
  const stepFromFind = (direction: -1 | 1) => {
    if (!query()) return;
    if (query() !== search() || !matches()) {
      pendingStep = direction;
      if (query() === search() && matchesFailed()) setMatchRetry(value => value + 1); else commitQuery(query());
      return;
    }
    step(direction);
  };
  const matchStatus = () => {
    const found = matches();
    if (!found) return matchesFailed() ? "Matches unavailable" : "— matches";
    if (!found.total) return "No matches";
    if (matchIndex() < 0) return found.total === 1 ? "1 match" : `${found.total.toLocaleString()} matches`;
    return `${(matchIndex() + 1).toLocaleString()} of ${found.total.toLocaleString()}`;
  };
  const turnPage = (direction: -1 | 1) => {
    const current = page();
    if (!current || (direction < 0 ? !current.offset : current.offset + current.limit >= current.total)) return false;
    // The same steps as the in-transcript Previous and Next buttons, so every way of paging lands on the same pages.
    const next = direction < 0 ? Math.max(0, current.offset - pageSize) : current.offset + current.limit;
    announceRange = true;
    setOffset(next);
    updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null, replayOffset: next ? String(next) : null });
    return true;
  };
  createEffect(() => props.id, () => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "[" && event.key !== "]" || event.metaKey || event.ctrlKey !== event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.matches("input,textarea,select") || target?.isContentEditable || document.querySelector("[role=dialog], dialog[open], .session-details[open], .replay-filters[open], .filter-popover[open], .app-shell.nav-open")) return;
      if (!turnPage(event.key === "[" ? -1 : 1)) return;
      event.preventDefault();
      // The cards are about to be replaced, so keep focus on the transcript rather than letting it fall to the page.
      if (scroll?.contains(document.activeElement) || document.activeElement === document.body) scroll?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });
  const outline = () => visibleEvents().filter(event => event.category === "message" || event.error || event.toolNames.length).slice(0, 24);
  const jumpToEvent = (id: string) => {
    scroll.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  return <section class={['replay-panel', { 'overview-hidden': !props.overviewVisible }]} aria-label="Session replay">
    <header class="replay-panel-heading">
      <div class="replay-title-row">
        <div class="replay-heading-content"><Show when={props.session} fallback={<div class="skeleton-row" />}>{session => <><div class="session-heading-title"><Show when={session().isAgent}><span class="session-identity"><Icon name="branch" size={14} />Subagent</span></Show><div class="replay-title-line"><h2 title={session().title} tabindex="-1">{sessionTitle()}</h2><button class="icon-button bookmark-toggle" aria-label="Bookmark this recording" aria-pressed={bookmarked() ? "true" : "false"} title={bookmarked() ? "Bookmarked. Press to remove the bookmark." : "Bookmark this recording"} onClick={() => void bookmark()}><Icon name="bookmark" size={18} /></button></div></div><div class="replay-meta"><Provenance session={session()} /><div class="replay-usage" aria-label="Session usage"><Show when={session().usage.requests} fallback="No token usage recorded"><span title={tokenCount(session().usage.totalTokens)}>{compact(session().usage.totalTokens)} tokens</span><span title="Covers this recording's own requests; subagent recordings are counted separately">{usageCost(session().usage)} estimated API cost</span><Show when={session().usage.unpricedRequests}><span class="usage-warning">Incomplete pricing</span></Show></Show></div></div></>}</Show></div>
        <button class="icon-button replay-close" aria-label="Close replay" title="Back to session library" onClick={props.close}><Icon name="close" size={18} /></button>
      </div>
      <div class="replay-actions">
        <Show when={props.session}>{session => <>
          <Show when={resumeTarget()}>{target => <button class="secondary-button resume-command" onClick={() => void copy(resumeCommand(target()), session().isAgent ? "Main session resume command" : "Resume command")}><Icon name="terminal" size={15} />{session().isAgent ? "Copy main session resume command" : "Copy resume command"}</button>}</Show>
          <SessionActions session={session()} />
          <details class="session-details" ref={setDetails}>
            <summary class="text-button"><span class="session-actions-label">Session actions</span><span class="session-details-label">Session details</span><Icon name="down" size={14} /></summary>
            <div class="session-details-menu" ref={setDetailsMenu} role="region" aria-label="Session details">
              <SessionActions session={session()} />
              <h3>Session details</h3>
              <dl>
                <dt>Title</dt><dd>{session().title}</dd>
                <dt>Original workspace</dt><dd><button class="source-path" title="Copy original working directory" onClick={() => void copy(session().cwd, "Source path")}><Icon name="folder" size={13} /><span>{session().cwd || "Working directory not recorded"}</span><Icon name="copy" size={12} /></button></dd>
                <dt>Branch</dt><dd>{session().branch || "No branch"}</dd>
                <dt>Model</dt><dd>{modelName(session().model)}</dd>
                <dt>Activity</dt><dd>{session().messageCount} messages · {session().toolCount} tools</dd>
                <dt>Est. API cost (this recording)</dt><dd>{usageCost(session().usage)}</dd>
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
      <Show when={props.session}>{session => <SessionFamilyNavigation session={session()} family={family()} pending={familyPending()} error={familyError()} retry={() => setFamilyRetry(value => value + 1)} href={href} follow={followSession} open={openSession} preview={setPreviewId} />}</Show>
    </header>
    <div class="replay-controls">
      <div class="replay-tabs" role="group" aria-label="Replay content">
        <For each={[["conversation", "Conversation"], ["tool", "Tools"], ["errors", "Errors"], ["all", "All events"]]}>{([value, label]) =>
          <button class={['replay-tab', { 'replay-tab-all': value === "all", active: value === "errors" ? errorsOnly() : kind() === value && !errorsOnly() }]} aria-pressed={(value === "errors" ? errorsOnly() : kind() === value && !errorsOnly()) ? "true" : "false"} onClick={() => value === "errors" ? showErrors() : changeKind(value)}>{label}</button>
        }</For>
      </div>
      <div class="replay-find"><Icon name="search" size={14} />
        <input ref={findInput} aria-label="Find in this recording" aria-keyshortcuts="Enter Shift+Enter" placeholder="Find in this recording…" value={query()} onInput={event => { pendingStep = 0; setQuery(event.currentTarget.value); }} onKeyDown={event => {
          if (event.key !== "Enter" || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          stepFromFind(event.shiftKey ? -1 : 1);
        }} />
        <Show when={query()}><button class="icon-button tiny" aria-label="Clear recording search" onClick={() => { setQuery(""); findInput.focus(); }}><Icon name="close" size={13} /></button></Show>
        <Show when={query()} fallback={<span class="replay-count" role="status" title={page() ? countDetail() : undefined} aria-label={countDetail()}>{countLabel()}</span>}>
          <div class="replay-find-tools">
            <span class="replay-count replay-match-count" role="status" title={matchIndex() >= 0 ? `Matching record ${matchIndex() + 1} of ${matches()!.total}. Enter for the next, Shift+Enter for the previous.` : matchesFailed() ? "The matching records could not be listed. Press Enter to try again." : "Enter steps to the next matching record, Shift+Enter to the previous."}>{matchStatus()}<Show when={matchIndex() >= 0}><span class="visually-hidden"> matching records</span></Show></span>
            <div class="replay-find-steps" role="group" aria-label="Find matches">
              <button class="icon-button tiny" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!matches()?.total && !matchesFailed()} onClick={() => stepFromFind(-1)}><Icon name="up" size={14} /></button>
              <button class="icon-button tiny" aria-label="Next match" title="Next match (Enter)" disabled={!matches()?.total && !matchesFailed()} onClick={() => stepFromFind(1)}><Icon name="down" size={14} /></button>
            </div>
            <label class="replay-only" title="Show only the records that contain the find term"><input type="checkbox" aria-label="Only matching records" checked={only()} onChange={event => changeOnly(event.currentTarget.checked)} /><span>Only matching</span></label>
          </div>
        </Show>
      </div>
      <details class="replay-filters" ref={setFilterDetails}><summary title="Filter this recording"><Icon name="sliders" size={14} />Filters<Show when={filterBadgeCount()}><span class="filter-count">{filterBadgeCount()}</span></Show></summary><div class="replay-filter-menu" ref={setFilterMenu} role="region" aria-label="Replay filters"><div class="replay-filter-menu-heading"><h3>Replay filters</h3><button class="icon-button tiny replay-filter-menu-close" aria-label="Close replay filters" onClick={() => { const element = filterDetails(); if (!element) return; element.open = false; element.querySelector<HTMLElement>("summary")?.focus(); }}><Icon name="close" size={15} /></button></div><p class="search-help">{page() ? `${page()!.total.toLocaleString()} of ${page()!.unfilteredTotal.toLocaleString()} records match.` : "Loading recording…"} Filters combine; records stay in their original order.</p>
        <Show when={page()?.facets.limited}><p class="search-help">Up to 200 values per filter are shown. Search still covers all recorded content.</p></Show>
        <label for="replay-focused-view">Focused replay view<select id="replay-focused-view" aria-label="Focused replay view" value={kind()} onChange={event => changeKind(event.currentTarget.value)}><For each={[["conversation", "Conversation"], ["tool", "Tools"], ["prompts", "Prompts"], ["responses", "Responses"], ["edits", "Edits"], ["thinking", "Thinking"], ["system", "System"], ["all", "All events"]]}>{([value, label]) => <option value={value}>{label}</option>}</For></select></label>
        <label for="replay-tool">Observed tool<select id="replay-tool" aria-label="Observed tool" value={tool()} onChange={event => changeFilter("replayTool", event.currentTarget.value)}><option value="">Any tool</option><For each={withSelectedOption(page()?.facets.tools || [], tool())}>{value => <option value={value}>{value}</option>}</For></select></label>
        <label for="replay-model">Recorded model<select id="replay-model" aria-label="Recorded model" value={model()} onChange={event => changeFilter("replayModel", event.currentTarget.value)}><option value="">Any model</option><For each={withSelectedOption(page()?.facets.models || [], model())}>{value => <option value={value}>{value}</option>}</For></select></label>
        <label for="replay-cwd">Working directory<select id="replay-cwd" aria-label="Working directory" value={cwd()} onChange={event => changeFilter("replayCwd", event.currentTarget.value)}><option value="">Any directory</option><For each={withSelectedOption(page()?.facets.directories || [], cwd())}>{value => <option value={value}>{value}</option>}</For></select></label>
        <label class="replay-errors"><input aria-label="Only errors" type="checkbox" checked={errorsOnly()} onChange={event => changeErrors(event.currentTarget.checked)} />Only errors</label>
        <div class="replay-date-range"><label for="replay-after">After<input id="replay-after" aria-label="After" type="date" value={after()} onChange={event => changeDate("replayAfter", event.currentTarget.value)} /></label><label for="replay-before">Before<input id="replay-before" aria-label="Before" type="date" value={before()} onChange={event => changeDate("replayBefore", event.currentTarget.value)} /></label></div>
        <button class="text-button" onClick={resetReplay}>Reset replay filters</button>
      </div></details>
    </div>
    <Show when={(page()?.total ?? props.session?.eventCount ?? 0) > pageSize}><ReplayTimeline id={props.id} filters={filterQuery()} growth={page()?.unfilteredTotal || 0} offset={page()?.offset ?? offset()} shown={page()?.items.length || 0} total={page()?.total || 0} pageSize={pageSize} narrowed={isFiltered()} errorsOnly={errorsOnly()} seek={goTo} latest={latest} /></Show>
    <Show when={error()}><div class="error-banner" role="alert">{error()}<button class="text-button" onClick={() => setRetry(value => value + 1)}>Retry</button></div></Show>
    <div class="replay-body"><div class="replay-scroll" id="replay-transcript" ref={scroll} tabindex="-1" aria-busy={pending() ? "true" : "false"} onScroll={event => { const element = event.currentTarget; if (element.isConnected && props.params.get("session") === props.id && !pending() && !initial && positionKey === replayPositionKey(props.id, props.params)) rememberReplayPosition(positionKey, element.scrollTop); }}>
      <div class="replay-timeline"><Show when={pending() && !page()} fallback={<>
        <div class="timeline-marker"><span /><Icon name="clock" size={12} />{timelineLabel()}<span /></div>
        <Show when={page()?.offset}><button class="load-events" onClick={() => { const previous = Math.max(0, page()!.offset - 60); setOffset(previous); updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null, replayOffset: previous ? String(previous) : null }); }}><Icon name="back" size={14} />Previous events</button></Show>
        <For each={visibleEvents()} keyed={event => event.id} fallback={<Show when={kind() === "thinking" && !narrowTerm() && !errorsOnly() && !tool() && !model() && !cwd() && !after() && !before() && page()?.hiddenTotal} fallback={<div class="empty-state compact"><Icon name="search" size={27} /><h3>No events match these filters.</h3><p>Reset filters to return to the conversation, or choose All events for the full chronology.</p><button class="secondary-button" onClick={resetReplay}>Reset replay filters</button></div>}><div class="empty-state compact"><Icon name="search" size={27} /><h3>No readable reasoning in this session.</h3><p>The model reasoned, but the API did not return the text. Choose All events to see where it paused to think.</p><button class="secondary-button" onClick={() => changeKind("all")}>Show all events</button><button class="text-button" onClick={resetReplay}>Reset replay filters</button></div></Show>}>{event => <EventCard event={event()} results={page()?.results} calls={page()?.calls} highlight={highlight()} showWorkspace={workspaceChanges().has(event().id)} sessionId={props.id} filtered={isFiltered()} selected={matchCard() ? event().id === matchCard() : event().id === props.anchor} onShowContext={revealContext} subagents={subagentNavigation()} />}</For>
        <Show when={page() && page()!.offset + page()!.limit < page()!.total} fallback={<div class="timeline-end"><span class="end-dot" />{extraFilterCount() ? "End of matching records." : "You're all caught up."}<small>{extraFilterCount() ? "Reset filters to return to the conversation." : "New activity appears here automatically."}</small></div>}><button class="load-events" onClick={() => { const next = page()!.offset + page()!.limit; setOffset(next); updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null, replayOffset: String(next) }); }}>Next {Math.min(60, page()!.total - page()!.offset - page()!.limit)} events<Icon name="arrow" size={14} /></button></Show>
      </>}><div class="skeleton-list"><For each={[1, 2, 3]}>{() => <div class="skeleton-event" />}</For></div></Show></div>
    </div><aside id="recording-overview" class="replay-inspector" aria-label="Recording overview">
      <p class="eyebrow">AT A GLANCE</p>
      <div class="inspector-stats"><div><strong>{props.session?.messageCount || 0}</strong><span>messages</span></div><div><strong>{props.session?.toolCount || 0}</strong><span>tool calls</span></div><div><strong>{props.session?.errorCount || 0}</strong><span>errors</span></div></div>
      <nav class="replay-outline" aria-label="Events on this page"><p class="eyebrow">ON THIS PAGE</p><For each={outline()}>{event => <button onClick={() => jumpToEvent(event.id)} title={event.toolNames.join(", ") || event.type}><span class={['outline-dot', { error: event.error, user: event.role === "user" && !isToolResultEvent(event) }]} /><span><small>{outlineLabel(event)}</small>{outlineBody(event)}</span></button>}</For></nav>
      <p class="inspector-note"><Icon name="shield" size={13} />An original record. Nothing rewritten.</p>
    </aside></div>
    <Show when={updated()}><button class="new-events" onClick={() => extraFilterCount() ? latestUnfiltered() : latest()}><Icon name="down" size={15} />{extraFilterCount() ? "Recording updated · Show latest unfiltered" : "Recording updated · Show latest"}</button></Show>
    <footer class="replay-footer"><span><Icon name="shield" size={12} />Read-only replay</span><nav class="replay-pager" aria-label="Recording pages"><button class="text-button" onClick={() => { setOffset(0); updateReplay({ replayKind: kind(), replayErrors: errorsOnly() ? "1" : null }); }}>Beginning</button><button class="text-button replay-page-step" aria-label="Previous page" title="Previous page ( [ )" disabled={!page()?.offset} onClick={() => turnPage(-1)}><Icon name="back" size={13} /><span class="replay-jump-full">Previous</span></button><span class="replay-range">{pending() ? "Reading recording…" : `${(page() ? Math.min(page()!.offset + 1, page()!.total) : 0).toLocaleString()}–${Math.min((page()?.offset || 0) + (page()?.items.length || 0), page()?.total || 0).toLocaleString()} of ${(page()?.total || 0).toLocaleString()}`}<Show when={!pending()}><span class="replay-range-unit"> records</span></Show></span><button class="text-button replay-page-step" aria-label="Next page" title="Next page ( ] )" disabled={!page() || page()!.offset + page()!.limit >= page()!.total} onClick={() => turnPage(1)}><span class="replay-jump-full">Next</span><Icon name="arrow" size={13} /></button><button class="text-button" aria-label="Jump to latest" onClick={latest}><span class="replay-jump-full">Jump to latest</span><span class="replay-jump-short" aria-hidden="true">Latest</span><Icon name="down" size={12} /></button></nav><span class="visually-hidden" aria-live="polite">{announcement()}</span></footer>
    <Show when={previewId() && family()}><SubagentDialog parent={familyRoot()} members={family()!.members.filter(member => member.session.isAgent)} selected={previewId()} revision={props.revision} href={href} follow={followSession} close={() => setPreviewId("")} /></Show>
  </section>;
}
