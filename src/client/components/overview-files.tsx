import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { SessionSummary, SummaryFile, SummaryRead, SummaryRecord } from "../../shared/types";
import { formatEventTime } from "../lib/content";
import { folderLabels, folderName } from "../lib/format";
import { revealSelected } from "../lib/overview-reveal";
import { decisionLabels } from "../../shared/decisions";
import { Icon } from "./icon";

function splitPath(display: string): { name: string; dir: string } {
  const split = Math.max(display.lastIndexOf("/"), display.lastIndexOf("\\"));
  return { name: display.slice(split + 1) || display, dir: split > 0 ? display.slice(0, split) : "" };
}

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
const clockTime = (timestamp: string) => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
};
const hiddenText = "Opens in All events, because the current view hides it.";
const hiddenNote = (record: SummaryRecord) => record.position === null ? ` ${hiddenText}` : "";
const HiddenNote = (props: { record: SummaryRecord }) => <Show when={props.record.position === null}><span class="visually-hidden"> {hiddenText}</span></Show>;
let changeLists = 0;

/** The overview rail's Files changed view: changed files grouped under the folders the recording worked in. */
export function OverviewFiles(props: { summary: SessionSummary | null; failed: boolean; retry: () => void; show: (record: SummaryRecord) => void; selected: ReadonlySet<string> }) {
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  // A file is selected when one of its changes, or its first read, is the selected event; a selection made elsewhere
  // is brought into view once the list exists.
  const isSelected = (file: SummaryFile) => file.changes.some(change => props.selected.has(change.id));
  let rail!: HTMLElement;
  createEffect(() => props.summary && props.selected, (selected, previous) => { if (selected && selected !== previous) revealSelected(rail); });
  const toggle = (path: string) => setExpanded(current => {
    const next = new Set(current);
    if (!next.delete(path)) next.add(path);
    return next;
  });
  const labels = createMemo(() => folderLabels(props.summary?.folders.map(folder => folder.path) || []));
  const label = (path: string) => labels().get(path) ?? folderName(path);
  // One scratchpad lists its files as they are; several tell their files apart by the directories that differ.
  const scratchFiles = createMemo(() => {
    const scratchpads = props.summary?.scratchpads || [];
    if (scratchpads.length < 2) return scratchpads[0]?.files || [];
    const names = folderLabels(scratchpads.map(scratchpad => scratchpad.path));
    return scratchpads.flatMap(scratchpad => scratchpad.files.map(file => ({ ...file, display: `${names.get(scratchpad.path)}${scratchpad.path.includes("\\") ? "\\" : "/"}${file.display}` })));
  });

  const FileRow = (file: () => SummaryFile) => {
    const listId = `overview-changes-${++changeLists}`;
    const parts = () => splitPath(file().display);
    const open = () => expanded().has(file().path);
    const first = () => file().changes[0];
    const name = () => `${parts().name}${parts().dir ? ` in ${parts().dir}` : ""}, ${plural(file().count, "change")}${file().errors ? `, ${plural(file().errors, "error")}` : ""}${file().stopped ? `, ${file().stopped.toLocaleString()} stopped` : ""}. Show the ${file().count > 1 ? "first " : ""}change.${hiddenNote(first())}`;
    return <li class={['overview-file', { selected: isSelected(file()) }]}>
      <button class="overview-file-open" title={file().path} aria-label={name()} aria-current={isSelected(file()) ? "true" : undefined} onClick={() => props.show(first())}>
        <span class="overview-file-name">{parts().name}</span>
        <span class="overview-file-count" aria-hidden="true">{file().count.toLocaleString()}</span>
        <Show when={parts().dir}><span class="overview-file-dir">{parts().dir}</span></Show>
        <Show when={file().errors || file().stopped}><span class="overview-file-outcome" aria-hidden="true"><Show when={file().errors}><span class="overview-file-error">{plural(file().errors, "error")}</span></Show><Show when={file().stopped}><span class="overview-file-stopped">{file().stopped.toLocaleString()} stopped</span></Show></span></Show>
      </button>
      <Show when={file().changes.length > 1}>
        <button class="icon-button tiny overview-file-toggle" aria-expanded={open() ? "true" : "false"} aria-controls={open() ? listId : undefined} aria-label={`Changes to ${parts().name}`} title={open() ? "Hide the changes" : "List each change"} onClick={() => toggle(file().path)}><Icon name="down" size={14} /></button>
      </Show>
      <Show when={open()}>
        <ol class="overview-changes" id={listId} aria-label={`Changes to ${parts().name}`}>
          <For each={file().changes} keyed={change => change.id}>{change => <li>
            <button aria-current={props.selected.has(change().id) ? "true" : undefined} title={change().position === null ? hiddenText : undefined} onClick={() => props.show(change())}>
              <span>{change().tool}</span>{" "}<span aria-hidden="true">·</span>{" "}<span>{formatEventTime(change().timestamp)}</span><Show when={change().error}>{" "}<span class="overview-file-error">error</span></Show><Show when={change().decision}>{decision => <>{" "}<span class="overview-file-stopped">{decisionLabels[decision()].toLowerCase()}</span></>}</Show><HiddenNote record={change()} />
            </button>
          </li>}</For>
        </ol>
      </Show>
    </li>;
  };

  const ReadRow = (file: () => SummaryRead) => {
    const parts = () => splitPath(file().display);
    const dir = () => {
      if (!file().folder) return parts().dir;
      const separator = file().display.includes("\\") ? "\\" : "/";
      return [label(file().folder), parts().dir].filter(Boolean).join(separator);
    };
    return <li class={['overview-file', { selected: props.selected.has(file().id) }]}>
      <button class="overview-file-open" title={file().path} aria-label={`${parts().name}${dir() ? ` in ${dir()}` : ""}, ${plural(file().reads, "read")}. Show the first read.${hiddenNote(file())}`} aria-current={props.selected.has(file().id) ? "true" : undefined} onClick={() => props.show(file())}>
        <span class="overview-file-name">{parts().name}</span>
        <span class="overview-file-count" aria-hidden="true">{file().reads.toLocaleString()}</span>
        <Show when={dir()}><span class="overview-file-dir">{dir()}</span></Show>
      </button>
    </li>;
  };

  const failure = () => <p class="overview-status" role="status">{props.summary ? "Couldn’t refresh the files for this view." : "Couldn’t load the files for this recording."}<button class="text-button" onClick={props.retry}>Retry</button></p>;

  return <nav class="overview-files" aria-label="Files changed in this recording" ref={rail}>
    <Show when={props.summary} fallback={<Show when={props.failed} fallback={<div class="overview-loading" role="status"><span class="visually-hidden">Loading files…</span><div class="skeleton-row" /><div class="skeleton-row" /><div class="skeleton-row" /></div>}>{failure()}</Show>}>{summary => <>
      <Show when={props.failed}>{failure()}</Show>
      <p class="overview-scope">Whole recording · {plural(summary().folders.length, "folder")}</p>
      <Show when={!summary().changedFiles}><p class="overview-empty">No file changes recorded.</p></Show>
      <For each={summary().folders} keyed={folder => folder.path}>{folder => <section class="overview-folder" aria-label={`Folder ${folder().path}`}>
        <h3 title={folder().path}><Icon name="folder" size={14} /><span>{label(folder().path)}</span></h3>
        <p class="overview-provenance">
          <Show when={folder().working}>{record => <button class="text-button" title={`First recorded here ${formatEventTime(record().timestamp)}. Show that record.${hiddenNote(record())}`} onClick={() => props.show(record())}>Working directory<HiddenNote record={record()} /></button>}</Show>
          <Show when={folder().working && folder().added}><span class="meta-dot" aria-hidden="true">·</span></Show>
          <Show when={folder().added}>{record => <button class="text-button" title={`Added ${formatEventTime(record().timestamp)}. Show the /add-dir command.${hiddenNote(record())}`} onClick={() => props.show(record())}>Added with /add-dir<Show when={clockTime(record().timestamp)}>{time => <span class="overview-when">· {time()}</span>}</Show><HiddenNote record={record()} /></button>}</Show>
        </p>
        <Show when={folder().files.length} fallback={<Show when={summary().changedFiles}><p class="overview-none">No changes here</p></Show>}>
          <ul class="overview-file-list"><For each={folder().files} keyed={file => file.path}>{FileRow}</For></ul>
        </Show>
      </section>}</For>
      <Show when={summary().scratchpads.length}>
        <section class="overview-folder" aria-label="Scratchpads">
          <h3 title={summary().scratchpads.map(scratchpad => scratchpad.path).join("\n")}><Icon name="folder" size={14} /><span>Scratchpads</span></h3>
          <p class="overview-provenance"><span>Claude Code’s per-session temporary files</span></p>
          <ul class="overview-file-list"><For each={scratchFiles()} keyed={file => file.path}>{FileRow}</For></ul>
        </section>
      </Show>
      <Show when={summary().other.length}>
        <section class="overview-folder" aria-label="Other locations">
          <h3><Icon name="folder" size={14} /><span>Other locations</span></h3>
          <p class="overview-provenance"><span>Outside these folders</span></p>
          <ul class="overview-file-list"><For each={summary().other} keyed={file => file.path}>{FileRow}</For></ul>
        </section>
      </Show>
      <Show when={summary().read.length}>
        <details class={['overview-reads', { 'has-selected': summary().read.some(file => props.selected.has(file.id)) }]}>
          <summary><Icon name="chevron" size={13} /><span>Read, not changed · {summary().readFiles.toLocaleString()}</span></summary>
          <ul class="overview-file-list"><For each={summary().read} keyed={file => file.path}>{ReadRow}</For></ul>
        </details>
      </Show>
      <Show when={summary().limited}><p class="overview-note">Very long recordings show a shortened list of folders, files, and changes.</p></Show>
      <p class="overview-note">From Edit, Write, MultiEdit, and NotebookEdit calls in this recording. Changes made through shell commands or by subagents aren’t listed.</p>
    </>}</Show>
  </nav>;
}
