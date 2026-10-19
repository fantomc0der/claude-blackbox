import { expect, spyOn, test } from "bun:test";
import { createRefreshQueue } from "../src/client/lib/refresh-queue";

test("live invalidations finish active work and coalesce into one follow-up", async () => {
  const releases: Array<() => void> = [];
  const signals: AbortSignal[] = [];
  const queue = createRefreshQueue(signal => {
    signals.push(signal);
    return new Promise<void>(resolve => releases.push(resolve));
  });
  const finished = queue.refresh();
  for (let index = 0; index < 20; index++) void queue.refresh();
  expect(signals).toHaveLength(1);
  expect(signals[0].aborted).toBe(false);
  releases.shift()!();
  await Promise.resolve();
  expect(signals).toHaveLength(2);
  expect(signals[1].aborted).toBe(false);
  releases.shift()!();
  await finished;
  expect(signals).toHaveLength(2);
  queue.dispose();
});

test("disposing a selection cancels active work and discards queued refreshes", async () => {
  let release!: () => void;
  let calls = 0;
  let active!: AbortSignal;
  const queue = createRefreshQueue(signal => {
    calls++;
    active = signal;
    return new Promise<void>(resolve => { release = resolve; });
  });
  const finished = queue.refresh();
  void queue.refresh();
  queue.dispose();
  expect(active.aborted).toBe(true);
  release();
  await finished;
  await queue.refresh();
  expect(calls).toBe(1);
});

test("a resting queue waits after each run for that run's duration times its rest before it runs again", async () => {
  let elapsed = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => elapsed);
  const waits: number[] = [];
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((resolve: () => void, wait: number) => { waits.push(wait); elapsed += wait; resolve(); return 0; }) as unknown as typeof setTimeout);
  try {
    let runs = 0;
    // Each run takes the server 400 ms.
    const queue = createRefreshQueue(async () => { runs++; elapsed += 400; }, 3);
    await queue.refresh();
    expect([runs, waits]).toEqual([1, []]);
    // Asked again at once, it rests three times as long as the run took; asked once the rest is over, it runs at once.
    await queue.refresh();
    expect([runs, waits]).toEqual([2, [1200]]);
    elapsed += 1500;
    await queue.refresh();
    expect([runs, waits]).toEqual([3, [1200]]);
    // Refreshes asked for while one rests or runs still fold into a single follow-up.
    const resting = queue.refresh();
    for (let index = 0; index < 5; index++) void queue.refresh();
    await resting;
    expect([runs, waits]).toEqual([5, [1200, 1200, 1200]]);
    queue.dispose();
    await queue.refresh();
    expect(runs).toBe(5);
  } finally { timer.mockRestore(); clock.mockRestore(); }
});
