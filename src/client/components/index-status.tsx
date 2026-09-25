import { createEffect, createSignal } from "solid-js";
import type { Catalog, IndexProgress } from "../../shared/types";
import { tokenCount } from "../lib/format";
import { Icon } from "./icon";

export function IndexStatus(props: { catalog: Catalog | null; progress: IndexProgress | null; refreshing: boolean; refresh: () => void }) {
  const working = () => props.refreshing || props.progress?.phase === "discovering" || props.progress?.phase === "indexing";
  const [visible, setVisible] = createSignal(false);
  createEffect(() => working(), active => {
    if (!active) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timer);
  });
  const label = () => {
    if (!props.progress) return props.catalog ? "Index unavailable" : "Connecting to index";
    if (props.progress.phase === "error") return "Scan failed";
    if (visible()) return props.progress.phase === "discovering" ? "Finding recordings" : "Checking recordings";
    return "Recordings indexed";
  };
  const count = () => {
    if (!props.progress) return props.catalog ? "Reconnecting…" : "—";
    if (props.progress.phase === "error") return "Rescan to try again";
    if (visible()) return props.progress.phase === "discovering" ? "Total not yet known" : `${tokenCount(props.progress.checked)} / ${tokenCount(props.progress.total)}`;
    return props.catalog ? tokenCount(props.catalog.sessions) : "—";
  };
  const determinate = () => visible() && props.progress?.phase === "indexing" && props.progress.total > 0;
  return <div class="index-status">
    <span class={['loading-dot index-refresh', { active: visible() }]} aria-hidden="true" />
    <div class="index-progress" role={visible() ? "progressbar" : undefined} aria-label={visible() ? "Recording index" : undefined}
      aria-valuemin={determinate() ? 0 : undefined} aria-valuemax={determinate() ? props.progress!.total : undefined}
      aria-valuenow={determinate() ? props.progress!.checked : undefined} aria-valuetext={visible() ? `${label()}: ${count()} recording files` : undefined}
      title={`${label()}: ${count()}. Progress counts recording files, not individual messages. Unreadable sources are reported separately.`}>
      <span class="index-label">{label()}</span><span class="index-count">{count()}</span>
    </div>
    <button class="icon-button" title="Rescan recordings" aria-label="Rescan recordings" disabled={visible() || props.refreshing} onClick={props.refresh}><Icon name="refresh" size={15} /></button>
  </div>;
}
