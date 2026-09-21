export type DismissReason = "escape" | "outside";

export function dismissable(element: HTMLElement, dismiss: (reason: DismissReason) => void, trigger?: HTMLElement) {
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    dismiss("escape");
  };
  const pointerdown = (event: PointerEvent) => {
    if (event.target instanceof Node && (element.contains(event.target) || trigger?.contains(event.target))) return;
    dismiss("outside");
  };
  document.addEventListener("keydown", keydown);
  document.addEventListener("pointerdown", pointerdown);
  return () => { document.removeEventListener("keydown", keydown); document.removeEventListener("pointerdown", pointerdown); };
}

export function dismissableDetails(details: HTMLDetailsElement) {
  let release: (() => void) | undefined;
  const toggle = () => {
    release?.();
    release = details.open ? dismissable(details, reason => {
      const inside = details.contains(document.activeElement);
      details.open = false;
      if (reason === "escape" && inside) details.querySelector("summary")?.focus();
    }) : undefined;
  };
  details.addEventListener("toggle", toggle);
  return () => { release?.(); details.removeEventListener("toggle", toggle); };
}

export function rememberFocus() {
  const previous = document.activeElement;
  return (scope?: Element) => {
    const active = document.activeElement;
    if (active && active !== document.body && !scope?.contains(active)) return;
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  };
}
