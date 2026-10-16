import { For } from "solid-js";
import type { TerminalStyle } from "../../shared/ansi";
import { markSegments, type TextSegment } from "../lib/json-highlight";

const FLAGS = ["bold", "dim", "italic", "underline", "strike", "inverse"] as const;

function terminalClass(style: TerminalStyle): string {
  const classes = FLAGS.filter(flag => style[flag]).map(flag => `ansi-${flag}`);
  if (style.fg !== undefined) classes.push("ansi-fg");
  if (style.bg !== undefined) classes.push("ansi-bg");
  return classes.join(" ");
}

// Palette indexes point at the theme's `--ansi-N` variables, so the 16 named colors follow the dark and light palettes;
// 256-color and 24-bit colors arrive as the `rgb()` strings the parser built from validated channel values.
function terminalColor(color: number | string | undefined): string | undefined {
  return color === undefined ? undefined : typeof color === "number" ? `var(--ansi-${color})` : color;
}

function Segment(props: { segment: TextSegment }) {
  const classes = () => [props.segment.kind && `json-${props.segment.kind}`, props.segment.terminal && terminalClass(props.segment.terminal)].filter(Boolean).join(" ");
  const colors = () => ({ "--ansi-fg": terminalColor(props.segment.terminal?.fg), "--ansi-bg": terminalColor(props.segment.terminal?.bg) });
  return <span class={classes()} style={colors()}>{props.segment.text}</span>;
}

export function Highlight(props: { text?: string; segments?: TextSegment[]; term: string }) {
  const runs = () => markSegments(props.segments ?? [{ text: props.text ?? "" }], props.term);
  return <For each={runs()}>{run => {
    const content = <For each={run.segments}>{segment => segment.kind || segment.terminal ? <Segment segment={segment} /> : segment.text}</For>;
    return run.match ? <mark>{content}</mark> : content;
  }}</For>;
}
