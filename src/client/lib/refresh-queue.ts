/**
 * Runs `run` for each refresh, one at a time, folding the refreshes asked for while one runs into a single follow-up.
 * With a `rest` above 0, a run starts only once the time since the previous one ended is `rest` times as long as that
 * run took, so the refreshes take at most `1 / (rest + 1)` of the time. The server answers on one thread, which also
 * indexes, so a refresh that takes it seconds would otherwise leave a long scan and a recording opened meanwhile
 * waiting behind every change notice.
 */
export function createRefreshQueue(run: (signal: AbortSignal) => Promise<void>, rest = 0) {
  const controller = new AbortController();
  let running: Promise<void> | null = null;
  let queued = false;
  let ready = 0;
  return {
    refresh(): Promise<void> {
      if (controller.signal.aborted) return Promise.resolve();
      if (running) { queued = true; return running; }
      running = (async () => {
        do {
          queued = false;
          const wait = ready - performance.now();
          if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
          if (controller.signal.aborted) break;
          const started = performance.now();
          await run(controller.signal);
          ready = performance.now() + rest * (performance.now() - started);
        } while (queued && !controller.signal.aborted);
      })().finally(() => { running = null; });
      return running;
    },
    dispose() { queued = false; controller.abort(); },
  };
}
