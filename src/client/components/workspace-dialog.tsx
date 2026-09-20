import { createSignal, For, onSettled, Show } from "solid-js";
import type { Catalog, WorkspaceGroup } from "../../shared/types";
import { request } from "../lib/api";
import { Icon } from "./icon";

export function WorkspaceDialog(props: { catalog: Catalog; onClose: () => void; onSaved: () => void }) {
  let dialog!: HTMLDialogElement;
  const [name, setName] = createSignal("");
  const [paths, setPaths] = createSignal<string[]>([]);
  const [editing, setEditing] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const sources = () => props.catalog.workspaces.flatMap(workspace => workspace.paths.map(path => ({ path, group: workspace.grouped ? workspace.id : "" }))).sort((left, right) => left.path.localeCompare(right.path));
  onSettled(() => { dialog.showModal(); });
  const reset = () => { setName(""); setPaths([]); setEditing(""); setError(""); };
  const edit = (group: WorkspaceGroup) => { setName(group.name); setPaths([...group.paths]); setEditing(group.id); setError(""); };
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await request("/api/groups", { method: "POST", body: JSON.stringify({ id: editing() || undefined, name: name(), paths: paths() }) });
      props.onSaved(); reset();
    } catch (error) { setError(String(error instanceof Error ? error.message : error)); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    setSaving(true); setError("");
    try {
      await request(`/api/groups/${id}`, { method: "DELETE", body: "{}" });
      props.onSaved(); reset();
    } catch (error) { setError(String(error instanceof Error ? error.message : error)); }
    finally { setSaving(false); }
  };
  return <dialog ref={dialog} class="workspace-dialog" onClose={props.onClose} onCancel={props.onClose} aria-label="Group workspaces">
    <div class="dialog-heading"><span class="dialog-symbol"><Icon name="merge" size={22} /></span><button class="icon-button" aria-label="Close workspace settings" onClick={() => dialog.close()}><Icon name="close" /></button></div>
    <p class="eyebrow">ONE PROJECT. EVERY PERSPECTIVE.</p>
    <h2 id="workspace-title">Bring your workspaces together.</h2>
    <p class="muted">Combine worktrees and clones in one history. Original folders stay visible, and your files never move.</p>
    <Show when={props.catalog.groups.length}>
      <div class="existing-groups"><h3>Your workspace groups</h3><For each={props.catalog.groups}>{group => <div class="existing-group"><span><strong>{group.name}</strong><small>{group.paths.length} source folders</small></span><button class="text-button" disabled={saving()} onClick={() => edit(group)}>Edit</button><button class="text-button" disabled={saving()} onClick={() => void remove(group.id)}>Ungroup</button></div>}</For></div>
    </Show>
    <form onSubmit={save}>
      <label class="field-label" for="group-name">{editing() ? "Edit group name" : "New group name"}</label>
      <input id="group-name" placeholder="e.g. Orbit, across all worktrees" value={name()} onInput={event => setName(event.currentTarget.value)} maxlength={80} required />
      <div class="field-label source-label"><span>Source folders</span><span>{paths().length} selected</span></div>
      <div class="source-options"><For each={sources()}>{source => <label class={['source-option', { disabled: Boolean(source.group && source.group !== editing()) }]}>
        <input type="checkbox" disabled={Boolean(source.group && source.group !== editing())} checked={paths().includes(source.path)} onChange={event => setPaths(current => event.currentTarget.checked ? [...current, source.path] : current.filter(path => path !== source.path))} />
        <Icon name="folder" /><span>{source.path || "Unknown source"}<Show when={source.group && source.group !== editing()}><small>Already grouped</small></Show></span>
      </label>}</For></div>
      <Show when={error()}><p role="alert" class="error-text">{error()}</p></Show>
      <div class="dialog-footer"><span><Icon name="shield" size={14} /> A reversible, local-only view</span><Show when={editing()}><button type="button" class="text-button" onClick={reset}>Cancel edit</button></Show><button type="submit" class="primary-button" disabled={saving() || paths().length < 2 || !name().trim()}>{saving() ? "Saving…" : editing() ? "Save group" : "Create group"}<Icon name="arrow" size={16} /></button></div>
    </form>
  </dialog>;
}
