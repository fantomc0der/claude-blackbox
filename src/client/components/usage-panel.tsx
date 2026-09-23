import { For, Show } from "solid-js";
import type { SessionPage, UsageSummary } from "../../shared/types";
import { compact, tokenCount, usageCost } from "../lib/format";
import { Icon } from "./icon";

export function TokenBreakdown(props: { usage: UsageSummary }) {
  return <dl class="token-breakdown">
    <div><dt>Input</dt><dd>{tokenCount(props.usage.inputTokens)}</dd></div>
    <div><dt>Output</dt><dd>{tokenCount(props.usage.outputTokens)}</dd></div>
    <div><dt>Cache write</dt><dd>{tokenCount(props.usage.cacheCreationTokens)}</dd></div>
    <div><dt>Cache read</dt><dd>{tokenCount(props.usage.cacheReadTokens)}</dd></div>
  </dl>;
}

export function UsageNote(props: { usage: UsageSummary }) {
  return <div class="usage-note">
    <Show when={props.usage.unpricedRequests}><p class="usage-warning">Cost is incomplete: {tokenCount(props.usage.unpricedRequests)} of {tokenCount(props.usage.requests)} requests have no known price. Their tokens are still included.</p></Show>
    <p>USD API equivalent, not your Claude subscription bill. Uses recorded costs when available; otherwise bundled model rates (Sep 23, 2026). Historical rates, provider discounts and tool fees may differ.</p>
  </div>;
}

export function UsagePanel(props: { page: SessionPage | null; pending: boolean; filterDirectory: (cwd: string) => void }) {
  const ready = () => !props.pending && props.page;
  return <details class="usage-panel" aria-busy={props.pending ? "true" : "false"}>
    <summary aria-label="Usage and estimated cost">
      <span class="usage-label">Usage</span>
      <Show when={ready()} fallback={<span class="usage-loading">Reading usage…</span>}>{page => <>
        <Show when={page().usage.requests} fallback={<span class="usage-empty">{page().total ? "No usage recorded" : "No matching recordings"}</span>}>
          <span class="usage-total" title={`${tokenCount(page().usage.totalTokens)} tokens, including cache reads and writes`}>{compact(page().usage.totalTokens)} <span>tokens</span></span>
          <span class="usage-total usage-total-cost">{usageCost(page().usage)} <span>est.</span></span>
        </Show>
      </>}</Show>
      <span class="usage-expand"><span>Breakdown</span><Icon name="down" size={14} /></span>
    </summary>
    <div class="usage-body">
      <Show when={ready()} fallback={<p class="usage-scope">Updating usage for these recordings…</p>}>{page => <>
        <p class="usage-scope">All {tokenCount(page().total)} matching recordings, across every page. {tokenCount(page().sessionsWithUsage)} report usage.</p>
        <Show when={page().usage.requests} fallback={<p class="usage-note">These transcripts do not contain assistant token usage. Missing usage is not counted as zero spend.</p>}>
          <TokenBreakdown usage={page().usage} />
          <Show when={page().directories.length > 1}>
            <table class="usage-directories">
              <caption>By source folder</caption>
              <thead><tr><th scope="col">Folder</th><th scope="col">Tokens</th><th scope="col">Est. USD</th></tr></thead>
              <tbody><For each={page().directories}>{directory => <tr>
                <td><button disabled={!directory.cwd} onClick={() => props.filterDirectory(directory.cwd)} title={`Show recordings in ${directory.cwd}`}><Icon name="folder" size={13} /><span>{directory.cwd || "Folder not recorded"}</span><Icon name="arrow" size={13} /></button></td>
                <td title={tokenCount(directory.usage.totalTokens)}>{directory.usage.requests ? compact(directory.usage.totalTokens) : "—"}</td>
                <td>{directory.usage.requests ? usageCost(directory.usage) : "—"}</td>
              </tr>}</For></tbody>
            </table>
          </Show>
          <p class="usage-scope">{tokenCount(page().usage.requests)} unique requests. Cache tokens are included. Repeated messages are counted once across the selection; shared history is assigned to one source folder. Date filters select recordings by their last activity, not individual requests.</p>
          <UsageNote usage={page().usage} />
        </Show>
      </>}</Show>
    </div>
  </details>;
}
