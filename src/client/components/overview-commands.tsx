import { createSignal, For, Show } from "solid-js";
import type { SessionSummary, SummaryCommand, SummaryCommandCategory, SummaryCommandGroup, SummaryRecord, SummaryRun } from "../../shared/types";
import { formatEventTime, truncate } from "../lib/content";
import { decisionLabels } from "../../shared/decisions";
import { Icon } from "./icon";

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : word.endsWith("ch") ? "es" : "s"}`;
const entryCount = (groups: SummaryCommandGroup[]) => groups.reduce((count, group) => count + group.commands.filter(command => !command.step).length, 0);
const stepCount = (group: SummaryCommandGroup) => group.commands.reduce((count, command) => count + (command.step ? command.count : 0), 0);
const categories = [
  { key: "source", label: "Source control" },
  { key: "files", label: "Files & text" },
  { key: "language", label: "Language & build tools" },
  { key: "network", label: "Network" },
  { key: "other", label: "Other commands" },
] as const;
const otherLabel = "Other commands";
const shownPrograms = 3;
const shownNames = 2;
const hiddenText = "Opens in All events, because the current view hides it.";
const hiddenNote = (record: SummaryRecord) => record.position === null ? ` ${hiddenText}` : "";
const HiddenNote = (props: { record: SummaryRecord }) => <Show when={props.record.position === null}><span class="visually-hidden"> {hiddenText}</span></Show>;
let runLists = 0;

/** "git and gh", "git, gh, and cat": the names of the groups a command is also listed under, as prose. */
const listNames = (names: string[]) => names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;

/** Where a step sits in its command: "step 2 of 3" on a one-line chain, "line 3 of 6" in a script. */
const stepPlace = (command: SummaryCommand) => command.lines > 1 ? `line ${command.step!.line} of ${command.lines}` : `step ${command.step!.step} of ${command.step!.steps}`;

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
  // Rows keep their full-input identity across refreshes, even when their displayed text and detail are capped. A
  // step row's identity adds its program, so each listing of a multi-step command opens and closes on its own.
  const keyOf = (command: SummaryCommand) => command.key;
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const toggle = (command: SummaryCommand) => setExpanded(current => {
    const next = new Set(current);
    const key = keyOf(command);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  // Each row opens its last run, since the final attempt answers whether a command worked; the first run only says when
  // the work began. A step row shows one call of a multi-step command, from that call to the end of its line, and
  // opens the same run as the command's Other row.
  const Row = (noun: string) => (command: () => SummaryCommand) => {
    const listId = `overview-runs-${++runLists}`;
    const open = () => expanded().has(keyOf(command()));
    const last = () => command().runs.at(-1)!;
    const head = () => command().head.startsWith("…") ? command().head.slice(1) : command().head;
    const also = () => command().also ?? [];
    const secondary = () => command().step ? stepPlace(command()) : command().lines > 1 ? `+${plural(command().lines - 1, "line")}` : command().detail;
    // The groups that also list a command sit on their own line, cut at whole names, so an outcome badge never hides them.
    const under = () => `also under ${also().slice(0, shownNames).join(", ")}${also().length > shownNames ? ` +${(also().length - shownNames).toLocaleString()} more` : ""}`;
    const listed = () => command().step ? ` ${stepPlace(command())} in a multi-step command also listed under ${listNames([otherLabel, ...also()])},` : also().length ? ` also listed under ${listNames(also())},` : "";
    const listName = () => `${noun === "run" ? "Runs" : noun === "fetch" ? "Fetches" : "Searches"} of ${truncate(head(), 100)}`;
    const subject = () => command().count > 1 ? `Last ${noun}` : `The ${noun}`;
    const name = () => `${truncate(head(), 100)}${command().detail ? `${noun === "fetch" ? ": " : " in "}${command().detail}` : ""},${listed()} ${plural(command().count, noun)}${command().errors ? `, ${plural(command().errors, "error")}` : ""}${command().stopped ? `, ${command().stopped.toLocaleString()} stopped` : ""}. ${runPhrase(last(), subject())} Show the ${command().count > 1 ? "last " : ""}${noun}.${hiddenNote(last())}`;
    const title = () => `${command().text}${command().detail ? `\n${command().detail}` : ""}${also().length ? `\nAlso listed under ${listNames(command().step ? [otherLabel, ...also()] : also())}` : command().step ? `\nAlso listed under ${otherLabel}` : ""}`;
    return <li class={['overview-file', 'overview-command', { selected: command().runs.some(run => run.id === props.selected), step: !!command().step }]}>
      <button class="overview-file-open" title={title()} aria-label={name()} onClick={() => props.show(last())}>
        <span class={['overview-run-glyph', runGlyph(last()).tone]} aria-hidden="true">{runGlyph(last()).glyph}</span>
        <span class="overview-file-name"><Show when={command().head.startsWith("…")}><span class="overview-step-ellipsis">…</span></Show>{head()}</span>
        <span class="overview-file-count" aria-hidden="true">{command().count.toLocaleString()}</span>
        <Show when={secondary()}><span class={['overview-file-dir', { 'overview-step-meta': !!command().step }]}><Show when={command().step}><Icon name="link" size={12} /></Show><span>{secondary()}</span></span></Show>
        <Show when={command().errors || command().stopped}><span class="overview-file-outcome" aria-hidden="true"><Show when={command().errors}><span class="overview-file-error">{plural(command().errors, "error")}</span></Show><Show when={command().stopped}><span class="overview-file-stopped">{command().stopped.toLocaleString()} stopped</span></Show></span></Show>
        <Show when={!command().step && also().length}><span class="overview-file-dir overview-file-also">{under()}</span></Show>
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

  const listLimited = (kind: "commands" | "searches" | "fetches") => {
    const summary = props.summary;
    if (!summary) return false;
    const total = kind === "commands" ? summary.commandCount : kind === "searches" ? summary.searchCount : summary.fetchCount;
    return total > entryCount(summary[kind]);
  };
  const hasOmissions = () => listLimited("commands") || listLimited("searches") || listLimited("fetches");
  const searchTotals = () => (props.summary?.searches ?? []).reduce((total, group) => ({ count: total.count + group.count, errors: total.errors + group.errors, stopped: total.stopped + group.stopped }), { count: 0, errors: 0, stopped: 0 });

  // A program's tally counts every row under it, so the runs its step rows add are named beside the total.
  const Tally = (props: { group: SummaryCommandGroup; noun: string; listedOnly?: boolean }) => <p class="overview-provenance">
    <Show when={props.listedOnly}><span>Listed:</span></Show>
    <span>{plural(props.group.count, props.noun)}<Show when={stepCount(props.group)}>{steps => <>, {steps() === 1 ? "1 as a step" : `${steps().toLocaleString()} as steps`}</>}</Show></span>
    <Show when={props.group.errors}><span class="meta-dot" aria-hidden="true">·</span><span class="overview-file-error">{plural(props.group.errors, "error")}</span></Show>
    <Show when={props.group.stopped}><span class="meta-dot" aria-hidden="true">·</span><span class="overview-file-stopped">{props.group.stopped.toLocaleString()} stopped</span></Show>
  </p>;

  // A closed category still names the programs in it, the most run first, so the rail answers whether a program was
  // involved without opening anything; the whole list is in the summary's accessible name.
  const Programs = (props: { groups: SummaryCommandGroup[] }) => {
    const names = () => [...props.groups].sort((left, right) => right.count - left.count).map(group => `${group.name} ${group.count.toLocaleString()}`);
    const hidden = () => Math.max(0, names().length - shownPrograms);
    return <Show when={names().length}>
      <span class="overview-category-programs">
        <span class="visually-hidden">Programs: </span>
        <span>{names().slice(0, shownPrograms).join(" · ")}</span>
        <Show when={hidden()}><span aria-hidden="true"> +{hidden().toLocaleString()} more</span><span class="visually-hidden"> · {names().slice(shownPrograms).join(" · ")}</span></Show>
      </span>
    </Show>;
  };

  const groups = (category: SummaryCommandCategory) => props.summary?.commands.filter(group => group.category === category) ?? [];
  const Program = (props: { group: SummaryCommandGroup }) => <section class="overview-folder" aria-label={`Commands that call ${props.group.name}`}>
    <h3><Icon name="terminal" size={14} /><span>{props.group.name}</span></h3>
    <Tally group={props.group} noun="run" listedOnly={listLimited("commands")} />
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
            <Show when={shell().length && listLimited("commands") || fetches().length && listLimited("fetches")}>Listed: </Show>
            <span>{[count() ? plural(count(), "run") : "", fetched() ? plural(fetched(), "fetch") : ""].filter(Boolean).join(" · ")}</span>
            <Show when={errors()}><span class="overview-file-error"> · {plural(errors(), "error")}</span></Show>
            <Show when={stopped()}><span class="overview-file-stopped"> · {stopped().toLocaleString()} stopped</span></Show>
          </span>
          <Show when={category.key !== "other"}><Programs groups={[...shell(), ...fetches()]} /></Show>
        </summary>
        <Show when={category.key === "other"} fallback={<For each={shell()} keyed={group => group.name}>{group => <Program group={group()} />}</For>}>
          <p class="overview-note overview-category-note">Multi-step or ambiguous commands, plus programs beyond the overview’s group limit. Previews keep the recorded first line; select one to see the full call. A multi-step command is also listed under the grouped programs it calls directly.</p>
          <For each={shell()} keyed={group => group.name}>{group => <ul class="overview-file-list"><For each={group().commands} keyed={keyOf}>{CommandRow}</For></ul>}</For>
        </Show>
        <For each={fetches()} keyed={group => group.name}>{group => <section class="overview-folder" aria-label={`${group().name} fetches`}>
          <h3><Icon name="terminal" size={14} /><span>{group().name}</span></h3>
          <Tally group={group()} noun="fetch" listedOnly={listLimited("fetches")} />
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
      <Show when={hasOmissions()}><p class="overview-note">Counts marked “Listed” exclude omitted commands, searches, or fetches; each listed entry still counts all its calls.</p></Show>
      <Show when={!summary().commandRuns}><p class="overview-empty">No shell commands recorded.</p></Show>
      <For each={groups("shell")} keyed={group => group.name}>{group => <Program group={group()} />}</For>
      <For each={categories} keyed={category => category.key}>{category => <Category key={category().key} label={category().label} />}</For>
      <Show when={summary().searches.length}>
        <details class="overview-reads overview-searches overview-command-category" aria-label="Searches">
          <summary>
            <Icon name="chevron" size={13} /><span>Searches</span>
            <span class="overview-category-tally">
              <Show when={listLimited("searches")}>Listed: </Show>
              <span>{entryCount(summary().searches).toLocaleString()} distinct · {plural(searchTotals().count, "call")}</span>
              <Show when={searchTotals().errors}><span class="overview-file-error"> · {plural(searchTotals().errors, "error")}</span></Show>
              <Show when={searchTotals().stopped}><span class="overview-file-stopped"> · {searchTotals().stopped.toLocaleString()} stopped</span></Show>
            </span>
            <Programs groups={summary().searches} />
          </summary>
          <Show when={listLimited("searches")}><p class="overview-note">Whole recording: {plural(summary().searchCount, "distinct search")} across {plural(summary().searchRuns, "call")}.</p></Show>
          <p class="overview-note overview-category-note">Grep, Glob, and WebSearch calls. Shell grep and rg commands are under Files & text.</p>
          <For each={summary().searches} keyed={group => group.name}>{group => <section class="overview-folder" aria-label={`${group().name} searches`}>
            <h3><Icon name="search" size={14} /><span>{group().name}</span></h3>
            <Tally group={group()} noun="call" listedOnly={listLimited("searches")} />
            <ul class="overview-file-list"><For each={group().commands} keyed={keyOf}>{SearchRow}</For></ul>
          </section>}</For>
        </details>
      </Show>
      <Show when={summary().limited}><p class="overview-note">Very long recordings show shortened lists of programs, commands, searches, fetches, and individual calls.</p></Show>
      <p class="overview-note">Shell counts cover Bash and PowerShell calls only; searches and WebFetch calls are listed separately. A multi-step command is listed under Other commands and under the grouped programs it calls directly, so group counts overlap, and a step shows the outcome of its whole command. A recorded error means the call failed; a call that succeeded isn’t proof the command did, such as one whose output was piped elsewhere or one run in the background. Commands run by subagents aren’t listed.</p>
    </>}</Show>
  </nav>;
}
