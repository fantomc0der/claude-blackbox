const GAP = 9, EDGE = 16, FLOOR = 120;

export function anchoredMenu(details: HTMLDetailsElement, menu: HTMLElement) {
  const place = () => {
    if (!details.open) return;
    const anchor = details.querySelector("summary")!.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    const width = menu.offsetWidth;
    const start = anchor.left < clientWidth / 2 || anchor.right - width < EDGE ? anchor.left : anchor.right - width;
    menu.style.setProperty("--menu-left", `${Math.round(Math.max(EDGE, Math.min(start, clientWidth - width - EDGE)))}px`);
    menu.style.setProperty("--menu-top", `${Math.round(anchor.bottom + GAP)}px`);
    menu.style.setProperty("--menu-height", `${Math.round(Math.max(FLOOR, clientHeight - anchor.bottom - GAP - EDGE))}px`);
  };
  details.addEventListener("toggle", place);
  window.addEventListener("resize", place);
  document.addEventListener("scroll", place, true);
  return () => { details.removeEventListener("toggle", place); window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
}
