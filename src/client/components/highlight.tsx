import { For } from "solid-js";

export function Highlight(props: { text: string; term: string }) {
  const parts = () => {
    if (!props.term) return [{ text: props.text, match: false }];
    const lower = props.text.toLowerCase();
    const term = props.term.toLowerCase();
    const result: { text: string; match: boolean }[] = [];
    let cursor = 0;
    let found = lower.indexOf(term);
    while (found !== -1) {
      result.push({ text: props.text.slice(cursor, found), match: false }, { text: props.text.slice(found, found + term.length), match: true });
      cursor = found + term.length;
      found = lower.indexOf(term, cursor);
    }
    result.push({ text: props.text.slice(cursor), match: false });
    return result;
  };
  return <For each={parts()}>{part => part.match ? <mark>{part.text}</mark> : part.text}</For>;
}
