import { createSignal, For, Show } from "solid-js";
import type { ModelUsage, RecordedCost, RecordedCostTotal, SessionPage, UsageSummary } from "../../shared/types";
import { compact, effortName, modelName, pricingGap, recordedCostNote, recordedCostSummary, tokenCount, usageCost } from "../lib/format";
import { sortUsage, type UsageSort } from "../lib/usage-sort";
import { Icon } from "./icon";

/** How much of a total the subagent recordings hidden from the list contribute, as an amount or as unpriced tokens. */
function hiddenShare(page: SessionPage): string {
  const usage = page.hiddenAgentUsage;
  const recordings = `${tokenCount(page.hiddenAgents)} subagent ${page.hiddenAgents === 1 ? "recording" : "recordings"} hidden from the list`;
  if (usage.unpricedRequests === usage.requests) return `${compact(usage.totalTokens)} unpriced tokens from ${recordings}`;
  return `${usageCost(usage)} est. from ${recordings}`;
}

export function TokenBreakdown(props: { usage: UsageSummary }) {
  return <dl class="token-breakdown">
    <div><dt>Input</dt><dd>{tokenCount(props.usage.inputTokens)}</dd></div>
    <div><dt>Output</dt><dd>{tokenCount(props.usage.outputTokens)}</dd></div>
    <div><dt>Cache write</dt><dd>{tokenCount(props.usage.cacheCreationTokens)}</dd></div>
    <div><dt>Cache read</dt><dd>{tokenCount(props.usage.cacheReadTokens)}</dd></div>
  </dl>;
}

/** Requests without bundled rates make a total incomplete in a way an update can fix, so the summary flags them. */
function unratedTitle(usage: UsageSummary): string {
  return `Leaves out ${tokenCount(usage.unratedRequests)} ${usage.unratedRequests === 1 ? "request" : "requests"} from models Claude Blackbox does not recognize yet`;
}

/** A recording's own `cost-state` total, or a selection's sum of them; shown only when at least one recording carries it. */
function recordedCost(recorded: RecordedCost | RecordedCostTotal | null | undefined): RecordedCost | RecordedCostTotal | null {
  return recorded && (!("recordings" in recorded) || recorded.recordings > 0) ? recorded : null;
}

export function UsageNote(props: { usage: UsageSummary; unratedModels?: string[]; recorded?: RecordedCost | RecordedCostTotal | null }) {
  return <div class="usage-note">
    <Show when={props.usage.unpricedRequests}><p class="usage-warning">{pricingGap(props.usage, props.unratedModels ?? [])}</p></Show>
    <Show when={recordedCost(props.recorded)}>{recorded => <p class="usage-recorded">{recordedCostSummary(recorded())} {recordedCostNote}</p>}</Show>
    <p>USD API equivalent for the requests the recordings hold, not your Claude subscription bill. Uses a request's recorded cost when available; otherwise bundled model rates (Oct 16, 2026). Historical rates, provider discounts and tool fees may differ.</p>
  </div>;
}

function ModelExpenses(props: { rows: ModelUsage[]; usage: UsageSummary; filterModel: (model: string, effort: string | null) => void }) {
  return <>
    <table class="usage-matrix">
      <caption>By model &amp; effort</caption>
      <thead><tr><th scope="col">Model</th><th scope="col">Effort</th><th scope="col">Tokens</th><th scope="col">Est. USD</th></tr></thead>
      <tbody><For each={props.rows} keyed={row => JSON.stringify([row.model, row.effort])}>{row => <tr>
        <th scope="row" title={row().model}><button class="usage-drilldown" disabled={!row().model} aria-label={`Show recordings using ${modelName(row().model)}, effort ${effortName(row().effort)}`} onClick={() => props.filterModel(row().model, row().effort)}>{modelName(row().model)}<small>{tokenCount(row().usage.requests)} {row().usage.requests === 1 ? "request" : "requests"}</small></button></th>
        <td class={row().effort ? undefined : "usage-effort-missing"}>{effortName(row().effort)}</td>
        <td title={tokenCount(row().usage.totalTokens)}>{compact(row().usage.totalTokens)}</td>
        <td>{usageCost(row().usage)}<Show when={row().usage.unratedRequests} fallback={<Show when={row().usage.unpricedRequests > 0 && row().usage.unpricedRequests < row().usage.requests}><small class="usage-warning">Partial</small></Show>}>
          <small class="usage-warning" title={`This version of Claude Blackbox has no rates for ${row().model || "this model"} yet. Its tokens are counted, but its cost is not estimated.`}>Model not recognized</small>
        </Show></td>
      </tr>}</For></tbody>
      <tfoot><tr><th scope="row" colspan="2">All models</th><td title={tokenCount(props.usage.totalTokens)}>{compact(props.usage.totalTokens)}</td><td>{usageCost(props.usage)}</td></tr></tfoot>
    </table>
    <p class="usage-scope">Choose a model row to find recordings containing that model and effort. Totals include every request in those recordings. Missing effort stays “Not recorded”; no level or surcharge is assumed.</p>
  </>;
}

/** The library's Usage bar: totals for every matching recording and the toggle for their breakdown, which the list hosts. */
export function UsagePanel(props: { page: SessionPage | null; pending: boolean; open: boolean; toggle: () => void }) {
  return <div class="usage-panel" aria-busy={props.pending ? "true" : "false"}>
    <button type="button" class="usage-summary" aria-label="Usage and estimated cost" aria-expanded={props.open ? "true" : "false"} aria-controls="usage-breakdown" onClick={() => props.toggle()}>
      <span class="usage-label">Usage<span class={['loading-dot usage-refresh', { active: props.pending }]} aria-hidden="true" title={props.pending ? "Updating usage" : undefined} /></span>
      <Show when={props.page} fallback={<span class="usage-loading" aria-label="Usage not yet available">—</span>}>{page => <>
        <Show when={page().usage.requests} fallback={<span class="usage-empty">{page().total ? "No usage recorded" : "No matching recordings"}</span>}>
          <span class="usage-total" title={`${tokenCount(page().usage.totalTokens)} tokens, including cache reads and writes`}>{compact(page().usage.totalTokens)} <span>tokens</span></span>
          <span class="usage-total usage-total-cost" title={[page().hiddenAgentUsage.requests ? `Includes ${hiddenShare(page())}` : "", page().usage.unratedRequests ? unratedTitle(page().usage) : ""].filter(Boolean).join("\n") || undefined}>
            {usageCost(page().usage)} <span>est.</span><Show when={page().usage.unratedRequests}><span class="usage-unrated"><Icon name="alert" size={13} /></span></Show>
          </span>
        </Show>
      </>}</Show>
      <span class="usage-expand"><span>Breakdown</span><Icon name="down" size={14} /></span>
    </button>
  </div>;
}

/** The expanded breakdown. It stays mounted while collapsed, as a closed disclosure's content would, so its view, sort,
 *  focus and scroll survive toggling and background refreshes. */
export function UsageBreakdown(props: { page: SessionPage | null; open: boolean; filterDirectory: (cwd: string) => void; filterModel: (model: string, effort: string | null) => void }) {
  const [view, setView] = createSignal<"folders" | "models">("folders");
  const [sort, setSort] = createSignal<UsageSort>("cost");
  const ready = () => props.page;
  return <div class="usage-body" id="usage-breakdown" role="region" aria-label="Usage breakdown" hidden={!props.open}>
      <Show when={ready()} fallback={<p class="usage-scope">Usage for this selection will appear here when available.</p>}>{page => <>
        <p class="usage-scope">All {tokenCount(page().total)} matching recordings, across every page<Show when={page().hiddenAgents}>, plus {tokenCount(page().hiddenAgents)} subagent {page().hiddenAgents === 1 ? "recording" : "recordings"} hidden from the list</Show>. {tokenCount(page().sessionsWithUsage)}<Show when={page().hiddenAgents}> of {tokenCount(page().total + page().hiddenAgents)}</Show> report usage.<Show when={page().hiddenAgentUsage.requests}> This total includes {hiddenShare(page())}.<Show when={page().total}> Each row shows only its own recording's cost, so the visible rows add up to less.</Show></Show></p>
        <Show when={page().usage.requests} fallback={<p class="usage-note">These transcripts do not contain assistant token usage. Missing usage is not counted as zero spend.</p>}>
          <Show when={page().directories.length > 1}>
            <div class="usage-view-switch" role="group" aria-label="Expense breakdown">
              <button aria-pressed={view() === "folders" ? "true" : "false"} onClick={() => setView("folders")}>Folders</button>
              <button aria-pressed={view() === "models" ? "true" : "false"} onClick={() => setView("models")}>Model &amp; effort</button>
            </div>
          </Show>
          <div class="usage-breakdown-sort"><label>Sort breakdown<select aria-label="Sort usage breakdown" value={sort()} onChange={event => setSort(event.currentTarget.value as UsageSort)}><option value="cost">Highest estimated cost</option><option value="tokens">Most tokens</option><option value="name">Name (A–Z)</option></select></label></div>
          <Show when={view() === "folders" || page().directories.length < 2}><TokenBreakdown usage={page().usage} /></Show>
          <Show when={view() === "models" || page().directories.length < 2} fallback={
            <table class="usage-directories">
              <caption>By source folder</caption>
              <thead><tr><th scope="col">Folder</th><th scope="col">Tokens</th><th scope="col">Est. USD</th></tr></thead>
              <tbody><For each={sortUsage(page().directories, sort(), directory => directory.cwd)} keyed={directory => directory.cwd}>{directory => <tr>
                <td><button disabled={!directory().cwd} onClick={() => props.filterDirectory(directory().cwd)} title={`Show recordings in ${directory().cwd}`}><Icon name="folder" size={13} /><span>{directory().cwd || "Folder not recorded"}</span><Icon name="arrow" size={13} /></button></td>
                <td title={tokenCount(directory().usage.totalTokens)}>{directory().usage.requests ? compact(directory().usage.totalTokens) : "—"}</td>
                <td>{directory().usage.requests ? usageCost(directory().usage) : "—"}</td>
              </tr>}</For></tbody>
            </table>
          }><ModelExpenses rows={sortUsage(page().modelUsage, sort(), row => `${row.model}\n${row.effort || ""}`)} usage={page().usage} filterModel={props.filterModel} /></Show>
          <p class="usage-scope">{tokenCount(page().usage.requests)} unique requests. Cache tokens are included. Repeated messages are counted once across the selection; shared history is assigned to one source folder. Date filters select recordings by their last activity, not individual requests.</p>
          <UsageNote usage={page().usage} unratedModels={[...new Set(page().modelUsage.filter(row => row.usage.unratedRequests && row.model).map(row => row.model))]} recorded={page().recordedCost} />
        </Show>
      </>}</Show>
  </div>;
}
