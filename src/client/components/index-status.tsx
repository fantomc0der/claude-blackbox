import { createEffect, createSignal } from "solid-js";
import type { Catalog, IndexProgress } from "../../shared/types";
import { tokenCount } from "../lib/format";
import { Icon } from "./icon";

export function IndexStatus(props: { catalog: Catalog | null; progress: IndexProgress | null; refreshing: boolean; refresh: () => void }) {
  const failed = () => props.progress?.phase === "error";
  const working = () => props.refreshing || props.progress?.phase === "discovering" || props.progress?.phase === "indexing";
  const [visible, setVisible] = createSignal(false);
  createEffect(() => working(), active => {
    if (!active) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timer);
  });
  const label = () => {
    if (!props.progress) return props.catalog ? "Index unavailable" : "Connecting to index";
    if (failed()) return "Scan failed";
    if (visible()) return props.progress.phase === "discovering" ? "Finding recordings" : "Checking files";
    return "Recordings indexed";
  };
  const count = () => {
    if (!props.progress) return props.catalog ? "Reconnecting…" : "—";
    if (failed()) return "Index incomplete";
    if (visible()) return props.progress.phase === "discovering" ? "Total not yet known" : `${tokenCount(props.progress.checked)} / ${tokenCount(props.progress.total)}`;
    return props.catalog ? tokenCount(props.catalog.sessions) : "—";
  };
  const determinate = () => visible() && props.progress?.phase === "indexing" && props.progress.total > 0;
  return <div class={['index-status', { 'index-failed': failed() }]}>
    <span class={['loading-dot index-refresh', { active: visible() && !failed() }]} aria-hidden="true" />
    <div class="index-progress" role={visible() && !failed() ? "progressbar" : undefined} aria-label={visible() && !failed() ? "Recording index" : undefined}
      aria-describedby="recording-index-help"
      aria-valuemin={determinate() ? 0 : undefined} aria-valuemax={determinate() ? props.progress!.total : undefined}
      aria-valuenow={determinate() ? props.progress!.checked : undefined} aria-valuetext={visible() && !failed() ? `${label()}: ${count()} recording files` : undefined}
      title={`${label()}: ${count()}. Progress counts recording files, not individual messages. Unreadable sources are reported separately.`}>
      <span class="index-label">{label()}</span><span class="index-count">{count()}</span>
    </div>
    <span id="recording-index-help" class="visually-hidden">Counts refer to recording files, not individual messages. {failed() ? "The index may be incomplete or out of date. Rescan recordings to retry." : ""}</span>
    <button class="icon-button" title="Rescan recordings" aria-label="Rescan recordings" aria-describedby="recording-index-help" disabled={visible() || props.refreshing} onClick={props.refresh}><Icon name="refresh" size={15} /></button>
  </div>;
}
