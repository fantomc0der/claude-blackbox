import { Show, createSignal, onSettled } from "solid-js";
import type { Catalog, IndexProgress } from "../../shared/types";
import { tokenCount } from "../lib/format";
import { createProlonged } from "../lib/prolonged";
import { Icon } from "./icon";

const shownKinds = 5;
const formatStorageKey = "blackbox:index-count";
type CountFormat = "count" | "percent";

function storedFormat(): CountFormat {
  try { return localStorage.getItem(formatStorageKey) === "percent" ? "percent" : "count"; }
  catch { return "count"; }
}

/** The whole percentage of recording files checked. A scan that has started never reads 0%, and one still under way
 *  never reads 100% early, since the floor rounds down. */
function percentage(checked: number, total: number): string {
  const share = Math.min(Math.floor(checked / total * 100), 100);
  return share === 0 && checked > 0 ? "<1%" : `${share}%`;
}

export function IndexStatus(props: { catalog: Catalog | null; progress: IndexProgress | null; refreshing: boolean; refresh: () => void }) {
  const failed = () => props.progress?.phase === "error";
  const working = () => props.refreshing || props.progress?.phase === "upgrading" || props.progress?.phase === "discovering" || props.progress?.phase === "indexing";
  const visible = createProlonged(working);
  // An upgrade counts recordings once per version step that reads them, so only its share is shown, never its counts.
  const upgrading = () => visible() && props.progress?.phase === "upgrading";
  const label = () => {
    if (!props.progress) return props.catalog ? "Index unavailable" : "Connecting to index";
    if (failed()) return "Scan failed";
    if (upgrading()) return "Upgrading index";
    if (visible()) return props.progress.phase === "discovering" ? "Finding recordings" : "Checking files";
    return "Recordings indexed";
  };
  const determinate = () => visible() && (props.progress?.phase === "indexing" || props.progress?.phase === "upgrading") && props.progress.total > 0;
  const fraction = () => `${tokenCount(props.progress!.checked)} / ${tokenCount(props.progress!.total)}`;
  // The full value, which the tooltip and the progress text always carry even while the line shows a percentage.
  const detail = () => {
    if (!props.progress) return props.catalog ? "Reconnecting…" : "—";
    if (failed()) return "Index incomplete";
    if (upgrading()) return determinate() ? percentage(props.progress.checked, props.progress.total) : "Starting";
    if (visible()) return props.progress.phase === "discovering" ? "Total not yet known" : fraction();
    return props.catalog ? tokenCount(props.catalog.sessions) : "—";
  };
  // While files are checked, the count shares the label's line. The fraction is the default; when it would push the
  // count onto a second line the percentage takes its place, and when both fit the reader may switch between them.
  // A hidden copy of the label and fraction is measured against the row so the fraction never shows wrapped first.
  const [format, setFormat] = createSignal(storedFormat());
  const [fractionFits, setFractionFits] = createSignal(true);
  const switchable = () => determinate() && !upgrading() && fractionFits();
  const percentShown = () => determinate() && (upgrading() || format() === "percent" || !fractionFits());
  const count = () => percentShown() ? percentage(props.progress!.checked, props.progress!.total) : detail();
  const toggle = () => {
    const next: CountFormat = percentShown() ? "count" : "percent";
    setFormat(next);
    try { localStorage.setItem(formatStorageKey, next); }
    catch { /* The choice still applies for this page. */ }
  };
  let line!: HTMLDivElement;
  let measure!: HTMLSpanElement;
  onSettled(() => {
    const observer = new ResizeObserver(() => setFractionFits(measure.getBoundingClientRect().width <= line.getBoundingClientRect().width));
    observer.observe(line);
    observer.observe(measure);
    return () => observer.disconnect();
  });
  const idle = () => !!props.progress && !visible() && !failed();
  // Records whose type or subtype this build does not know are flagged by a glyph after the idle count, which keeps the
  // count on the label's line and the footer at its height; the count and explanation are its tooltip and hidden text.
  // Nothing shows while there are none, and the tooltip names a few kinds and counts the rest.
  const unrecognized = () => props.catalog?.unrecognizedRecords ?? 0;
  const kinds = () => props.catalog?.unrecognizedKinds ?? [];
  const unrecognizedDetail = () => [`${tokenCount(unrecognized())} unrecognized ${unrecognized() === 1 ? "record" : "records"}.`,
    "Records of kinds this build does not recognize. A different Claude Code version may have changed its recording format.",
    "These records still appear under All events, where Raw event shows each one in full.",
    kinds().length ? `Kinds: ${kinds().slice(0, shownKinds).join(", ")}${kinds().length > shownKinds ? `, and ${kinds().length - shownKinds} more` : ""}.` : ""].filter(Boolean).join(" ");
  const progressbar = () => visible() && !failed();
  return <div class={['index-status', { 'index-failed': failed(), 'index-idle': idle() }]}>
    <div class="index-progress" ref={line}
      title={upgrading() ? `${label()}: ${detail()}. This version reads recordings differently, so the index is upgraded once. Indexed recordings stay available meanwhile.`
        : `${label()}: ${detail()}${determinate() ? ` (${percentage(props.progress!.checked, props.progress!.total)})` : ""}. Progress counts recording files, not individual messages. Unreadable sources are reported separately.`}>
      <span class="index-label" role={progressbar() ? "progressbar" : undefined} aria-label={progressbar() ? "Recording index" : undefined}
        aria-describedby="recording-index-help"
        aria-valuemin={determinate() ? 0 : undefined} aria-valuemax={determinate() ? props.progress!.total : undefined}
        aria-valuenow={determinate() ? props.progress!.checked : undefined} aria-valuetext={progressbar() ? `${label()}: ${detail()}${upgrading() ? "" : " recording files"}` : undefined}>{label()}</span>
      <span class="index-count">
        <Show when={switchable()} fallback={<span class="index-count-value">{count()}</span>}>
          <button type="button" class="index-count-value index-count-toggle" title={percentShown() ? "Show as count" : "Show as percentage"}
            aria-label={`${count()}. Show as ${percentShown() ? "count" : "percentage"}`} onClick={toggle}>{count()}</button>
        </Show>
        <Show when={idle() && unrecognized() > 0}><span class="index-unrecognized" title={unrecognizedDetail()}><Icon name="alert" size={13} /><span class="visually-hidden">{unrecognizedDetail()}</span></span></Show>
        <span class={['loading-dot index-refresh', { active: progressbar() }]} aria-hidden="true" />
      </span>
      <span class="index-measure" aria-hidden="true"><span class="index-measure-line" ref={measure}><Show when={determinate()}><span>{label()}</span><span>{fraction()}</span><span class="index-measure-dot" /></Show></span></span>
    </div>
    <span id="recording-index-help" class="visually-hidden">Counts refer to recording files, not individual messages. {failed() ? "The index may be incomplete or out of date. Rescan recordings to retry." : ""}</span>
    <button class="icon-button" title="Rescan recordings" aria-label="Rescan recordings" aria-describedby="recording-index-help" disabled={visible() || props.refreshing} onClick={props.refresh}><Icon name="refresh" size={15} /></button>
  </div>;
}
