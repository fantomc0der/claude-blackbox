import { createEffect, createSignal } from "solid-js";

type TextSize = "standard" | "larger";
const storageKey = "blackbox:text-size";

function savedTextSize(): TextSize {
  try { return localStorage.getItem(storageKey) === "larger" ? "larger" : "standard"; }
  catch { return "standard"; }
}

export function TextSizeControl() {
  const [size, setSize] = createSignal<TextSize>(savedTextSize());
  createEffect(() => size(), value => { document.documentElement.dataset.textSize = value; });
  const changeSize = (value: string) => {
    const next = value === "larger" ? "larger" : "standard";
    setSize(next);
    try { localStorage.setItem(storageKey, next); }
    catch {}
  };

  return <label class="text-size-control"><span>Text size</span><select value={size()} onChange={event => changeSize(event.currentTarget.value)}><option value="standard">Standard</option><option value="larger">Larger</option></select></label>;
}
