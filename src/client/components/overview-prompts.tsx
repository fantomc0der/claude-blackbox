import { For, Show } from "solid-js";
import type { SessionSummary, SummaryPrompt, SummaryRecord } from "../../shared/types";
import { formatEventTime } from "../lib/content";

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
const hiddenText = "Opens in All events, because the current view hides it.";
const hiddenNote = (record: SummaryRecord) => record.position === null ? ` ${hiddenText}` : "";
const kindLabels: Record<SummaryPrompt["kind"], string> = { prompt: "Prompt", command: "Slash command", shell: "Shell command" };
// The clock time alone keeps each row short; the date is in the tooltip, and a prompt on a later day than the one before
// it carries the day beside its time.
const dayOf = (timestamp: string) => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
};
const clockTime = (timestamp: string) => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
};

/** The overview rail's Prompts view: what the user typed across the whole recording, each with the outcomes that followed. */
export function OverviewPrompts(props: { summary: SessionSummary | null; failed: boolean; retry: () => void; show: (record: SummaryRecord) => void; selected: string }) {
  const failure = () => <p class="overview-status" role="status">{props.summary ? "Couldn’t refresh the prompts for this view." : "Couldn’t load the prompts for this recording."}<button class="text-button" onClick={props.retry}>Retry</button></p>;
  const outcome = (prompt: SummaryPrompt) => [prompt.errors ? plural(prompt.errors, "error") : "", prompt.stopped ? `${prompt.stopped.toLocaleString()} stopped` : ""].filter(Boolean).join(", ");
  const name = (prompt: SummaryPrompt, index: number) => `${kindLabels[prompt.kind]} ${index + 1}, ${formatEventTime(prompt.timestamp)}${outcome(prompt) ? `, ${outcome(prompt)}` : ""}: ${prompt.text}. Show it.${hiddenNote(prompt)}`;

  return <nav class="overview-prompts" aria-label="Prompts in this recording">
    <Show when={props.summary} fallback={<Show when={props.failed} fallback={<div class="overview-loading" role="status"><span class="visually-hidden">Loading prompts…</span><div class="skeleton-row" /><div class="skeleton-row" /><div class="skeleton-row" /></div>}>{failure()}</Show>}>{summary => <>
      <Show when={props.failed}>{failure()}</Show>
      <p class="overview-scope">Whole recording · {plural(summary().promptCount, "prompt")}</p>
      <Show when={!summary().promptCount}><p class="overview-empty">No prompts recorded.</p></Show>
      <ol class="overview-prompt-list">
        <For each={summary().prompts} keyed={prompt => prompt.id}>{(prompt, index) => {
          const newDay = () => index() > 0 && dayOf(prompt().timestamp) !== dayOf(summary().prompts[index() - 1].timestamp);
          return <li class={['overview-prompt', { selected: prompt().id === props.selected, typed: prompt().kind !== "prompt" }]}>
            <button aria-current={prompt().id === props.selected ? "true" : undefined} aria-label={name(prompt(), index())} title={`${formatEventTime(prompt().timestamp)}. Show this ${kindLabels[prompt().kind].toLowerCase()}.${hiddenNote(prompt())}`} onClick={() => props.show(prompt())}>
              <span class="overview-prompt-meta" aria-hidden="true">
                <span class="overview-prompt-index">{(index() + 1).toLocaleString()}</span>
                <Show when={clockTime(prompt().timestamp)}>{time => <span class="overview-when">{newDay() ? `${dayOf(prompt().timestamp)} · ` : ""}{time()}</span>}</Show>
                <Show when={prompt().errors}><span class="overview-file-error">{plural(prompt().errors, "error")}</span></Show>
                <Show when={prompt().stopped}><span class="overview-file-stopped">{prompt().stopped.toLocaleString()} stopped</span></Show>
              </span>
              <span class="overview-prompt-text" aria-hidden="true">{prompt().text}</span>
            </button>
          </li>;
        }}</For>
      </ol>
      <Show when={summary().limited && summary().promptCount > summary().prompts.length}><p class="overview-note">Very long recordings show the first {summary().prompts.length.toLocaleString()} prompts.</p></Show>
      <p class="overview-note">What was typed in this recording: prompts, slash commands, and ! shell commands. Errors and stopped tools are counted up to the next prompt. Tool results, command output, and interruptions aren’t listed.</p>
    </>}</Show>
  </nav>;
}
