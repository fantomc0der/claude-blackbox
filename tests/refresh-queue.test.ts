import { expect, test } from "bun:test";
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
