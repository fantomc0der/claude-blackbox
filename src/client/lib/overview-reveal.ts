/**
 * Brings a rail's marked entries into view when none of them is: opens the disclosures that hold them and scrolls the
 * first into the rail. An entry already in view, such as the one the reader just chose, leaves the rail as it is, so
 * choosing a row never moves the rail under the pointer.
 */
export function revealSelected(rail: HTMLElement, selector = ".selected"): void {
  const entries = [...rail.querySelectorAll<HTMLElement>(selector)];
  if (!entries.length || entries.some(inView)) return;
  for (const entry of entries) {
    for (let details = entry.closest("details"); details; details = details.parentElement?.closest("details") ?? null) details.open = true;
  }
  entries[0].scrollIntoView({ block: "center" });
}

/**
 * Whether any part of an element shows inside every box that scrolls it and inside the window. Content of a closed
 * disclosure keeps a layout box in Chromium, so it is checked for by itself.
 */
function inView(element: HTMLElement): boolean {
  for (let details = element.closest("details"); details; details = details.parentElement?.closest("details") ?? null) {
    if (!details.open && !details.querySelector(":scope > summary")?.contains(element)) return false;
  }
  if (element.checkVisibility && !element.checkVisibility()) return false;
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) return false;
  let top = 0;
  let bottom = window.innerHeight;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    const box = parent.getBoundingClientRect();
    top = Math.max(top, box.top);
    bottom = Math.min(bottom, box.bottom);
  }
  return rect.bottom > top && rect.top < bottom;
}
