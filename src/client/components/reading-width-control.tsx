import { createEffect, createSignal, onSettled } from "solid-js";

type ReadingWidth = "comfortable" | "full";
const storageKey = "blackbox:reading-width";

function savedReadingWidth(): ReadingWidth {
  try { return localStorage.getItem(storageKey) === "comfortable" ? "comfortable" : "full"; }
  catch { return document.documentElement.dataset.readingWidth === "comfortable" ? "comfortable" : "full"; }
}

export function ReadingWidthControl() {
  const [width, setWidth] = createSignal<ReadingWidth>(savedReadingWidth());
  createEffect(() => width(), value => { document.documentElement.dataset.readingWidth = value; });
  const changeWidth = (value: string) => {
    const next = value === "comfortable" ? "comfortable" : "full";
    setWidth(next);
    try { localStorage.setItem(storageKey, next); }
    catch {}
  };
  onSettled(() => {
    const syncWidth = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      try { if (event.storageArea === localStorage) setWidth(event.newValue === "comfortable" ? "comfortable" : "full"); }
      catch {}
    };
    window.addEventListener("storage", syncWidth);
    return () => window.removeEventListener("storage", syncWidth);
  });

  return <label class="sidebar-select"><span>Reading width</span><select value={width()} onChange={event => changeWidth(event.currentTarget.value)}><option value="comfortable">Comfortable</option><option value="full">Full width</option></select></label>;
}
