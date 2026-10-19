import { createEffect, createMemo, createSignal, onSettled, Show, untrack } from "solid-js";
import type { Catalog, IndexProgress, Session, SessionPage, WorkspaceGroup } from "../shared/types";
import { isAbort, request } from "./lib/api";
import { dismissable, rememberFocus } from "./lib/dismissable";
import { withLocalDays } from "./lib/format";
import { createLocation } from "./lib/location";
import { replayKeys } from "./lib/replay-filters";
import { createRefreshQueue } from "./lib/refresh-queue";
import { Sidebar } from "./components/sidebar";
import { Library } from "./components/library";
import { LibraryDivider } from "./components/library-divider";
import { ReplayPanel } from "./components/replay-panel";
import { WorkspaceDialog } from "./components/workspace-dialog";
import { Icon } from "./components/icon";
import { noticeDuration, Toast, type Notice } from "./components/toast";

function ShortcutPopover(props: { close: () => void; trigger: HTMLButtonElement }) {
  let panel!: HTMLDivElement;
  const restore = rememberFocus();
  onSettled(() => {
    panel.querySelector("button")?.focus();
    const release = dismissable(panel, props.close, props.trigger);
    return () => { release(); restore(panel); };
  });
  return <div class="shortcut-popover" role="dialog" aria-label="Keyboard shortcuts" ref={panel}><div><h3>Move a little faster.</h3><button class="icon-button tiny" aria-label="Close shortcuts" onClick={props.close}><Icon name="close" size={15} /></button></div><p><span>Search every recording</span><kbd>Ctrl / ⌘ K</kbd></p><p><span>Quick search</span><kbd>/</kbd></p><p><span>Move through recordings</span><kbd>↑ ↓</kbd></p><p><span>Open focused recording</span><kbd>Enter</kbd></p><p><span>Previous / next replay page</span><kbd>[ ]</kbd></p><p><span>Clear search / close overlay</span><kbd>Esc</kbd></p><p><span>Show these shortcuts</span><kbd>?</kbd></p></div>;
}

function usageScope(query: string | null): string | null {
  if (query === null) return null;
  const params = new URLSearchParams(query);
  for (const key of ["sort", "offset", "limit"]) params.delete(key);
  params.sort();
  return params.toString();
}

export function App() {
  const { params, navigate, traversal } = createLocation();
  const [catalog, setCatalog] = createSignal<Catalog | null>(null);
  const [page, setPage] = createSignal<SessionPage | null>(null);
  const [pageQuery, setPageQuery] = createSignal<string | null>(null);
  const [indexing, setIndexing] = createSignal<IndexProgress | null>(null);
  const [refreshing, setRefreshing] = createSignal(false);
  const [session, setSession] = createSignal<Session | null>(null);
  const [revision, setRevision] = createSignal(0);
  const [pending, setPending] = createSignal(true);
  const [connected, setConnected] = createSignal(false);
  const [error, setError] = createSignal("");
  const [groupOpen, setGroupOpen] = createSignal(false);
  const [navOpen, setNavOpen] = createSignal(false);
  const [mobile, setMobile] = createSignal(matchMedia("(max-width: 680px)").matches);
  const [query, setQuery] = createSignal(new URLSearchParams(location.search).get("q") || "");
  const [toast, setToast] = createSignal<Notice | null>(null);
  const [toastHeld, setToastHeld] = createSignal(false);
  const [help, setHelp] = createSignal(false);
  const [libraryCollapsed, setLibraryCollapsed] = createSignal(false);
  const [overviewVisible, setOverviewVisible] = createSignal(true);
  const [libraryWidth, setLibraryWidth] = createSignal<number>();
  const [headingFocus, setHeadingFocus] = createSignal<{ id: string; from: Element | null } | null>(null);
  const defaultTitle = document.title;
  let searchInput!: HTMLInputElement, helpButton!: HTMLButtonElement;
  let refreshPage = () => Promise.resolve();
  // When the library last began to refresh and when the server last sent a change notice.
  let refreshedAt = 0, noticedAt = 0;
  // Settles once the catalog and the library page have both been read again.
  const changed = () => {
    refreshedAt = performance.now();
    setRevision(value => value + 1);
    return Promise.all([catalogQueue.refresh(), refreshPage()]).then(() => {});
  };
  const closeReplay = () => {
    const id = params().get("session");
    setHeadingFocus(null);
    navigate({ session: null, event: null, context: null, ...Object.fromEntries(replayKeys.map(key => [key, null])) });
    requestAnimationFrame(() => {
      const row = id ? document.querySelector<HTMLElement>(`.session-row[data-session-id="${CSS.escape(id)}"]`) : null;
      (row?.getClientRects().length ? row : searchInput).focus();
    });
  };
  const listQuery = createMemo(() => {
    const next = new URLSearchParams(params()); next.delete("session"); next.delete("event"); next.delete("context"); for (const key of replayKeys) next.delete(key); return next.toString();
  });

  createEffect(() => ({ catalog: catalog(), workspace: params().get("workspace") }), ({ catalog, workspace }) => {
    if (catalog && workspace && !catalog.workspaces.some(entry => entry.id === workspace)) navigate({ workspace: null, cwd: null, offset: null }, true);
  });
  createEffect(() => ({ open: navOpen(), mobile: mobile() }), ({ open, mobile }, previous) => {
    if (!mobile) return;
    requestAnimationFrame(() => {
      if (open) document.querySelector<HTMLButtonElement>(".sidebar-mobile-close")?.focus();
      else if (previous?.open) document.querySelector<HTMLButtonElement>(".mobile-menu")?.focus();
    });
  });

  createEffect(() => params().get("q") || "", value => { setQuery(value); });
  createEffect(() => query(), value => {
    if (value === untrack(() => params().get("q") || "")) return;
    const timeout = setTimeout(() => navigate({ q: value || null, offset: null }, true), 220);
    return () => clearTimeout(timeout);
  });
  createEffect(() => ({ notice: toast(), held: toastHeld() }), ({ notice, held }) => {
    if (!notice || held) return;
    const timeout = setTimeout(() => setToast(null), noticeDuration(notice));
    return () => clearTimeout(timeout);
  });
  const catalogQueue = createRefreshQueue(async signal => {
    try {
      const data = await request<Catalog>("/api/catalog", { signal });
      if (!signal.aborted) setCatalog(data);
    } catch (error) { if (!signal.aborted && !isAbort(error)) setError(error instanceof Error ? error.message : "Could not refresh the archive"); }
  });
  void catalogQueue.refresh();
  // A change notice from the server re-reads the library, which on a large index costs the server seconds of the thread
  // that also runs the scan, and a long scan sends a notice about every second. Notices therefore rest three times as
  // long as their last refresh took, so the scan and a recording opened meanwhile keep most of the server's time.
  // The reader's own changes still refresh at once, and a refresh begun after the latest notice already covers it, as
  // it does the notice the server sends for the reader's own change.
  const liveQueue = createRefreshQueue(async () => { if (noticedAt > refreshedAt) await changed(); }, 3);
  createEffect(() => listQuery(), query => {
    const queue = createRefreshQueue(async signal => {
      setPending(true); setError("");
      try {
        const data = await request<SessionPage>(`/api/sessions?${withLocalDays(query)}`, { signal });
        if (signal.aborted) return;
        const existing = new Map(page()?.items.map(session => [session.id, session]) || []);
        data.items = data.items.map(session => {
          const previous = existing.get(session.id);
          return previous && JSON.stringify(previous) === JSON.stringify(session) ? previous : session;
        });
        setPage(data); setPageQuery(query);
      } catch (error) {
        if (!signal.aborted && !isAbort(error)) setError(error instanceof Error ? error.message : "Could not refresh recordings");
      } finally { if (!signal.aborted) setPending(false); }
    });
    refreshPage = () => queue.refresh();
    void refreshPage();
    return () => queue.dispose();
  });
  createEffect(() => ({ id: params().get("session"), revision: revision() }), value => {
    const controller = new AbortController();
    if (!value.id) { setSession(null); return; }
    if (untrack(() => session()?.id) !== value.id) setSession(null);
    void request<Session>(`/api/sessions/${value.id}`, { signal: controller.signal }).then(setSession).catch(error => {
      if (!isAbort(error)) { setError(error.message); setSession(null); }
    });
    return () => controller.abort();
  });
  onSettled(() => {
    const media = matchMedia("(max-width: 680px)");
    const mediaChanged = () => setMobile(media.matches);
    media.addEventListener("change", mediaChanged);
    const source = new EventSource("/api/live");
    source.onopen = () => setConnected(true);
    source.onerror = () => { setConnected(false); setIndexing(null); };
    source.addEventListener("change", () => { noticedAt = performance.now(); void liveQueue.refresh(); });
    source.addEventListener("indexing", event => setIndexing(JSON.parse((event as MessageEvent).data)));
    const keyboard = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (navOpen() && mobile() && event.key === "Tab") {
        const targets = [...document.querySelectorAll<HTMLElement>(".sidebar a[href],.sidebar button:not([disabled]),.sidebar input:not([disabled]),.sidebar select:not([disabled]),.sidebar textarea:not([disabled]),.sidebar summary,.sidebar [tabindex]:not([tabindex='-1'])")].filter(element => element.getClientRects().length && !element.closest("[inert]"));
        if (event.shiftKey && document.activeElement === targets[0]) { event.preventDefault(); targets.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === targets.at(-1)) { event.preventDefault(); targets[0]?.focus(); }
      }
      const editing = (event.target instanceof HTMLElement) && (event.target.matches("input,textarea,select") || event.target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" || event.key === "/" && !editing) {
        if (groupOpen()) return;
        event.preventDefault();
        setLibraryCollapsed(false);
        if (matchMedia("(max-width: 900px)").matches) navigate({ session: null, event: null });
        requestAnimationFrame(() => { searchInput.focus(); searchInput.select(); });
      }
      if (event.key === "Escape" && !editing && !groupOpen()) {
        if (navOpen()) setNavOpen(false);
        else if (params().get("session")) closeReplay();
      }
      if (event.key === "?" && !editing) setHelp(value => !value);
    };
    window.addEventListener("keydown", keyboard);
    return () => { source.close(); liveQueue.dispose(); catalogQueue.dispose(); window.removeEventListener("keydown", keyboard); media.removeEventListener("change", mediaChanged); };
  });
  const refresh = async () => {
    if (refreshing()) return;
    setRefreshing(true);
    try { await request("/api/refresh", { method: "POST", body: "{}" }); changed(); setToast({ message: "Recordings are up to date" }); }
    catch (error) { setToast({ message: error instanceof Error ? error.message : "Refresh failed" }); }
    finally { setRefreshing(false); }
  };
  const notify = (message: string) => setToast({ message });
  // Ungrouping acts at once and offers Undo in the toast. A group ungrouped while that toast still shows joins it, so a
  // quick second click on the row that slid under the pointer is undone together with the first. Undo re-creates each
  // group through the same POST the dialog uses, keeping its id, so a workspace URL selecting it works again.
  type Ungrouped = { notice: Notice; groups: WorkspaceGroup[]; selection: { workspace: string; cwd: string | null } | null; restoring?: boolean };
  let ungroupedBatch: Ungrouped | null = null;
  const groupNames = (groups: WorkspaceGroup[]) => groups.length === 1 ? groups[0].name : groups.length === 2 ? `${groups[0].name} and ${groups[1].name}` : `${groups.length} groups`;
  const ungrouped = (group: WorkspaceGroup) => {
    // A batch whose Undo is already restoring cannot take more groups, so this one starts a toast of its own.
    const previous = ungroupedBatch && !ungroupedBatch.restoring && untrack(toast) === ungroupedBatch.notice ? ungroupedBatch : null;
    const groups = [...(previous?.groups || []), group];
    const selection = previous?.selection || (params().get("workspace") === group.id ? { workspace: group.id, cwd: params().get("cwd") } : null);
    const batch: Ungrouped = { notice: { message: `Ungrouped ${groupNames(groups)}`, action: { label: "Undo", run: () => void undoUngroup(batch) } }, groups, selection };
    ungroupedBatch = batch;
    setToast(batch.notice);
    changed();
  };
  const undoUngroup = async (batch: Ungrouped) => {
    if (batch.restoring || untrack(toast) !== batch.notice) return;
    batch.restoring = true;
    const returnFocus = Boolean(document.activeElement?.closest(".toast"));
    const restored: WorkspaceGroup[] = [], failed: WorkspaceGroup[] = [];
    let reason = "";
    try {
      for (const group of batch.groups) {
        try {
          await request("/api/groups", { method: "POST", body: JSON.stringify({ id: group.id, name: group.name, paths: group.paths }) });
          restored.push(group);
        } catch (error) { failed.push(group); reason ||= error instanceof Error ? error.message : String(error); }
      }
      if (ungroupedBatch === batch) ungroupedBatch = null;
      changed();
      await catalogQueue.refresh();
    } finally { batch.restoring = false; }
    // The workspace view falls back to all workspaces when its group disappears; put the selection back unless the
    // reader has chosen another workspace since.
    const selection = batch.selection && restored.some(group => group.id === batch.selection!.workspace) ? batch.selection : null;
    if (selection && !params().get("workspace")) navigate({ workspace: selection.workspace, cwd: selection.cwd }, true);
    // A group ungrouped while this restore was in flight now owns the toast and its Undo; leave both alone.
    if (untrack(toast) !== batch.notice) return;
    setToast(failed.length
      ? { message: `${restored.length ? `Restored ${groupNames(restored)}. ` : ""}Could not restore ${groupNames(failed)}. ${reason}`, error: true }
      : { message: `Restored ${groupNames(restored)}` });
    if (!returnFocus) return;
    // Undo is gone with its notice, so focus returns to the restored group's Ungroup button in the dialog, or to the
    // Group action that opens it.
    requestAnimationFrame(() => {
      const dialog = document.querySelector<HTMLDialogElement>("dialog.workspace-dialog[open]");
      const row = restored[0] ? `.existing-group[data-group-id="${CSS.escape(restored[0].id)}"] .ungroup-button` : "";
      const trigger = document.querySelector<HTMLElement>(".workspace-group");
      const target = dialog ? (row && dialog.querySelector<HTMLElement>(row)) || dialog.querySelector<HTMLElement>("#group-name") : trigger?.getClientRects().length && !trigger.closest("[inert]") ? trigger : searchInput;
      target?.focus();
    });
  };
  const dialogOpen = () => groupOpen() && Boolean(catalog());
  const currentWorkspace = () => catalog()?.workspaces.find(workspace => workspace.id === params().get("workspace"));
  // A recording opened from the keyboard moves focus to its heading once it has loaded, so the next Tab continues into the
  // replay instead of through every remaining row. Escape or Close replay still returns focus to the row. Focus moves only
  // while it still sits on the row that opened the recording, or on the body once a narrow layout has hidden that row, so a
  // reader who tabbed elsewhere during a slow load keeps their place.
  createEffect(() => { const request = headingFocus(); return request && session()?.id === request.id ? request : null; }, request => {
    if (!request) return;
    setHeadingFocus(null);
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (params().get("session") !== request.id || (active && active !== document.body && active !== request.from)) return;
      document.querySelector<HTMLElement>(".replay-panel-heading h2")?.focus({ preventScroll: true });
    });
  });
  createEffect(() => {
    const id = params().get("session"), term = params().get("q")?.trim();
    const opened = id && session()?.id === id ? session()!.title.trim() : "";
    const view = opened || (term ? `Search: ${term}` : currentWorkspace()?.name || (params().get("bookmarked") ? "Bookmarked" : ""));
    return view ? `${view} · claude-blackbox` : defaultTitle;
  }, title => { document.title = title; });
  const skipToTranscript = (event: MouseEvent) => {
    event.preventDefault();
    document.querySelector<HTMLElement>(".replay-scroll")?.focus();
  };

  return <div class={['app-shell', { 'has-replay': Boolean(params().get("session")), 'nav-open': navOpen() }]}>
    <Show when={params().get("session")}><a class="skip-link" href="#replay-transcript" onClick={skipToTranscript}>Skip to transcript</a></Show>
    <a class="skip-link" href="#main-content">Skip to recordings</a>
    <Show when={navOpen()}><button class="nav-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} /></Show>
    <Sidebar catalog={catalog()} indexing={indexing()} refreshing={refreshing()} params={params()} navigate={navigate} group={() => setGroupOpen(true)} refresh={() => void refresh()} close={() => setNavOpen(false)} hidden={mobile() && !navOpen()} />
    <main class="main-shell" id="main-content"><header class="topbar"><div class="breadcrumbs"><button class="mobile-menu icon-button" aria-label="Open workspace navigation" onClick={() => setNavOpen(true)}><Icon name="menu" /></button><Icon name="box" size={16} /><span>Flight recorder</span><span class="breadcrumb-divider">/</span><strong>{currentWorkspace()?.name || (params().get("bookmarked") ? "Bookmarked" : "All workspaces")}</strong></div><div class="topbar-actions"><Show when={catalog()?.demo}><span class="demo-label">DEMO MODE</span></Show><Show when={catalog() && !catalog()!.indexedAt}><span class="indexing-state" role="status"><span class="live-dot" />{indexing()?.phase === "upgrading" ? "Upgrading index…" : "Indexing recordings…"}</span></Show><span class={['connection-state', { disconnected: !connected() }]}><span class="live-dot" />{connected() ? "Connected locally" : "Reconnecting…"}</span><button class="icon-button" ref={helpButton} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelp(value => !value)}><Icon name="keyboard" size={18} /></button></div></header>
      <Show when={error()}><div class="error-banner" role="alert"><Icon name="alert" size={16} />{error()}<button class="text-button" onClick={changed}>Retry</button></div></Show>
      <Show when={catalog()?.warnings}><div class="warning-banner"><Icon name="alert" size={14} />{catalog()!.warnings} unreadable records or sources were skipped. Other recordings are available.</div></Show>
      <div class={['content-shell', { 'library-collapsed': libraryCollapsed() }]} style={{ '--library-width': libraryWidth() === undefined ? undefined : `${libraryWidth()}px` }}><Library catalog={catalog()} page={page()} usageCurrent={usageScope(pageQuery()) === usageScope(listQuery())} pending={pending()} params={params()} navigate={navigate} query={query()} setQuery={setQuery} searchRef={element => searchInput = element} focusReplay={id => setHeadingFocus(id ? { id, from: document.activeElement } : null)} />
        <Show when={params().get("session") && !libraryCollapsed()}><LibraryDivider resize={setLibraryWidth} /></Show>
        <Show when={params().get("session")} keyed>{id => <ReplayPanel id={id} session={session()} revision={revision()} anchor={params().get("event") || ""} params={params()} navigate={navigate} traversal={traversal} changed={changed} close={closeReplay} notify={notify} libraryCollapsed={libraryCollapsed()} toggleLibrary={() => setLibraryCollapsed(value => !value)} overviewVisible={overviewVisible()} toggleOverview={() => setOverviewVisible(value => !value)} />}</Show>
      </div>
    </main>
    <Show when={dialogOpen()}><WorkspaceDialog catalog={catalog()!} onClose={() => setGroupOpen(false)} onSaved={changed} onUngrouped={ungrouped}><Toast notice={toast()} hold={setToastHeld} /></WorkspaceDialog></Show>
    <Show when={help()}><ShortcutPopover close={() => setHelp(false)} trigger={helpButton} /></Show>
    <Show when={!dialogOpen()}><Toast notice={toast()} hold={setToastHeld} /></Show>
    <div class="visually-hidden index-announcement" role="status" aria-live="polite" aria-atomic="true">{indexing()?.phase === "error" ? "Recording scan failed. Indexed recordings remain available, but results may be incomplete or out of date. Rescan recordings to retry." : ""}</div>
  </div>;
}
