import { For, Show, createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { ContentBlock, ReplayEvent } from "../../shared/types";
import {
  boundedDiff,
  contentToText,
  eventRaw,
  formatEventTime,
  getString,
  getToolInput,
  isRecord,
  prettyValue,
  resultText,
  safeDataImage,
  toolPreview,
  toolTitle,
} from "../lib/content";
import { Markdown } from "./markdown";

export interface EventCardProps {
  event: ReplayEvent;
  results?: Record<string, ContentBlock>;
  highlight?: string;
}

function CopyButton(props: { value: string; label?: string }) {
  const [state, setState] = createSignal<"idle" | "copied" | "failed">("idle");
  createEffect(
    () => state(),
    (current) => {
      if (current === "idle") return;
      const timeout = window.setTimeout(() => setState("idle"), 2400);
      return () => window.clearTimeout(timeout);
    },
  );
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(props.value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  const label = () => state() === "copied" ? "Copied" : state() === "failed" ? "Copy failed" : props.label ?? "Copy";
  return <button class="replay-copy" type="button" onClick={copy} aria-live="polite" aria-label={label()}>{label()}</button>;
}

function CodePanel(props: { title: string; value: string; terminal?: boolean }) {
  const [open, setOpen] = createSignal(false);
  return (
    <section class={`tool-code ${props.terminal ? "tool-terminal" : ""}`}>
      <header><span>{props.title}</span><CopyButton value={props.value} /></header>
      <pre><code>{open() || props.value.length <= 1800 ? props.value : `${props.value.slice(0, 1800)}\n… output truncated …`}</code></pre>
      <Show when={props.value.length > 1800}>
        <button class="replay-text-button" type="button" onClick={() => setOpen(!open())}>{open() ? "Show less" : "Show full output"}</button>
      </Show>
    </section>
  );
}

function DiffPanel(props: { input: Record<string, unknown> }) {
  const before = getString(props.input.old_string) ?? getString(props.input.before) ?? "";
  const after = getString(props.input.new_string) ?? getString(props.input.after) ?? "";
  const lines = createMemo(() => boundedDiff(before, after));
  return (
    <Show when={before || after} fallback={<CodePanel title="Edit input" value={prettyValue(props.input)} />}>
      <section class="tool-diff" aria-label="Bounded file diff">
        <For each={lines()}>{(line) => <div class={`tool-diff-line tool-diff-${line.kind}`}><span>{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span><code>{line.value}</code></div>}</For>
      </section>
    </Show>
  );
}

function TodoPanel(props: { input: Record<string, unknown> }) {
  const items = () => (Array.isArray(props.input.todos) ? props.input.todos : Array.isArray(props.input.items) ? props.input.items : []);
  return <ul class="tool-checklist"><For each={items()}>{(item) => {
    const record = isRecord(item) ? item : { content: String(item) };
    const status = getString(record.status) ?? "pending";
    return <li data-status={status}><span aria-hidden="true">{status === "completed" ? "✓" : status === "in_progress" ? "•" : "○"}</span>{getString(record.content) ?? getString(record.subject) ?? prettyValue(record)}</li>;
  }}</For></ul>;
}

function QuestionPanel(props: { input: Record<string, unknown> }) {
  const questions = () => Array.isArray(props.input.questions) ? props.input.questions : [];
  return <div class="tool-questions"><For each={questions()}>{(question) => {
    const record = isRecord(question) ? question : { question: String(question) };
    const options = Array.isArray(record.options) ? record.options : [];
    return <section><strong>{getString(record.header) ?? "Question"}</strong><p>{getString(record.question) ?? ""}</p><ul><For each={options}>{(option) => <li>{isRecord(option) ? getString(option.label) ?? prettyValue(option) : String(option)}</li>}</For></ul></section>;
  }}</For></div>;
}

function Attachment(props: { block: ContentBlock }) {
  const [enabled, setEnabled] = createSignal(false);
  const source = () => safeDataImage(props.block.source);
  return <section class="tool-attachment"><span>Image attachment</span><Show when={source()} fallback={<span class="replay-muted">Unavailable or blocked attachment</span>}><button class="replay-text-button" type="button" onClick={() => setEnabled(!enabled())}>{enabled() ? "Hide image" : "Show image"}</button><Show when={enabled()}><img src={source()} alt="Recorded image attachment" /></Show></Show></section>;
}

function ToolContent(props: { block: ContentBlock; result?: ContentBlock }) {
  const input = () => getToolInput(props.block);
  const name = () => (props.block.name ?? "").toLowerCase();
  const result = () => resultText(props.result);
  return <div class="tool-content">
    <Show when={name() === "edit"}><DiffPanel input={input()} /></Show>
    <Show when={name() === "write"}><CodePanel title={getString(input().file_path) ?? "Written file"} value={getString(input().content) ?? prettyValue(input())} /></Show>
    <Show when={name() === "read"}><CodePanel title={getString(input().file_path) ?? getString(input().path) ?? "Read file"} value={result() || prettyValue(input())} /></Show>
    <Show when={name() === "bash" || name() === "shell"}><CodePanel title="Command" value={getString(input().command) ?? prettyValue(input())} terminal /><Show when={result()}><CodePanel title={props.result?.is_error ? "Command error" : "Command output"} value={result()} terminal /></Show></Show>
    <Show when={name() === "todowrite" || name() === "todo"}><TodoPanel input={input()} /></Show>
    <Show when={name() === "task"}><section class="tool-task"><strong>{getString(input().description) ?? getString(input().subagent_type) ?? "Task"}</strong><p>{getString(input().prompt) ?? ""}</p></section></Show>
    <Show when={name() === "askuserquestion" || name() === "ask_question"}><QuestionPanel input={input()} /></Show>
    <Show when={!(["edit", "write", "read", "bash", "shell", "todowrite", "todo", "task", "askuserquestion", "ask_question"] as string[]).includes(name())}><CodePanel title="Tool input" value={prettyValue(input())} /><Show when={result()}><CodePanel title={props.result?.is_error ? "Tool error" : "Tool result"} value={result()} /></Show></Show>
  </div>;
}

function ToolUse(props: { block: ContentBlock; result?: ContentBlock }) {
  const [open, setOpen] = createSignal(false);
  const preview = () => toolPreview(props.block);
  const status = () => props.result?.is_error === true ? "error" : props.result ? "success" : "pending";
  return <section class={`tool-card ${props.result?.is_error ? "tool-card-error" : ""}`}>
    <button class="tool-summary" type="button" aria-expanded={open() ? "true" : "false"} onClick={() => { setOpen(!open()); }}><span class="tool-status" aria-label={`Tool ${status()}`}>{status() === "error" ? "!" : status() === "success" ? "✓" : "→"}</span><span>{toolTitle(props.block.name)}</span><Show when={preview()}><span class="tool-preview">{preview()}</span></Show><span class="tool-disclosure" aria-hidden="true">{open() ? "−" : "+"}</span></button>
    <Show when={open()}><ToolContent block={props.block} result={props.result} /></Show>
  </section>;
}

function ToolResult(props: { block: ContentBlock }) {
  const value = () => contentToText(props.block.content) || prettyValue(props.block.content ?? props.block);
  return <section class={`tool-card tool-result ${props.block.is_error ? "tool-card-error" : ""}`}><CodePanel title={props.block.is_error ? "Unmatched tool error" : "Unmatched tool result"} value={value()} /></section>;
}

function ThinkingBlock(props: { block: ContentBlock }) {
  const [open, setOpen] = createSignal(false);
  return <details class="tool-thinking" onToggle={(event) => { setOpen(event.currentTarget.open); }}><summary>Reasoning</summary><Show when={open()}><pre>{props.block.thinking ?? props.block.text ?? ""}</pre></Show></details>;
}

function BlockRenderer(props: { block: ContentBlock; results?: Record<string, ContentBlock>; highlight?: string }) {
  if (props.block.type === "text") return <Markdown content={props.block.text ?? ""} highlight={props.highlight} />;
  if (props.block.type === "thinking") return <ThinkingBlock block={props.block} />;
  if (props.block.type === "tool_use") return <ToolUse block={props.block} result={props.block.id ? props.results?.[props.block.id] : undefined} />;
  if (props.block.type === "tool_result") return <ToolResult block={props.block} />;
  if (props.block.source || props.block.type === "image") return <Attachment block={props.block} />;
  return <section class="tool-unknown"><strong>Unknown block: {props.block.type || "untitled"}</strong><CodePanel title="Raw block" value={prettyValue(props.block)} /></section>;
}

export function EventCard(props: EventCardProps) {
  const [settled, setSettled] = createSignal(false);
  const [rawOpen, setRawOpen] = createSignal(false);
  onSettled(() => {
    setSettled(true);
  });
  const role = createMemo(() => props.event.role || "system");
  const hasBlocks = createMemo(() => props.event.blocks.length > 0);
  return <article class={`replay-event replay-event-${role()} ${props.event.error ? "replay-event-error" : ""}`} data-event-id={props.event.id} data-settled={settled() ? "true" : "false"}>
    <header class="replay-event-header"><span class="replay-role">{role()}</span><time datetime={props.event.timestamp}>{formatEventTime(props.event.timestamp)}</time><Show when={props.event.cwd}><code>{props.event.cwd}</code></Show><Show when={props.event.error}><span class="replay-error-label">Error</span></Show></header>
    <div class="replay-event-body"><For each={props.event.blocks}>{(block) => <BlockRenderer block={block} results={props.results} highlight={props.highlight} />}</For><Show when={!hasBlocks() && props.event.text}><Markdown content={props.event.text} highlight={props.highlight} /></Show><Show when={!hasBlocks() && !props.event.text}><section class="tool-unknown">No renderable event content.</section></Show></div>
    <details class="replay-raw" onToggle={(event) => { setRawOpen(event.currentTarget.open); }}><summary>Raw event</summary><Show when={rawOpen()}><CodePanel title="Recorded event" value={eventRaw(props.event)} /></Show></details>
  </article>;
}
