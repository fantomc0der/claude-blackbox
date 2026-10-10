import { createEffect, createSignal, For, Show } from "solid-js";
import type { Session, SessionFamily } from "../../shared/types";
import { Icon } from "./icon";

export function SessionFamilyNavigation(props: {
  session: Session;
  family: SessionFamily | null;
  pending: boolean;
  error: string;
  retry: () => void;
  href: (id: string, event?: string | null) => string;
  follow: (event: MouseEvent, id: string, anchor?: string | null) => void;
  open: (id: string) => void;
  preview: (id: string) => void;
}) {
  const [jump, setJump] = createSignal<HTMLSelectElement>();
  const current = () => props.family?.members.find(member => member.session.id === props.session.id);
  const root = () => props.family?.members.find(member => member.session.id === props.family?.rootId);
  const parent = () => props.family?.members.find(member => member.session.id === current()?.parentId);
  const agents = () => props.family?.members.filter(member => member.session.isAgent) || [];
  createEffect(() => ({ element: jump(), id: props.session.id, members: props.family?.members }), state => {
    if (state.element) state.element.value = state.id;
  });
  return <Show when={props.session.isAgent || agents().length || props.error}>
    <nav class="session-family" aria-label="Session family" aria-busy={props.pending ? "true" : "false"}>
      <div class="session-lineage">
        <Show when={props.session.isAgent} fallback={<span class="family-role">Main session</span>}>
          <Show when={root()} fallback={<span class="family-note">{props.pending ? "Finding main session…" : props.error ? "Session relationships unavailable" : "Main session not found in this archive"}</span>}>{member =>
            <a href={props.href(member().session.id)} onClick={event => props.follow(event, member().session.id)} title={member().session.title}>Main session: <span>{member().session.title}</span></a>
          }</Show>
          <Show when={parent()?.session.id !== props.family?.rootId ? parent() : undefined}>{member =>
            <a href={props.href(member().session.id)} onClick={event => props.follow(event, member().session.id)} title={member().label}>Parent: <span>{member().label}</span></a>
          }</Show>
          <Show when={current()?.spawnEventId && current()?.parentId}>
            <a href={props.href(current()!.parentId!, current()!.spawnEventId)} onClick={event => props.follow(event, current()!.parentId!, current()!.spawnEventId)}>Originating tool call<Icon name="arrow" size={12} /></a>
          </Show>
        </Show>
      </div>
      <Show when={(props.family?.members.length || 0) > 1}>
        <div class="family-controls">
          <label class="family-jump"><span>Related sessions</span><select ref={setJump} aria-label="Jump to related session" value={props.session.id} onChange={event => props.open(event.currentTarget.value)}>
            <For each={props.family?.members}>{member => <option value={member.session.id}>{member.session.isAgent ? member.depth && member.depth > 1 ? `Nested subagent · ${member.label}` : `Subagent · ${member.label}` : `Main · ${member.label}`}</option>}</For>
          </select></label>
          <button class="secondary-button subagent-access" onClick={() => props.preview(props.session.isAgent ? props.session.id : agents()[0]?.session.id || "")}><Icon name="branch" size={15} />{props.session.isAgent ? "Session family" : "Subagents"} <span>{props.session.isAgent ? props.family?.members.length : agents().length}{props.family?.limited ? "+" : ""}</span></button>
        </div>
      </Show>
      <Show when={props.family?.limited}><p class="family-note">Large session family: this list is partial. Use archive search to find other recordings.</p></Show>
      <Show when={props.error}><div class="family-error" role="status">Could not load related recordings. <button class="text-button" onClick={props.retry}>Retry session family</button></div></Show>
    </nav>
  </Show>;
}
