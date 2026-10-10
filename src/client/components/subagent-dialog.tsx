import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import type { ContentBlock, EventPage, Session, SessionFamilyMember } from "../../shared/types";
import { isAbort, request } from "../lib/api";
import { compact, modelName, usageCost } from "../lib/format";
import { EventCard } from "./event-card";
import { Icon } from "./icon";

type PreviewPage = EventPage & { results: Record<string, ContentBlock> };

export function SubagentDialog(props: { parent: Session | null; members: SessionFamilyMember[]; selected: string; revision: number; href: (id: string) => string; follow: (event: MouseEvent, id: string) => void; close: () => void }) {
  let dialog!: HTMLDialogElement;
  let transcript!: HTMLDivElement;
  let outsidePointer = false;
  const previousFocus = document.activeElement;
  const [selected, setSelected] = createSignal(untrack(() => props.selected));
  const [offset, setOffset] = createSignal(0);
  const [page, setPage] = createSignal<PreviewPage | null>(null);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [retry, setRetry] = createSignal(0);
  const member = () => props.members.find(member => member.session.id === selected());
  const agent = () => member()?.session;
  const visibleEvents = createMemo(() => {
    const calls = new Set(page()?.items.flatMap(event => event.blocks.filter(block => block.type === "tool_use").map(block => block.id)) || []);
    return (page()?.items || []).filter(event => !event.blocks.length || !event.blocks.every(block => block.type === "tool_result" && calls.has(block.tool_use_id)));
  });
  onSettled(() => {
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  });
  createEffect(() => props.members.map(member => member.session.id), ids => {
    if (!ids.includes(selected())) { setSelected(ids[0] || ""); setOffset(0); }
  });
  createEffect(() => ({ id: selected(), offset: offset(), revision: props.revision, retry: retry() }), state => {
    if (!state.id) { setPage(null); setPending(false); setError(""); return; }
    const controller = new AbortController();
    setPending(true); setError("");
    void request<PreviewPage>(`/api/sessions/${state.id}/events?kind=conversation&limit=40&offset=${state.offset}`, { signal: controller.signal })
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
      <div><h2 id="subagent-heading">Subagent recordings</h2><p id="subagent-parent"><Show when={props.parent} fallback="Main session not found in this archive">{parent => <a href={props.href(parent().id)} onClick={event => props.follow(event, parent().id)} title={parent().title}>Main session: {parent().title}</a>}</Show></p></div>
      <button class="icon-button" aria-label="Close subagent recordings" onClick={props.close}><Icon name="close" /></button>
    </header>
    <div class="subagent-selection">
      <label for="subagent-recording">Recording <span>({props.members.length})</span></label>
      <select id="subagent-recording" value={selected()} onChange={event => changeAgent(event.currentTarget.value)}>
        <For each={props.members}>{member => <option value={member.session.id}>{member.label} · {member.session.source.split(/[\\/]/).at(-1)}</option>}</For>
      </select>
      <Show when={agent()}>{agent => <div class="subagent-metadata"><span>{modelName(agent().model)}</span><span>{compact(agent().eventCount)} records</span><Show when={agent().usage.requests}><span>{usageCost(agent().usage)} est.</span></Show><span class="subagent-source" title={agent().cwd}>{agent().cwd || "Working directory not recorded"}</span></div>}</Show>
      <div class="subagent-preview-actions"><span>Conversation preview · Full session has search and filters</span><Show when={agent()}>{agent => <a class="secondary-button" href={props.href(agent().id)} onClick={event => props.follow(event, agent().id)}>Open full session<Icon name="arrow" size={14} /></a>}</Show></div>
    </div>
    <div class="subagent-transcript" ref={transcript} aria-label="Subagent transcript" aria-busy={pending() ? "true" : "false"} tabindex="0">
      <Show when={error()}><div class="error-banner" role="alert">{error()}<button class="text-button" onClick={() => setRetry(value => value + 1)}>Retry</button></div></Show>
      <Show when={pending() && !page()}><p class="subagent-status" role="status">Loading recording…</p></Show>
      <For each={visibleEvents()}>{event => <EventCard event={event} results={page()?.results} showWorkspace={false} linkEvents={false} />}</For>
      <Show when={!pending() && !error() && !page()?.items.length}><p class="subagent-status">No conversation events are available yet. Open the full session to inspect all recorded events.</p></Show>
    </div>
    <footer class="subagent-dialog-footer"><span>Read-only preview · Your current session stays in place</span><div class="pagination">
      <button class="icon-button" aria-label="Previous subagent events" disabled={pending() || !offset()} onClick={() => changePage(Math.max(0, offset() - 40))}><Icon name="back" size={16} /></button>
      <span aria-live="polite">{page()?.total ? `${page()!.offset + 1}–${page()!.offset + page()!.items.length} of ${page()!.total}` : "—"} conversation records</span>
      <button class="icon-button" aria-label="Next subagent events" disabled={pending() || !page() || offset() + 40 >= page()!.total} onClick={() => changePage(offset() + 40)}><Icon name="arrow" size={16} /></button>
    </div></footer>
  </dialog>;
}
