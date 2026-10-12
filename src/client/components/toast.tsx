import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";
import { Icon } from "./icon";

export type Notice = { message: string; error?: boolean; action?: { label: string; run: () => void } };

// A notice that offers an action, or explains a failure, stays long enough to read and act on; hovering it or giving
// it keyboard focus holds it open (see the hold callback), and the full duration restarts once the pointer and focus
// leave.
export const noticeDuration = (notice: Notice) => notice.action || notice.error ? 10_000 : 4_200;

// The app renders one Toast at its root and the grouping dialog renders another inside itself, because a modal dialog
// makes everything outside it inert. Only one is mounted at a time. Its polite status region stays mounted while the
// host does, so a screen reader hears each new message and the action it offers, but not the message it inherits
// when it moves between hosts.
export function Toast(props: { notice: Notice | null; hold: (held: boolean) => void }) {
  const [spoken, setSpoken] = createSignal("");
  let hovered = false, focused = false;
  const update = () => props.hold(hovered || focused);
  let mounted = false;
  createEffect(() => props.notice, notice => {
    if (!mounted) { mounted = true; return; }
    setSpoken(!notice ? "" : notice.action ? `${notice.message}. ${notice.action.label} is available.` : notice.message);
  });
  createEffect(() => Boolean(props.notice), present => { if (!present && (hovered || focused)) { hovered = focused = false; update(); } });
  onCleanup(() => { if (hovered || focused) untrack(() => props.hold(false)); });
  return <>
    <div class="visually-hidden toast-announcement" role="status" aria-live="polite" aria-atomic="true">{spoken()}</div>
    <Show when={props.notice}>{notice => {
      let box!: HTMLDivElement;
      return <div ref={box} class={['toast', { 'toast-error': Boolean(notice().error) }]}
        onPointerEnter={() => { hovered = true; update(); }}
        onPointerLeave={() => { hovered = false; update(); }}
        onFocusIn={event => { focused = event.target instanceof HTMLElement && event.target.matches(":focus-visible"); update(); }}
        onFocusOut={event => { if (!(event.relatedTarget instanceof Node && box.contains(event.relatedTarget))) { focused = false; update(); } }}>
        <Icon name={notice().error ? "alert" : "check"} size={16} /><span>{notice().message}</span>
        <Show when={notice().action}>{action => <button type="button" class="toast-action" onClick={() => action().run()}>{action().label}</button>}</Show>
      </div>;
    }}</Show>
  </>;
}
