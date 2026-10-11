import type { EventTimeline } from "../../shared/types";

/** `count` records match the replay filters (offsets `first`–`last`, null when none do); `all` counts every record. */
export interface TimelineBin { kind: "bin"; x: number; width: number; start: number; end: number; all: number; count: number; first: number | null; last: number | null; errors: number }
export interface TimelineGap { kind: "gap"; x: number; width: number; duration: number }
export interface TimelineLayout { items: (TimelineBin | TimelineGap)[]; bins: TimelineBin[]; max: number; timed: boolean }

const minute = 60_000;
export const gapWidth = 28;
const binTarget = 7;
const maxGaps = 6;

type Bucket = { time: number; all: number; count: number; first: number | null; last: number | null; errors: number };

function absorb(bin: Omit<Bucket, "time">, bucket: Omit<Bucket, "time">) {
  bin.all += bucket.all; bin.count += bucket.count; bin.errors += bucket.errors;
  if (bucket.first !== null) bin.first = Math.min(bin.first ?? bucket.first, bucket.first);
  if (bucket.last !== null) bin.last = Math.max(bin.last ?? bucket.last, bucket.last);
}

/**
 * Lays a recording's activity out across `width` pixels. Time is linear inside each active stretch; the longest idle
 * stretches collapse into fixed-width, labelled gaps so a session resumed the next day stays readable. The whole
 * recording sets the axis, so filters change bar heights but never move activity. Records that precede every
 * timestamp join the first stretch, and a recording without timestamps falls back to evenly spaced positions.
 */
export function layoutTimeline(timeline: EventTimeline, width: number): TimelineLayout {
  if (!timeline.unfilteredTotal || width <= 0) return { items: [], bins: [], max: 0, timed: false };
  const buckets: Bucket[] = timeline.buckets.filter(bucket => bucket.at !== null).map(bucket => ({ ...bucket, time: Date.parse(bucket.at!) }));
  if (!buckets.length) return positionLayout(timeline.total, width);
  const leading = timeline.buckets.find(bucket => bucket.at === null);
  if (leading) absorb(buckets[0]!, leading);
  const start = buckets[0]!.time, end = buckets.at(-1)!.time + timeline.bucketMs;
  const threshold = Math.max(20 * minute, (end - start) * 0.04, timeline.bucketMs * 3);
  const gaps = buckets.slice(1).map((bucket, index) => ({ index: index + 1, idle: bucket.time - buckets[index]!.time - timeline.bucketMs }))
    .filter(gap => gap.idle > threshold).sort((left, right) => right.idle - left.idle).slice(0, maxGaps)
    .map(gap => gap.index).sort((left, right) => left - right);
  const runs = [...gaps, buckets.length].map((split, index, splits) => buckets.slice(index ? splits[index - 1] : 0, split))
    .map(run => ({ start: run[0]!.time, end: run.at(-1)!.time + timeline.bucketMs, buckets: run }));
  const gapPixels = Math.min(gapWidth, width / (runs.length * 3));
  const available = Math.max(0, width - gapPixels * (runs.length - 1));
  // Every stretch keeps a few bins so a short burst beside a long one stays wide enough to click.
  const minimum = Math.min(binTarget * 3, available / runs.length);
  const span = runs.reduce((sum, run) => sum + run.end - run.start, 0);
  const flexible = available - minimum * runs.length;
  const items: (TimelineBin | TimelineGap)[] = [];
  let x = 0;
  runs.forEach((run, index) => {
    if (index) {
      items.push({ kind: "gap", x, width: gapPixels, duration: run.start - runs[index - 1]!.end });
      x += gapPixels;
    }
    const runWidth = minimum + flexible * (run.end - run.start) / span;
    const count = Math.max(1, Math.min(Math.round(runWidth / binTarget), Math.round((run.end - run.start) / timeline.bucketMs)));
    const binWidth = runWidth / count, binSpan = (run.end - run.start) / count;
    const bins: TimelineBin[] = Array.from({ length: count }, (_, bin) => ({ kind: "bin", x: x + bin * binWidth, width: binWidth, start: run.start + bin * binSpan, end: run.start + (bin + 1) * binSpan, all: 0, count: 0, first: null, last: null, errors: 0 }));
    for (const bucket of run.buckets) absorb(bins[Math.min(count - 1, Math.floor((bucket.time - run.start) / binSpan))]!, bucket);
    items.push(...bins);
    x += runWidth;
  });
  const bins = items.filter((item): item is TimelineBin => item.kind === "bin");
  return { items, bins, max: Math.max(1, ...bins.map(bin => bin.all)), timed: true };
}

function positionLayout(total: number, width: number): TimelineLayout {
  const count = Math.max(1, Math.min(total, Math.round(width / binTarget)));
  const bins: TimelineBin[] = Array.from({ length: count }, (_, bin) => {
    const first = Math.floor(bin * total / count), last = Math.floor((bin + 1) * total / count) - 1;
    return { kind: "bin", x: bin * width / count, width: width / count, start: first, end: last + 1, all: last - first + 1, count: last - first + 1, first, last, errors: 0 };
  });
  return { items: bins, bins, max: Math.max(1, ...bins.map(bin => bin.all)), timed: false };
}

/** Bins holding matching records, the only ones a click, drag, or key can land on. */
export function targets(layout: TimelineLayout): (TimelineBin & { first: number; last: number })[] {
  return layout.bins.filter((bin): bin is TimelineBin & { first: number; last: number } => bin.first !== null && bin.last !== null);
}

/** The matching bin nearest to pixel `x`, so a click on an idle stretch, a gap, or a filtered-out bin still lands on a match. */
export function nearestBin(layout: TimelineLayout, x: number) {
  let best: ReturnType<typeof targets>[number] | undefined, distance = Infinity;
  for (const bin of targets(layout)) {
    const next = x < bin.x ? bin.x - x : x > bin.x + bin.width ? x - bin.x - bin.width : 0;
    if (next < distance) { best = bin; distance = next; }
  }
  return best;
}

/** Bins whose matching records overlap offsets `from` to `to`, which is how the current page is drawn. */
export function binsBetween(layout: TimelineLayout, from: number, to: number) {
  return targets(layout).filter(bin => bin.first <= to && bin.last >= from);
}

export function idleLabel(duration: number): string {
  const minutes = Math.round(duration / minute);
  if (minutes < 100) return `${minutes}m idle`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h idle` : `${Math.round(hours / 24)}d idle`;
}
