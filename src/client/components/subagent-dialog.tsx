import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import type { ContentBlock, EventPage, Session } from "../../shared/types";
import { isAbort, request } from "../lib/api";
import { compact, modelName, usageCost } from "../lib/format";
import { EventCard } from "./event-card";
import { Icon } from "./icon";

type PreviewPage = EventPage & { results: Record<string, ContentBlock> };

function SubagentDialog(props: { parent: Session; agents: Session[]; revision: number; close: () => void }) {
  let dialog!: HTMLDialogElement;
  let transcript!: HTMLDivElement;
  let outsidePointer = false;
  const previousFocus = document.activeElement;
  const [selected, setSelected] = createSignal(props.agents[0]?.id || "");
  const [offset, setOffset] = createSignal(0);
  const [page, setPage] = createSignal<PreviewPage | null>(null);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [retry, setRetry] = createSignal(0);
  const agent = () => props.agents.find(agent => agent.id === selected());
  onSettled(() => {
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  });
  createEffect(() => props.agents.map(agent => agent.id), ids => {
    if (!ids.includes(selected())) { setSelected(ids[0] || ""); setOffset(0); }
  });
  createEffect(() => ({ id: selected(), offset: offset(), revision: props.revision, retry: retry() }), state => {
    if (!state.id) { setPage(null); setPending(false); setError(""); return; }
    const controller = new AbortController();
    setPending(true); setError("");
    void request<PreviewPage>(`/api/sessions/${state.id}/events?kind=all&limit=40&offset=${state.offset}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setPage(data); })
      .catch(error => { if (!controller.signal.aborted && !isAbort(error)) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  });
  const changePage = (next: number) => { setPage(null); setOffset(next); transcript.scrollTop = 0; };
  const changeAgent = (id: string) => { setPage(null); setSelected(id); setOffset(0); transcript.scrollTop = 0; };
  const outside = (event: MouseEvent) => {
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  return <dialog ref={dialog} class="subagent-dialog" aria-labelledby="subagent-heading" aria-describedby="subagent-parent"
    onPointerDown={event => { outsidePointer = outside(event); }} onClick={event => { if (outsidePointer && outside(event)) props.close(); }}
    onClose={props.close} onCancel={event => { event.preventDefault(); props.close(); }}>
    <header class="subagent-dialog-heading">
      <div><h2 id="subagent-heading">Subagent recordings</h2><p id="subagent-parent" title={props.parent.title}>From: {props.parent.title}</p></div>
      <button class="icon-button" aria-label="Close subagent recordings" onClick={props.close}><Icon name="close" /></button>
    </header>
    <div class="subagent-selection">
      <label for="subagent-recording">Recording <span>({props.agents.length})</span></label>
      <select id="subagent-recording" value={selected()} onChange={event => changeAgent(event.currentTarget.value)}>
        <For each={props.agents}>{agent => <option value={agent.id}>{agent.title} · {agent.source.split(/[\\/]/).at(-1)}</option>}</For>
      </select>
      <Show when={agent()}>{agent => <div class="subagent-metadata"><span>{modelName(agent().model)}</span><span>{compact(agent().eventCount)} records</span><Show when={agent().usage.requests}><span>{usageCost(agent().usage)} est.</span></Show><span class="subagent-source" title={agent().cwd}>{agent().cwd || "Working directory not recorded"}</span></div>}</Show>
    </div>
    <div class="subagent-transcript" ref={transcript} aria-label="Subagent transcript" aria-busy={pending() ? "true" : "false"} tabindex="0">
      <Show when={error()}><div class="error-banner" role="alert">{error()}<button class="text-button" onClick={() => setRetry(value => value + 1)}>Retry</button></div></Show>
      <Show when={pending() && !page()}><p class="subagent-status" role="status">Loading recording…</p></Show>
      <For each={page()?.items || []}>{event => <EventCard event={event} results={page()?.results} showWorkspace linkEvents={false} />}</For>
      <Show when={!pending() && !error() && !page()?.items.length}><p class="subagent-status">No recorded events are available yet.</p></Show>
    </div>
    <footer class="subagent-dialog-footer"><span>Read-only preview · Your main session stays in place</span><div class="pagination">
      <button class="icon-button" aria-label="Previous subagent events" disabled={pending() || !offset()} onClick={() => changePage(Math.max(0, offset() - 40))}><Icon name="back" size={16} /></button>
      <span aria-live="polite">{page()?.total ? `${page()!.offset + 1}–${page()!.offset + page()!.items.length} of ${page()!.total}` : "—"}</span>
      <button class="icon-button" aria-label="Next subagent events" disabled={pending() || !page() || offset() + 40 >= page()!.total} onClick={() => changePage(offset() + 40)}><Icon name="arrow" size={16} /></button>
    </div></footer>
  </dialog>;
}

export function SubagentAccess(props: { session: Session; revision: number }) {
  const [agents, setAgents] = createSignal<Session[]>([]);
  const [open, setOpen] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [retry, setRetry] = createSignal(0);
  createEffect(() => ({ id: props.session.id, revision: props.revision, retry: retry() }), state => {
    const controller = new AbortController();
    setError(false);
    void request<Session[]>(`/api/sessions/${state.id}/subagents`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setAgents(data); })
      .catch(error => { if (!controller.signal.aborted && !isAbort(error)) setError(true); });
    return () => controller.abort();
  });
  return <><Show when={agents().length}><button class="secondary-button subagent-access" onClick={() => setOpen(true)}><Icon name="branch" size={15} />Subagents <span>{agents().length}</span></button></Show>
    <Show when={error()}><button class="text-button" onClick={() => setRetry(value => value + 1)}>Retry subagents</button></Show>
    <Show when={open()}><SubagentDialog parent={props.session} agents={agents()} revision={props.revision} close={() => setOpen(false)} /></Show></>;
}
