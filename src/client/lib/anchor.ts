const GAP = 9, EDGE = 16, FLOOR = 120;

export function anchoredMenu(details: HTMLDetailsElement, menu: HTMLElement) {
  const place = () => {
    if (!details.open) return;
    const anchor = details.querySelector("summary")!.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    const width = menu.offsetWidth;
    const start = anchor.left < clientWidth / 2 || anchor.right - width < EDGE ? anchor.left : anchor.right - width;
    menu.style.setProperty("--menu-left", `${Math.round(Math.max(EDGE, Math.min(start, clientWidth - width - EDGE)))}px`);
    const below = clientHeight - anchor.bottom - GAP - EDGE, above = anchor.top - GAP - EDGE;
    const flip = above > below && (below < FLOOR || below < menu.scrollHeight);
    const height = flip ? above : Math.max(FLOOR, below);
    menu.style.setProperty("--menu-top", `${Math.round(flip ? anchor.top - GAP - height : anchor.bottom + GAP)}px`);
    menu.style.setProperty("--menu-height", `${Math.round(height)}px`);
  };
  details.addEventListener("toggle", place);
  window.addEventListener("resize", place);
  document.addEventListener("scroll", place, true);
  return () => { details.removeEventListener("toggle", place); window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
}
