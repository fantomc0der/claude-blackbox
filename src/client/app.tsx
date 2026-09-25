import { createEffect, createMemo, createSignal, onSettled, Show, untrack } from "solid-js";
import type { Catalog, IndexProgress, Session, SessionPage } from "../shared/types";
import { isAbort, request } from "./lib/api";
import { dismissable, rememberFocus } from "./lib/dismissable";
import { createLocation } from "./lib/location";
import { replayKeys } from "./lib/replay-filters";
import { createRefreshQueue } from "./lib/refresh-queue";
import { Sidebar } from "./components/sidebar";
import { Library } from "./components/library";
import { LibraryDivider } from "./components/library-divider";
import { ReplayPanel } from "./components/replay-panel";
import { WorkspaceDialog } from "./components/workspace-dialog";
import { Icon } from "./components/icon";

function ShortcutPopover(props: { close: () => void; trigger: HTMLButtonElement }) {
  let panel!: HTMLDivElement;
  const restore = rememberFocus();
  onSettled(() => {
    panel.querySelector("button")?.focus();
    const release = dismissable(panel, props.close, props.trigger);
    return () => { release(); restore(panel); };
  });
  return <div class="shortcut-popover" role="dialog" aria-label="Keyboard shortcuts" ref={panel}><div><h3>Move a little faster.</h3><button class="icon-button tiny" aria-label="Close shortcuts" onClick={props.close}><Icon name="close" size={15} /></button></div><p><span>Search every recording</span><kbd>Ctrl / ⌘ K</kbd></p><p><span>Quick search</span><kbd>/</kbd></p><p><span>Move through recordings</span><kbd>↑ ↓</kbd></p><p><span>Open focused recording</span><kbd>Enter</kbd></p><p><span>Clear search / close overlay</span><kbd>Esc</kbd></p><p><span>Show these shortcuts</span><kbd>?</kbd></p></div>;
}

function usageScope(query: string | null): string | null {
  if (query === null) return null;
  const params = new URLSearchParams(query);
  for (const key of ["sort", "offset", "limit"]) params.delete(key);
  params.sort();
  return params.toString();
}

export function App() {
  const { params, navigate } = createLocation();
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
  const [toast, setToast] = createSignal("");
  const [help, setHelp] = createSignal(false);
  const [libraryCollapsed, setLibraryCollapsed] = createSignal(false);
  const [overviewVisible, setOverviewVisible] = createSignal(true);
  const [libraryWidth, setLibraryWidth] = createSignal<number>();
  let searchInput!: HTMLInputElement, helpButton!: HTMLButtonElement;
  let refreshPage = () => {};
  const changed = () => { setRevision(value => value + 1); refreshPage(); };
  const closeReplay = () => {
    const id = params().get("session");
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
  createEffect(() => toast(), value => {
    if (!value) return;
    const timeout = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timeout);
  });
  const catalogQueue = createRefreshQueue(async signal => {
    try {
      const data = await request<Catalog>("/api/catalog", { signal });
      if (!signal.aborted) setCatalog(data);
    } catch (error) { if (!signal.aborted && !isAbort(error)) setError(error instanceof Error ? error.message : "Could not refresh the archive"); }
  });
  createEffect(() => revision(), () => { void catalogQueue.refresh(); });
  createEffect(() => listQuery(), query => {
    const queue = createRefreshQueue(async signal => {
      setPending(true); setError("");
      try {
        const data = await request<SessionPage>(`/api/sessions?${query}`, { signal });
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
    refreshPage = () => { void queue.refresh(); };
    refreshPage();
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
    source.addEventListener("change", changed);
    source.addEventListener("indexing", event => setIndexing(JSON.parse((event as MessageEvent).data)));
    const keyboard = (event: KeyboardEvent) => {
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
    return () => { source.close(); catalogQueue.dispose(); window.removeEventListener("keydown", keyboard); media.removeEventListener("change", mediaChanged); };
  });
  const refresh = async () => {
    if (refreshing()) return;
    setRefreshing(true);
    try { await request("/api/refresh", { method: "POST", body: "{}" }); changed(); setToast("Recordings are up to date"); }
    catch (error) { setToast(error instanceof Error ? error.message : "Refresh failed"); }
    finally { setRefreshing(false); }
  };
  const currentWorkspace = () => catalog()?.workspaces.find(workspace => workspace.id === params().get("workspace"));

  return <div class={['app-shell', { 'has-replay': Boolean(params().get("session")), 'nav-open': navOpen() }]}>
    <a class="skip-link" href="#main-content">Skip to recordings</a>
    <Show when={navOpen()}><button class="nav-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} /></Show>
    <Sidebar catalog={catalog()} indexing={indexing()} refreshing={refreshing()} params={params()} navigate={navigate} group={() => setGroupOpen(true)} refresh={() => void refresh()} close={() => setNavOpen(false)} hidden={mobile() && !navOpen()} />
    <main class="main-shell" id="main-content"><header class="topbar"><div class="breadcrumbs"><button class="mobile-menu icon-button" aria-label="Open workspace navigation" onClick={() => setNavOpen(true)}><Icon name="menu" /></button><Icon name="box" size={16} /><span>Flight recorder</span><span class="breadcrumb-divider">/</span><strong>{currentWorkspace()?.name || (params().get("bookmarked") ? "Bookmarked" : "All workspaces")}</strong></div><div class="topbar-actions"><Show when={catalog()?.demo}><span class="demo-label">DEMO MODE</span></Show><Show when={catalog() && !catalog()!.indexedAt}><span class="indexing-state" role="status"><span class="live-dot" />Indexing recordings…</span></Show><span class={['connection-state', { disconnected: !connected() }]}><span class="live-dot" />{connected() ? "Connected locally" : "Reconnecting…"}</span><button class="icon-button" ref={helpButton} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelp(value => !value)}><Icon name="keyboard" size={18} /></button></div></header>
      <Show when={error()}><div class="error-banner" role="alert"><Icon name="alert" size={16} />{error()}<button class="text-button" onClick={changed}>Retry</button></div></Show>
      <Show when={catalog()?.warnings}><div class="warning-banner"><Icon name="alert" size={14} />{catalog()!.warnings} unreadable records or sources were skipped. Other recordings are available.</div></Show>
      <div class={['content-shell', { 'library-collapsed': libraryCollapsed() }]} style={{ '--library-width': libraryWidth() === undefined ? undefined : `${libraryWidth()}px` }}><Library catalog={catalog()} page={page()} usageCurrent={usageScope(pageQuery()) === usageScope(listQuery())} pending={pending()} params={params()} navigate={navigate} query={query()} setQuery={setQuery} searchRef={element => searchInput = element} />
        <Show when={params().get("session") && !libraryCollapsed()}><LibraryDivider resize={setLibraryWidth} /></Show>
        <Show when={params().get("session")} keyed>{id => <ReplayPanel id={id} session={session()} revision={revision()} anchor={params().get("event") || ""} params={params()} navigate={navigate} changed={changed} close={closeReplay} notify={setToast} libraryCollapsed={libraryCollapsed()} toggleLibrary={() => setLibraryCollapsed(value => !value)} overviewVisible={overviewVisible()} toggleOverview={() => setOverviewVisible(value => !value)} />}</Show>
      </div>
    </main>
    <Show when={groupOpen() && catalog()}><WorkspaceDialog catalog={catalog()!} onClose={() => setGroupOpen(false)} onSaved={changed} /></Show>
    <Show when={help()}><ShortcutPopover close={() => setHelp(false)} trigger={helpButton} /></Show>
    <Show when={toast()}><div class="toast" role="status"><Icon name="check" size={16} />{toast()}</div></Show>
  </div>;
}
