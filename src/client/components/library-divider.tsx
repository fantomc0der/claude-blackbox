import { createSignal, onSettled } from "solid-js";

export function LibraryDivider(props: { resize: (width: number | undefined) => void }) {
  let divider!: HTMLDivElement;
  let drag: { start: number; width: number } | null = null;
  const minimum = 240;
  const [width, setWidth] = createSignal(336);
  const [maximum, setMaximum] = createSignal(560);
  const resize = (next: number) => props.resize(Math.round(Math.max(minimum, Math.min(maximum(), next))));

  onSettled(() => {
    const library = divider.previousElementSibling!;
    const container = divider.parentElement!;
    const observer = new ResizeObserver(() => {
      setWidth(Math.round(library.getBoundingClientRect().width));
      setMaximum(Math.max(minimum, Math.min(560, container.clientWidth - 488)));
    });
    observer.observe(library);
    observer.observe(container);
    return () => observer.disconnect();
  });

  return <div ref={divider} class="library-divider" role="separator" tabindex={0} aria-label="Resize session library" aria-orientation="vertical" aria-controls="session-library" aria-valuemin={minimum} aria-valuemax={maximum()} aria-valuenow={width()} aria-valuetext={`${width()} pixels`} title="Drag or use arrow keys to resize. Double-click to reset."
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag = { start: event.clientX, width: width() };
    }}
    onPointerMove={event => { if (drag) resize(drag.width + event.clientX - drag.start); }}
    onPointerUp={event => { drag = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag = null; }} onLostPointerCapture={() => { drag = null; }}
    onDblClick={() => props.resize(undefined)}
    onKeyDown={event => {
      const next = { ArrowLeft: width() - 24, ArrowRight: width() + 24, Home: minimum, End: maximum() }[event.key];
      if (next === undefined) return;
      event.preventDefault(); resize(next);
    }} />;
}
