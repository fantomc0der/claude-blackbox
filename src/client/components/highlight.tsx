import { For } from "solid-js";
import { markSegments, type TextSegment } from "../lib/json-highlight";

export function Highlight(props: { text?: string; segments?: TextSegment[]; term: string }) {
  const runs = () => markSegments(props.segments ?? [{ text: props.text ?? "" }], props.term);
  return <For each={runs()}>{run => {
    const content = <For each={run.segments}>{segment => segment.kind ? <span class={`json-${segment.kind}`}>{segment.text}</span> : segment.text}</For>;
    return run.match ? <mark>{content}</mark> : content;
  }}</For>;
}
