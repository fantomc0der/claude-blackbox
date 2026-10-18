import { createSignal, For, Show } from "solid-js";
import type { SessionSummary, SummaryCommand, SummaryCommandCategory, SummaryCommandGroup, SummaryRecord, SummaryRun } from "../../shared/types";
import { formatEventTime, truncate } from "../lib/content";
import { decisionLabels } from "../../shared/decisions";
import { Icon } from "./icon";

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : word.endsWith("ch") ? "es" : "s"}`;
const categories = [
  { key: "language", label: "Language & build tools" },
  { key: "network", label: "Network" },
  { key: "other", label: "Other commands" },
] as const;
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
  // Rows keep their full-input identity across refreshes, even when their displayed text and detail are capped.
  const keyOf = (command: SummaryCommand) => command.key;
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
    const secondary = () => command().lines > 1 ? `+${plural(command().lines - 1, "line")}` : command().detail;
    const listName = () => `${noun === "run" ? "Runs" : noun === "fetch" ? "Fetches" : "Searches"} of ${truncate(command().head, 100)}`;
    const subject = () => command().count > 1 ? `Last ${noun}` : `The ${noun}`;
    const name = () => `${truncate(command().head, 100)}${command().detail ? `${noun === "fetch" ? ": " : " in "}${command().detail}` : ""}, ${plural(command().count, noun)}${command().errors ? `, ${plural(command().errors, "error")}` : ""}${command().stopped ? `, ${command().stopped.toLocaleString()} stopped` : ""}. ${runPhrase(last(), subject())} Show the ${command().count > 1 ? "last " : ""}${noun}.${hiddenNote(last())}`;
    return <li class={['overview-file', 'overview-command', { selected: command().runs.some(run => run.id === props.selected) }]}>
      <button class="overview-file-open" title={command().detail ? `${command().text}\n${command().detail}` : command().text} aria-label={name()} onClick={() => props.show(last())}>
        <span class={['overview-run-glyph', runGlyph(last()).tone]} aria-hidden="true">{runGlyph(last()).glyph}</span>
        <span class="overview-file-name">{command().head}</span>
        <span class="overview-file-count" aria-hidden="true">{command().count.toLocaleString()}</span>
        <Show when={secondary()}><span class="overview-file-dir">{secondary()}</span></Show>
        <Show when={command().errors || command().stopped}><span class="overview-file-outcome" aria-hidden="true"><Show when={command().errors}><span class="overview-file-error">{plural(command().errors, "error")}</span></Show><Show when={command().stopped}><span class="overview-file-stopped">{command().stopped.toLocaleString()} stopped</span></Show></span></Show>
      </button>
      <Show when={command().runs.length > 1}>
        <button class="icon-button tiny overview-file-toggle" aria-expanded={open() ? "true" : "false"} aria-controls={open() ? listId : undefined} aria-label={listName()} title={open() ? "Hide the list" : `List each ${noun}`} onClick={() => toggle(command())}><Icon name="down" size={14} /></button>
      </Show>
      <Show when={open()}>
        <ol class="overview-changes" id={listId} aria-label={listName()}>
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
  const FetchRow = Row("fetch");

  const Tally = (props: { group: SummaryCommandGroup; noun: string }) => <p class="overview-provenance">
    <span>{plural(props.group.count, props.noun)}</span>
    <Show when={props.group.errors}><span class="meta-dot" aria-hidden="true">·</span><span class="overview-file-error">{plural(props.group.errors, "error")}</span></Show>
    <Show when={props.group.stopped}><span class="meta-dot" aria-hidden="true">·</span><span class="overview-file-stopped">{props.group.stopped.toLocaleString()} stopped</span></Show>
  </p>;

  const groups = (category: SummaryCommandCategory) => props.summary?.commands.filter(group => group.category === category) ?? [];
  const Program = (props: { group: SummaryCommandGroup }) => <section class="overview-folder" aria-label={`Commands starting with ${props.group.name}`}>
    <h3><Icon name="terminal" size={14} /><span>{props.group.name}</span></h3>
    <Tally group={props.group} noun="run" />
    <ul class="overview-file-list"><For each={props.group.commands} keyed={keyOf}>{CommandRow}</For></ul>
  </section>;
  const Category = (category: { key: SummaryCommandCategory; label: string }) => {
    const shell = () => groups(category.key);
    const fetches = () => category.key === "network" ? props.summary?.fetches ?? [] : [];
    const count = () => shell().reduce((total, group) => total + group.count, 0);
    const fetched = () => fetches().reduce((total, group) => total + group.count, 0);
    const errors = () => [...shell(), ...fetches()].reduce((total, group) => total + group.errors, 0);
    const stopped = () => [...shell(), ...fetches()].reduce((total, group) => total + group.stopped, 0);
    return <Show when={shell().length || fetches().length}>
      <details class="overview-reads overview-searches overview-command-category" aria-label={category.label}>
        <summary>
          <Icon name="chevron" size={13} /><span>{category.label}</span>
          <span class="overview-category-tally">
            <span>{[count() ? plural(count(), "run") : "", fetched() ? plural(fetched(), "fetch") : ""].filter(Boolean).join(" · ")}</span>
            <Show when={errors()}><span class="overview-file-error"> · {plural(errors(), "error")}</span></Show>
            <Show when={stopped()}><span class="overview-file-stopped"> · {stopped().toLocaleString()} stopped</span></Show>
          </span>
        </summary>
        <Show when={category.key === "other"} fallback={<For each={shell()} keyed={group => group.name}>{group => <Program group={group()} />}</For>}>
          <p class="overview-note overview-category-note">Chains, pipelines, scripts, and commands without a clear single program. Previews keep the recorded first line; select one to see the full call.</p>
          <For each={shell()} keyed={group => group.name}>{group => <ul class="overview-file-list"><For each={group().commands} keyed={keyOf}>{CommandRow}</For></ul>}</For>
        </Show>
        <For each={fetches()} keyed={group => group.name}>{group => <section class="overview-folder" aria-label={`${group().name} fetches`}>
          <h3><Icon name="terminal" size={14} /><span>{group().name}</span></h3>
          <Tally group={group()} noun="fetch" />
          <ul class="overview-file-list"><For each={group().commands} keyed={keyOf}>{FetchRow}</For></ul>
        </section>}</For>
      </details>
    </Show>;
  };

  const failure = () => <p class="overview-status" role="status">{props.summary ? "Couldn’t refresh the commands for this view." : "Couldn’t load the commands for this recording."}<button class="text-button" onClick={props.retry}>Retry</button></p>;

  return <nav class="overview-files overview-commands" aria-label="Commands run in this recording">
    <Show when={props.summary} fallback={<Show when={props.failed} fallback={<div class="overview-loading" role="status"><span class="visually-hidden">Loading commands…</span><div class="skeleton-row" /><div class="skeleton-row" /><div class="skeleton-row" /></div>}>{failure()}</Show>}>{summary => <>
      <Show when={props.failed}>{failure()}</Show>
      <p class="overview-scope">Whole recording<Show when={summary().commandRuns}> · {plural(summary().commandRuns, "run")} of {plural(summary().commandCount, "command")}</Show></p>
      <Show when={!summary().commandRuns}><p class="overview-empty">No shell commands recorded.</p></Show>
      <For each={groups("shell")} keyed={group => group.name}>{group => <Program group={group()} />}</For>
      <For each={categories} keyed={category => category.key}>{category => <Category key={category().key} label={category().label} />}</For>
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
      <p class="overview-note">Shell counts cover Bash and PowerShell calls only; searches and WebFetch calls are listed separately. A recorded error means the call failed; a call that succeeded isn’t proof the command did, such as one whose output was piped elsewhere or one run in the background. Commands run by subagents aren’t listed.</p>
    </>}</Show>
  </nav>;
}
