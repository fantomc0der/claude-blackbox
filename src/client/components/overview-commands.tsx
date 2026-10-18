import { createSignal, For, Show } from "solid-js";
import type { SessionSummary, SummaryCommand, SummaryCommandGroup, SummaryRecord, SummaryRun } from "../../shared/types";
import { formatEventTime, truncate } from "../lib/content";
import { decisionLabels } from "../../shared/decisions";
import { Icon } from "./icon";

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
const hiddenText = "Opens in All events, because the current view hides it.";
const hiddenNote = (record: SummaryRecord) => record.position === null ? ` ${hiddenText}` : "";
const HiddenNote = (props: { record: SummaryRecord }) => <Show when={props.record.position === null}><span class="visually-hidden"> {hiddenText}</span></Show>;
let runLists = 0;

/** What a run's result records, as the run list labels it: "" for a plain success. */
function runOutcome(run: SummaryRun): string {
  if (run.decision) return decisionLabels[run.decision].toLowerCase();
  if (run.error) return "error";
  if (run.pending) return "no result";
  return run.background ? "background" : "";
}

/** The outcome's glyph, from the transcript's set: "!" for a failure, "⊘" for a stopped run, "→" for one without an outcome. */
function runGlyph(run: SummaryRun): { glyph: string; tone: string } {
  if (run.decision) return { glyph: "⊘", tone: "stopped" };
  if (run.error) return { glyph: "!", tone: "error" };
  return { glyph: run.pending || run.background ? "→" : "✓", tone: "" };
}

function runPhrase(run: SummaryRun, subject: string): string {
  if (run.decision) return `${subject} was stopped: ${decisionLabels[run.decision].toLowerCase()}.`;
  if (run.error) return `${subject} had an error.`;
  if (run.pending) return `${subject} has no result.`;
  return run.background ? `${subject} started in the background.` : `${subject} succeeded.`;
}

/** The overview rail's Commands run view: shell commands deduplicated and grouped by program, with their searches. */
export function OverviewCommands(props: { summary: SessionSummary | null; failed: boolean; retry: () => void; show: (record: SummaryRecord) => void; selected: string }) {
  // Rows are keyed by their command's text and scope, which a refreshed summary keeps, so an open run list stays open.
  const keyOf = (command: SummaryCommand) => `${command.text}\n${command.detail}`;
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const toggle = (command: SummaryCommand) => setExpanded(current => {
    const next = new Set(current);
    const key = keyOf(command);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  // Each row opens its last run, since the final attempt answers whether a command worked; the first run only says when
  // the work began.
  const Row = (noun: string) => (command: () => SummaryCommand) => {
    const listId = `overview-runs-${++runLists}`;
    const open = () => expanded().has(keyOf(command()));
    const last = () => command().runs.at(-1)!;
    const secondary = () => [command().lead, command().lines > 1 ? `+${plural(command().lines - 1, "line")}` : ""].filter(Boolean).join(" · ") || command().detail;
    const subject = () => command().count > 1 ? `Last ${noun}` : `The ${noun}`;
    const name = () => `${truncate(command().head, 100)}${command().detail ? ` in ${command().detail}` : ""}, ${plural(command().count, noun)}${command().errors ? `, ${plural(command().errors, "error")}` : ""}${command().stopped ? `, ${command().stopped.toLocaleString()} stopped` : ""}. ${runPhrase(last(), subject())} Show the ${command().count > 1 ? "last " : ""}${noun}.${hiddenNote(last())}`;
    return <li class={['overview-file', 'overview-command', { selected: command().runs.some(run => run.id === props.selected) }]}>
      <button class="overview-file-open" title={command().detail ? `${command().text}\n${command().detail}` : command().text} aria-label={name()} onClick={() => props.show(last())}>
        <span class={['overview-run-glyph', runGlyph(last()).tone]} aria-hidden="true">{runGlyph(last()).glyph}</span>
        <span class="overview-file-name">{command().head}</span>
        <span class="overview-file-count" aria-hidden="true">{command().count.toLocaleString()}</span>
        <Show when={secondary()}><span class="overview-file-dir">{secondary()}</span></Show>
        <Show when={command().errors || command().stopped}><span class="overview-file-outcome" aria-hidden="true"><Show when={command().errors}><span class="overview-file-error">{plural(command().errors, "error")}</span></Show><Show when={command().stopped}><span class="overview-file-stopped">{command().stopped.toLocaleString()} stopped</span></Show></span></Show>
      </button>
      <Show when={command().runs.length > 1}>
        <button class="icon-button tiny overview-file-toggle" aria-expanded={open() ? "true" : "false"} aria-controls={open() ? listId : undefined} aria-label={`${noun === "run" ? "Runs" : "Searches"} of ${truncate(command().head, 100)}`} title={open() ? `Hide the ${noun}s` : `List each ${noun}`} onClick={() => toggle(command())}><Icon name="down" size={14} /></button>
      </Show>
      <Show when={open()}>
        <ol class="overview-changes" id={listId} aria-label={`${noun === "run" ? "Runs" : "Searches"} of ${truncate(command().head, 100)}`}>
          <For each={command().runs} keyed={run => run.id}>{run => <li>
            <button aria-current={run().id === props.selected ? "true" : undefined} title={run().position === null ? hiddenText : undefined} onClick={() => props.show(run())}>
              <span>{formatEventTime(run().timestamp)}</span><Show when={runOutcome(run())}>{outcome => <>{" "}<span aria-hidden="true">·</span>{" "}<span class={run().error ? "overview-file-error" : run().decision ? "overview-file-stopped" : ""}>{outcome()}</span></>}</Show><HiddenNote record={run()} />
            </button>
          </li>}</For>
        </ol>
      </Show>
    </li>;
  };
  const CommandRow = Row("run");
  const SearchRow = Row("search");

  const Tally = (props: { group: SummaryCommandGroup; noun: string }) => <p class="overview-provenance">
    <span>{plural(props.group.count, props.noun)}</span>
    <Show when={props.group.errors}><span class="meta-dot" aria-hidden="true">·</span><span class="overview-file-error">{plural(props.group.errors, "error")}</span></Show>
    <Show when={props.group.stopped}><span class="meta-dot" aria-hidden="true">·</span><span class="overview-file-stopped">{props.group.stopped.toLocaleString()} stopped</span></Show>
  </p>;

  const failure = () => <p class="overview-status" role="status">{props.summary ? "Couldn’t refresh the commands for this view." : "Couldn’t load the commands for this recording."}<button class="text-button" onClick={props.retry}>Retry</button></p>;

  return <nav class="overview-files overview-commands" aria-label="Commands run in this recording">
    <Show when={props.summary} fallback={<Show when={props.failed} fallback={<div class="overview-loading" role="status"><span class="visually-hidden">Loading commands…</span><div class="skeleton-row" /><div class="skeleton-row" /><div class="skeleton-row" /></div>}>{failure()}</Show>}>{summary => <>
      <Show when={props.failed}>{failure()}</Show>
      <p class="overview-scope">Whole recording<Show when={summary().commandRuns}> · {plural(summary().commandRuns, "run")} of {plural(summary().commandCount, "command")}</Show></p>
      <Show when={!summary().commandRuns}><p class="overview-empty">No shell commands recorded.</p></Show>
      <For each={summary().commands} keyed={group => group.name}>{group => <section class="overview-folder" aria-label={group().name === "Other" ? "Other commands" : `Commands starting with ${group().name}`}>
        <h3><Icon name="terminal" size={14} /><span>{group().name}</span></h3>
        <Tally group={group()} noun="run" />
        <ul class="overview-file-list"><For each={group().commands} keyed={keyOf}>{CommandRow}</For></ul>
      </section>}</For>
      <Show when={summary().searches.length}>
        <details class="overview-reads overview-searches">
          <summary><Icon name="chevron" size={13} />Searches · {summary().searchCount.toLocaleString()}</summary>
          <For each={summary().searches} keyed={group => group.name}>{group => <section class="overview-folder" aria-label={`${group().name} searches`}>
            <h3><Icon name="search" size={14} /><span>{group().name}</span></h3>
            <Tally group={group()} noun="search" />
            <ul class="overview-file-list"><For each={group().commands} keyed={keyOf}>{SearchRow}</For></ul>
          </section>}</For>
        </details>
      </Show>
      <Show when={summary().limited}><p class="overview-note">Very long recordings show a shortened list of programs, commands, and runs.</p></Show>
      <p class="overview-note">From Bash and PowerShell calls in this recording. A recorded error means the call failed; a call that succeeded isn’t proof the command did, such as one whose output was piped elsewhere or one run in the background. Commands run by subagents aren’t listed.</p>
    </>}</Show>
  </nav>;
}
