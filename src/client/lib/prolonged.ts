import { createEffect, createSignal } from "solid-js";

/** How long work runs before the interface shows it. Work that answers within a few frames would only flash its indicator,
 *  and an indicator drawn for one frame reads as a stray mark rather than as activity. */
export const INDICATOR_DELAY = 300;

/** True once `active` has stayed true for `delay` milliseconds, and false again as soon as it is not. */
export function createProlonged(active: () => boolean, delay = INDICATOR_DELAY): () => boolean {
  const [prolonged, setProlonged] = createSignal(false);
  createEffect(active, value => {
    if (!value) { setProlonged(false); return; }
    const timer = setTimeout(() => setProlonged(true), delay);
    return () => clearTimeout(timer);
  });
  return prolonged;
}
