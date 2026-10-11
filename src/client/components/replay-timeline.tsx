import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { EventTimeline } from "../../shared/types";
import { isAbort, request } from "../lib/api";
import { binsBetween, idleLabel, layoutTimeline, nearestBin, targets, type TimelineBin, type TimelineLayout } from "../lib/timeline";

const trackHeight = 30;
const labelWidth = 7.2;
const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const sameDay = (left: number, right: number) => new Date(left).toDateString() === new Date(right).toDateString();
const moment = (value: number, withDay: boolean) => withDay ? `${day.format(value)}, ${time.format(value)}` : time.format(value);

/** "Oct 8, 5:19 – 5:24 AM", repeating the date only when the range crosses midnight. */
export function timeRange(start: number, end: number): string {
  const last = Math.max(start, end - 1);
  if (time.format(start) === time.format(last) && sameDay(start, last)) return moment(start, true);
  return `${moment(start, true)} – ${moment(last, !sameDay(start, last))}`;
}

function binRange(layout: TimelineLayout, bins: TimelineBin[]): string {
  if (!bins.length || !layout.timed) return "";
  return timeRange(bins[0]!.start, bins.at(-1)!.end);
}

function axisLabels(layout: TimelineLayout, width: number) {
  if (!layout.timed || !layout.bins.length) return [];
  const starts: { x: number; at: number; align: "start" | "end" }[] = [];
  layout.items.forEach((item, index) => {
    if (item.kind === "bin" && (index === 0 || layout.items[index - 1]!.kind === "gap")) starts.push({ x: item.x, at: item.start, align: "start" });
  });
  // The recording's end is always labelled; stretch starts fill in from the left wherever they fit before it.
  const lastBin = layout.bins.at(-1)!, end = lastBin.end - 1;
  const labels: { x: number; text: string; align: "start" | "end" }[] = [];
  let right = -Infinity, previous: number | undefined;
  const endText = (after: number | undefined) => moment(end, after === undefined || !sameDay(after, end));
  for (const label of starts) {
    const text = moment(label.at, previous === undefined || !sameDay(previous, label.at));
    const size = text.length * labelWidth;
    if (label.x < right + 12 || label.x + size + 16 > width - endText(label.at).length * labelWidth) continue;
    labels.push({ x: label.x, text, align: label.align });
    right = label.x + size; previous = label.at;
  }
  if (width - endText(previous).length * labelWidth >= right + 12) labels.push({ x: width, text: endText(previous), align: "end" });
  return labels;
}

function Bar(props: { bin: TimelineBin; max: number; current: boolean; hovered: boolean; narrowed: boolean; errors: boolean }) {
  const height = (count: number) => count ? Math.max(3, Math.round(count / props.max * (trackHeight - 6))) : 0;
  const inset = () => Math.min(1, props.bin.width / 4);
  const x = () => props.bin.x + inset();
  const width = () => Math.max(1, props.bin.width - inset() * 2);
  return <g class={['timeline-bin', { current: props.current, hovered: props.hovered }]}>
    <Show when={props.narrowed && props.bin.all}><rect class="timeline-ghost" x={x()} y={trackHeight - 2 - height(props.bin.all)} width={width()} height={height(props.bin.all)} /></Show>
    <Show when={props.bin.count}><rect class="timeline-bar" x={x()} y={trackHeight - 2 - height(props.bin.count)} width={width()} height={height(props.bin.count)} /></Show>
    <Show when={props.errors && props.bin.errors}><rect class="timeline-error" x={x()} y={trackHeight - 2 - height(props.bin.count)} width={width()} height={height(props.bin.count) * Math.min(1, props.bin.errors / Math.max(1, props.bin.count))} /></Show>
  </g>;
}

export function ReplayTimeline(props: { id: string; filters: string; growth: number; offset: number; shown: number; total: number; pageSize: number; narrowed: boolean; errorsOnly: boolean; seek: (offset: number) => void; latest: () => void }) {
  let track!: HTMLDivElement;
  const [trackElement, setTrackElement] = createSignal<HTMLDivElement>();
  const [data, setData] = createSignal<EventTimeline | null>(null);
  const [width, setWidth] = createSignal(0);
  const [preview, setPreview] = createSignal<number | null>(null);
  const [hover, setHover] = createSignal<TimelineBin | null>(null);
  const [dragging, setDragging] = createSignal(false);
  // The record last chosen here. A choice near the end opens the same clamped page, so stepping continues from the
  // choice rather than the page start, and the window shows the destination before the page arrives.
  const [cursor, setCursor] = createSignal<number | null>(null);
  let landing: number | null = null;
  let lastFilters = "";
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  let grab: { pointer: number; window: number; moved: boolean; inside: boolean } | null = null;
  let fetch: { timer: ReturnType<typeof setTimeout>; controller: AbortController } | null = null;
  const cancelFetch = () => { if (fetch) { clearTimeout(fetch.timer); fetch.controller.abort(); fetch = null; } };

  createEffect(() => ({ id: props.id, filters: props.filters, growth: props.growth }), state => {
    const key = `${state.id}?${state.filters}`;
    const growing = key === lastFilters;
    lastFilters = key;
    // A new filter refetches at once. A growing recording refetches at most every 1.5 seconds: a refresh already
    // scheduled is kept rather than restarted, so steady growth still updates the strip.
    if (growing && fetch) return;
    cancelFetch();
    const controller = new AbortController();
    const current = fetch = { controller, timer: setTimeout(() => {
      void request<EventTimeline>(`/api/sessions/${state.id}/timeline?${state.filters}`, { signal: controller.signal })
        .then(next => { if (!controller.signal.aborted) setData(next); })
        .catch(error => { if (!isAbort(error)) setData(null); })
        .finally(() => { if (fetch === current) fetch = null; });
    }, growing ? 1500 : 0) };
  });
  createEffect(() => ({ offset: props.offset, filters: props.filters }), (state, previous) => {
    if (state.offset !== landing || (previous && state.filters !== previous.filters)) { setCursor(null); landing = null; }
  });
  createEffect(() => trackElement(), element => {
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0]!.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  });
  onCleanup(() => { clearTimeout(commitTimer); cancelFetch(); });

  const layout = createMemo(() => data() && width() ? layoutTimeline(data()!, width()) : null);
  const pageStart = (value: number) => Math.max(0, Math.min(value, props.total - props.pageSize));
  const chosen = () => preview() ?? cursor();
  const position = () => chosen() === null ? props.offset : pageStart(chosen()!);
  const windowBins = createMemo(() => {
    const value = layout();
    return value ? binsBetween(value, position(), position() + Math.max(1, props.shown || props.pageSize) - 1) : [];
  });
  const frame = () => {
    const bins = windowBins();
    if (!bins.length) return null;
    const left = Math.min(...bins.map(bin => bin.x)), right = Math.max(...bins.map(bin => bin.x + bin.width));
    return { left, width: Math.max(4, right - left) };
  };
  const labels = createMemo(() => layout() ? axisLabels(layout()!, width()) : []);
  const end = () => Math.min(position() + (props.shown || props.pageSize), props.total);
  const valueText = () => {
    const range = layout() ? binRange(layout()!, windowBins()) : "";
    return `Records ${Math.min(position() + 1, props.total)} to ${end()} of ${props.total}${range ? `, ${range}` : ""}`;
  };
  const tip = () => {
    const bin = hover();
    const value = layout();
    if (!bin || !value) return null;
    const when = value.timed ? timeRange(bin.start, bin.end) : `Records ${bin.start + 1}–${bin.end}`;
    const count = props.narrowed ? `${bin.count} of ${bin.all} records match` : `${bin.all} ${bin.all === 1 ? "record" : "records"}`;
    const errors = bin.errors && !props.errorsOnly ? ` · ${bin.errors} ${bin.errors === 1 ? "error" : "errors"}` : "";
    return { text: `${when} · ${count}${errors}`, x: Math.min(Math.max(bin.x + bin.width / 2, 0), width()) };
  };

  const commit = (target: number) => {
    clearTimeout(commitTimer); setPreview(null);
    landing = pageStart(target); setCursor(target);
    props.seek(target);
  };
  const stage = (target: number) => {
    const clamped = Math.max(0, Math.min(target, props.total - 1));
    setPreview(clamped);
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => commit(clamped), 250);
  };
  const local = (event: PointerEvent) => event.clientX - track.getBoundingClientRect().left;
  const pointerDown = (event: PointerEvent) => {
    const value = layout();
    if (!value || event.button !== 0) return;
    const x = local(event), box = frame();
    const inside = Boolean(box && x >= box.left && x <= box.left + box.width);
    grab = { pointer: x, window: inside ? box!.left : x, moved: false, inside };
    track.setPointerCapture(event.pointerId);
    setDragging(true);
    if (!inside) { const bin = nearestBin(value, x); if (bin) { setPreview(bin.first); setHover(bin); } }
  };
  const pointerMove = (event: PointerEvent) => {
    const value = layout();
    if (!value) return;
    const x = local(event);
    if (!grab) { setHover(nearestBin(value, x) || null); return; }
    if (Math.abs(x - grab.pointer) > 3) grab.moved = true;
    const bin = nearestBin(value, grab.inside ? grab.window + x - grab.pointer : x);
    if (bin && (grab.moved || !grab.inside)) { setPreview(bin.first); setHover(bin); }
  };
  const pointerUp = (event: PointerEvent) => {
    if (!grab) return;
    const tap = grab.inside && !grab.moved;
    grab = null; setDragging(false);
    // A tap inside the current page still chooses that moment, which brings its record into view.
    const target = tap ? layout() && nearestBin(layout()!, local(event))?.first : preview();
    if (target === null || target === undefined) { setPreview(null); return; }
    commit(target);
  };
  const keyDown = (event: KeyboardEvent) => {
    const value = layout();
    const bins = value ? targets(value) : [], at = chosen() ?? props.offset;
    let target: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") target = bins.find(bin => bin.first > at)?.first;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") target = bins.findLast(bin => bin.first < at)?.first ?? (at > 0 ? 0 : undefined);
    else if (event.key === "PageDown") target = at + props.pageSize < props.total ? at + props.pageSize : undefined;
    else if (event.key === "PageUp") target = at > 0 ? Math.max(0, at - props.pageSize) : undefined;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") { event.preventDefault(); clearTimeout(commitTimer); setPreview(null); setCursor(null); landing = null; props.latest(); return; }
    else return;
    event.preventDefault();
    if (target === undefined) return;
    stage(target);
    setHover(bins.find(bin => bin.first <= target! && bin.last >= target!) || null);
  };

  return <div class={['replay-timeline-strip', { pending: !layout(), dragging: dragging() }]}>
    <div class="timeline-track" ref={element => { track = element; setTrackElement(element); }} role="slider" tabindex="0" aria-label="Position in recording" aria-valuemin="1" aria-valuemax={props.total} aria-valuenow={Math.min(position() + 1, props.total)} aria-valuetext={valueText()} aria-busy={layout() ? "false" : "true"}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { grab = null; setDragging(false); setPreview(null); }} onPointerLeave={() => { if (!grab) setHover(null); }}
      onKeyDown={keyDown} onBlur={() => { if (preview() !== null) commit(preview()!); setHover(null); }}>
      <Show when={layout()}>{value => <svg width={width()} height={trackHeight} aria-hidden="true">
        <Show when={frame()}>{box => <rect class="timeline-window" x={box().left + .5} y=".5" width={box().width - 1} height={trackHeight - 1} rx="3" />}</Show>
        <For each={value().items}>{item => item.kind === "gap"
          ? <g class="timeline-gap"><text x={item.x + item.width / 2} y="9" text-anchor="middle">{idleLabel(item.duration).replace(" idle", "")}</text><line x1={item.x + item.width / 2 - 3} x2={item.x + item.width / 2 + 1} y1={trackHeight - 3} y2="14" /><line x1={item.x + item.width / 2 + 1} x2={item.x + item.width / 2 + 5} y1={trackHeight - 3} y2="14" /><title>{idleLabel(item.duration)}</title></g>
          : <Bar bin={item} max={value().max} current={windowBins().some(bin => bin === item)} hovered={hover() === item} narrowed={props.narrowed} errors={!props.errorsOnly} />}</For>
      </svg>}</Show>
      <Show when={tip()}>{value => <div class="timeline-tip" aria-hidden="true" style={{ "--tip-x": `${value().x}px`, "--tip-ratio": String(width() ? value().x / width() : 0) }}>{value().text}</div>}</Show>
    </div>
    <div class="timeline-axis" aria-hidden="true">
      <For each={labels()}>{label => <span class={label.align} style={{ left: `${label.x}px` }}>{label.text}</span>}</For>
    </div>
  </div>;
}
