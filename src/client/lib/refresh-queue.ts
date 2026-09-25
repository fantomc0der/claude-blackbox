export function createRefreshQueue(run: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  let running: Promise<void> | null = null;
  let queued = false;
  return {
    refresh(): Promise<void> {
      if (controller.signal.aborted) return Promise.resolve();
      if (running) { queued = true; return running; }
      running = (async () => {
        do {
          queued = false;
          await run(controller.signal);
        } while (queued && !controller.signal.aborted);
      })().finally(() => { running = null; });
      return running;
    },
    dispose() { queued = false; controller.abort(); },
  };
}
