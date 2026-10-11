import { expect, test } from "bun:test";
import { binsBetween, idleLabel, layoutTimeline, nearestBin, targets } from "../src/client/lib/timeline";
import type { EventTimeline, TimelineBucket } from "../src/shared/types";

const minute = 60_000;
const start = Date.parse("2026-10-08T09:00:00Z");
function timeline(buckets: Array<[minutes: number | null, all: number, count?: number, errors?: number]>): EventTimeline {
  let position = 0;
  const rows: TimelineBucket[] = buckets.map(([minutes, all, count = all, errors = 0]) => {
    const first = count ? position : null, last = count ? position + count - 1 : null;
    position += count;
    return { at: minutes === null ? null : new Date(start + minutes * minute).toISOString(), all, count, first, last, errors };
  });
  return { total: position, unfilteredTotal: rows.reduce((sum, row) => sum + row.all, 0), bucketMs: minute, buckets: rows };
}

test("long idle stretches collapse into labelled gaps while short pauses stay on the time scale", () => {
  const morning = Array.from({ length: 40 }, (_, index) => [index, 3] as [number, number]);
  const afternoon = Array.from({ length: 60 }, (_, index) => [135 + index + (index > 30 ? 10 : 0), 2] as [number, number]);
  const nextDay = Array.from({ length: 10 }, (_, index) => [24 * 60 + index, 4] as [number, number]);
  const layout = layoutTimeline(timeline([...morning, ...afternoon, ...nextDay]), 800);
  const gaps = layout.items.filter(item => item.kind === "gap");
  expect(gaps.map(gap => idleLabel(gap.duration))).toEqual(["95m idle", "21h idle"]);
  expect(layout.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(40 * 3 + 60 * 2 + 10 * 4);
  const last = layout.items.at(-1)!;
  expect(last.x + last.width).toBeCloseTo(800);
  // The ten-minute pause inside the afternoon is not a gap, and the next-day burst is still wide enough to click.
  expect(layout.bins.some(bin => bin.all === 0)).toBe(true);
  const followUp = layout.bins.filter(bin => bin.start >= start + 24 * 60 * minute && bin.count);
  expect(followUp.reduce((sum, bin) => sum + bin.width, 0)).toBeGreaterThanOrEqual(20);
});

test("records before any timestamp join the first stretch, and undated recordings fall back to positions", () => {
  const leading = layoutTimeline(timeline([[null, 2], [0, 3], [1, 3]]), 300);
  expect(targets(leading)[0]!.first).toBe(0);
  expect(leading.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(8);
  const undated = layoutTimeline({ total: 130, unfilteredTotal: 130, bucketMs: minute, buckets: [{ at: null, all: 130, count: 130, first: 0, last: 129, errors: 0 }] }, 70);
  expect(undated.timed).toBe(false);
  expect(undated.bins).toHaveLength(10);
  expect(undated.bins.map(bin => bin.first)).toEqual([0, 13, 26, 39, 52, 65, 78, 91, 104, 117]);
});

test("filtered layouts keep the whole-recording axis and only target bins with matches", () => {
  const all = layoutTimeline(timeline([[0, 5], [30, 5], [60, 5]]), 300);
  const filtered = layoutTimeline(timeline([[0, 5, 0], [30, 5, 2, 1], [60, 5, 0]]), 300);
  expect(filtered.bins.map(bin => [bin.x, bin.width])).toEqual(all.bins.map(bin => [bin.x, bin.width]));
  expect(targets(filtered)).toHaveLength(1);
  expect(nearestBin(filtered, 0)!.first).toBe(0);
  expect(nearestBin(filtered, 299)!.first).toBe(0);
  expect(binsBetween(filtered, 0, 59).map(bin => bin.errors)).toEqual([1]);
});

test("the current page covers every bin its records fall in", () => {
  const layout = layoutTimeline(timeline(Array.from({ length: 10 }, (_, index) => [index, 20] as [number, number])), 700);
  expect(binsBetween(layout, 30, 89).map(bin => [bin.first, bin.last])).toEqual([[20, 39], [40, 59], [60, 79], [80, 99]]);
});
