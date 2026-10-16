import { createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Catalog, WorkspaceGroup } from "../../shared/types";
import { request } from "../lib/api";
import { rememberFocus } from "../lib/dismissable";
import { sourceFolders } from "../lib/workspaces";
import { Icon } from "./icon";

export function WorkspaceDialog(props: { catalog: Catalog; onClose: () => void; onSaved: () => void; onUngrouped: (group: WorkspaceGroup) => void; children: JSX.Element }) {
  let dialog!: HTMLDialogElement;
  let filterInput!: HTMLInputElement;
  const restore = rememberFocus();
  const [name, setName] = createSignal("");
  const [paths, setPaths] = createSignal<string[]>([]);
  const [editing, setEditing] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  const sources = () => sourceFolders(props.catalog.workspaces, filter());
  const total = () => props.catalog.workspaces.reduce((count, workspace) => count + workspace.paths.length, 0);
  onSettled(() => { dialog.showModal(); return () => restore(dialog); });
  const clearFilter = () => { setFilter(""); filterInput.focus(); };
  const reset = () => { setName(""); setPaths([]); setEditing(""); setError(""); setFilter(""); };
  const edit = (group: WorkspaceGroup) => { setName(group.name); setPaths([...group.paths]); setEditing(group.id); setError(""); setFilter(""); };
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await request("/api/groups", { method: "POST", body: JSON.stringify({ id: editing() || undefined, name: name(), paths: paths() }) });
      props.onSaved(); reset();
    } catch (error) { setError(String(error instanceof Error ? error.message : error)); }
    finally { setSaving(false); }
  };
  const remove = async (group: WorkspaceGroup) => {
    setSaving(true); setError("");
    try {
      await request(`/api/groups/${group.id}`, { method: "DELETE", body: "{}" });
      props.onUngrouped(group); reset();
      // The Ungroup button left with its row, so focus moves to the toast's Undo instead of falling out of the dialog.
      requestAnimationFrame(() => {
        if (dialog.open && (!dialog.contains(document.activeElement) || document.activeElement === dialog)) dialog.querySelector<HTMLElement>(".toast-action")?.focus();
      });
    } catch (error) { setError(String(error instanceof Error ? error.message : error)); }
    finally { setSaving(false); }
  };
  return <dialog ref={dialog} class="workspace-dialog" onClose={props.onClose} aria-label="Group workspaces">
    <div class="dialog-heading"><span class="dialog-symbol"><Icon name="merge" size={22} /></span><button class="icon-button" aria-label="Close workspace settings" onClick={() => dialog.close()}><Icon name="close" /></button></div>
    <p class="eyebrow">ONE PROJECT. EVERY PERSPECTIVE.</p>
    <h2 id="workspace-title">Bring your workspaces together.</h2>
    <p class="muted">Combine worktrees and clones in one history. Original folders stay visible, and your files never move.</p>
    <Show when={props.catalog.groups.length}>
      <div class="existing-groups"><h3>Your workspace groups</h3><For each={props.catalog.groups}>{group => <div class="existing-group" data-group-id={group.id}><span><strong>{group.name}</strong><small>{group.paths.length} source folders</small></span><button class="text-button" disabled={saving()} onClick={() => edit(group)}>Edit</button><button class="text-button ungroup-button" disabled={saving()} onClick={() => void remove(group)}>Ungroup</button></div>}</For></div>
    </Show>
    <form onSubmit={save}>
      <label class="field-label" for="group-name">{editing() ? "Edit group name" : "New group name"}</label>
      <input id="group-name" placeholder="e.g. Orbit, across all worktrees" value={name()} onInput={event => setName(event.currentTarget.value)} maxlength={80} required />
      <div class="field-label source-label"><span>Source folders</span><span>{filter().trim() ? `${sources().length} of ${total()} match · ` : ""}{paths().length} selected</span></div>
      <div class="search-box source-filter"><Icon name="search" size={16} />
        <input ref={filterInput} type="search" aria-label="Filter source folders" placeholder="Filter by folder path…" autocomplete="off" value={filter()} onInput={event => setFilter(event.currentTarget.value)} onKeyDown={event => {
          // Escape clears the filter before it can close the dialog, and Enter must not create the group from a filter keystroke.
          if (event.key === "Escape" && filter()) { event.preventDefault(); event.stopPropagation(); setFilter(""); }
          if (event.key === "Enter") event.preventDefault();
        }} />
        <Show when={filter()}><button type="button" class="icon-button tiny" aria-label="Clear folder filter" onClick={clearFilter}><Icon name="close" size={14} /></button></Show>
      </div>
      <div class="source-options"><For each={sources()}>{source => <label class={['source-option', { disabled: Boolean(source.group && source.group !== editing()) }]}>
        <input type="checkbox" disabled={Boolean(source.group && source.group !== editing())} checked={paths().includes(source.path)} onChange={event => setPaths(current => event.currentTarget.checked ? [...current, source.path] : current.filter(path => path !== source.path))} />
        <Icon name="folder" /><span>{source.path || "Unknown source"}<Show when={source.group && source.group !== editing()}><small>Already grouped</small></Show></span>
      </label>}</For><Show when={!sources().length}><div class="source-empty" role="status"><span>{filter().trim() ? `No folders match “${filter().trim()}”.` : "No recorded folders yet."}</span><Show when={filter().trim()}><button type="button" class="text-button" onClick={clearFilter}>Clear filter</button></Show></div></Show></div>
      <Show when={error()}><p role="alert" class="error-text">{error()}</p></Show>
      <div class="dialog-footer"><span><Icon name="shield" size={14} /> A reversible, local-only view</span><Show when={editing()}><button type="button" class="text-button" onClick={reset}>Cancel edit</button></Show><button type="submit" class="primary-button" disabled={saving() || paths().length < 2 || !name().trim()}>{saving() ? "Saving…" : editing() ? "Save group" : "Create group"}<Icon name="arrow" size={16} /></button></div>
    </form>
    {props.children}
  </dialog>;
}
