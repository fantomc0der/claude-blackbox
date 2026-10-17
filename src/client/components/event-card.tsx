import { For, Match, Show, Switch, createEffect, createMemo, createSignal, createUniqueId, onSettled, untrack } from "solid-js";
import type { ContentBlock, ReplayEvent } from "../../shared/types";
import { apiRetry, noteFiling, thinkingMeasure, turnDuration } from "../../shared/records";
import {
  apiErrorLabel,
  boundedDiff,
  contentImages,
  contentToText,
  eventRaw,
  formatEventTime,
  getString,
  getToolInput,
  imageMeta,
  isApiError,
  isImageBlock,
  isRecord,
  isRequestMessage,
  isStandIn,
  isToolResultEvent,
  mentions,
  prettyValue,
  resultImages,
  resultText,
  safeDataImage,
  toolArgument,
  toolPreviewParts,
  toolTitle,
  truncate,
  type RequestMessageRun,
  type ToolArgumentKind,
} from "../lib/content";
import { jsonSegments, overlaySegments, sliceSegments, type TextSegment } from "../lib/json-highlight";
import { terminalRuns } from "../../shared/ansi";
import { decisionLabels, resultDecision, type Decision } from "../../shared/decisions";
import { Markdown } from "./markdown";
import { Highlight } from "./highlight";
import { Icon, type IconName } from "./icon";
import { duration, modelName, thinkingSummary, tokenCount } from "../lib/format";

export interface SubagentNavigation {
  targets: Record<string, { id: string; label: string }>;
  pending: boolean;
  failed: boolean;
  href: (id: string) => string;
  follow: (event: MouseEvent, id: string) => void;
  preview: (id: string) => void;
}

export interface EventCardProps {
  event: ReplayEvent;
  results?: Record<string, ContentBlock>;
  calls?: Record<string, ContentBlock>;
  highlight?: string;
  showWorkspace?: boolean;
  sessionId?: string;
  linkEvents?: boolean;
  filtered?: boolean;
  selected?: boolean;
  onShowContext?: (id: string) => void;
  subagents?: SubagentNavigation;
  /** The `api-request-blob` records written just before this API request, shown inside its card. */
  requestMessages?: RequestMessageRun;
}

// Copy controls share one short-lived state: idle, then copied or failed for 2.4 seconds after each press, and a press
// while a notice still shows starts that time again.
function createCopyState(value: () => string) {
  const [state, setState] = createSignal<{ status: "idle" | "copied" | "failed" }>({ status: "idle" });
  createEffect(
    () => state(),
    (current) => {
      if (current.status === "idle") return;
      const timeout = window.setTimeout(() => setState({ status: "idle" }), 2400);
      return () => window.clearTimeout(timeout);
    },
  );
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value());
      setState({ status: "copied" });
    } catch {
      setState({ status: "failed" });
    }
  };
  return { status: () => state().status, copy };
}

function CopyButton(props: { value: string; label?: string }) {
  const { status, copy } = createCopyState(() => props.value);
  const label = () => status() === "copied" ? "Copied" : status() === "failed" ? "Copy failed" : props.label ?? "Copy";
  return <button class="replay-copy" type="button" onClick={copy} aria-live="polite" aria-label={label()}>{label()}</button>;
}

const argumentLabels: Record<ToolArgumentKind, string> = { command: "Command", path: "Path", query: "Query", pattern: "Pattern" };

// Copies the command, path, query, or pattern a summary row previews, from the collapsed row, so a reader need not open
// the call. The button keeps one name, described by the full preview; the status beside it announces the outcome and
// the icon shows it for a moment.
function ToolCopy(props: { block: ContentBlock; describedBy: string }) {
  const argument = createMemo(() => toolArgument(props.block));
  return <Show when={argument()}>{argument => {
    const { status, copy } = createCopyState(() => argument().value);
    const label = () => `Copy ${argument().kind}`;
    const notice = () => status() === "copied" ? `${argumentLabels[argument().kind]} copied` : status() === "failed" ? "Copy failed" : "";
    return <>
      <button class="icon-button tiny tool-copy" type="button" data-state={status()} aria-label={label()} title={label()} aria-describedby={props.describedBy} onClick={copy}><Icon name={status() === "copied" ? "check" : status() === "failed" ? "alert" : "copy"} size={14} /></button>
      <span class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{notice()}</span>
    </>;
  }}</Show>;
}

// Recorded output keeps the terminal's escape sequences; the panel shows their SGR styling and drops the rest, so the
// text it measures, previews, and copies is the clean text the segments concatenate to. JSON panels highlight the
// tokens of that clean text on top of the styling.
function CodePanel(props: { title: string; value: string; terminal?: boolean; highlight?: string; json?: boolean }) {
  const [open, setOpen] = createSignal(false);
  const parsed = createMemo((): { text: string; segments: TextSegment[] } => {
    const runs = terminalRuns(props.value);
    const text = runs.map(run => run.text).join("");
    return { text, segments: props.json ? overlaySegments(runs, jsonSegments(text)) : runs };
  });
  const segments = () => parsed().segments;
  const text = () => parsed().text;
  const preview = () => {
    if (open() || text().length <= 1800) return segments();
    const match = props.highlight ? text().toLowerCase().indexOf(props.highlight.toLowerCase()) : 0;
    const start = Math.max(0, match - 450);
    return [...(start ? [{ text: "…\n" }] : []), ...sliceSegments(segments(), start, start + 1800), { text: "\n… expand for full output …" }];
  };
  return (
    <section class={`tool-code ${props.terminal ? "tool-terminal" : ""}`}>
      <header><span>{props.title}</span><CopyButton value={text()} /></header>
      <pre><code><Highlight segments={preview()} term={props.highlight || ""} /></code></pre>
      <Show when={text().length > 1800}>
        <button class="replay-text-button tool-output-toggle" type="button" aria-expanded={open() ? "true" : "false"} onClick={() => setOpen(!open())}>{open() ? "Show less" : "Show full output"}</button>
      </Show>
    </section>
  );
}

function DiffPanel(props: { input: Record<string, unknown> }) {
  const before = () => getString(props.input.old_string) ?? getString(props.input.before) ?? "";
  const after = () => getString(props.input.new_string) ?? getString(props.input.after) ?? "";
  const lines = createMemo(() => boundedDiff(before(), after()));
  return (
    <Show when={before() || after()} fallback={<CodePanel title="Edit input" value={prettyValue(props.input)} json />}>
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

function Attachment(props: { block: ContentBlock; label?: string }) {
  const [enabled, setEnabled] = createSignal(false);
  const source = () => safeDataImage(props.block.source);
  const meta = () => imageMeta(props.block.source);
  return <section class="tool-attachment"><span>{props.label ?? "Image attachment"} <span class="replay-muted">{meta().format} · {meta().size}</span></span><Show when={source()} fallback={<span class="replay-muted">Unavailable or blocked attachment</span>}><button class="replay-text-button" type="button" onClick={() => setEnabled(!enabled())}>{enabled() ? "Hide image" : "Show image"}</button><Show when={enabled()}><img src={source()} alt="Recorded image attachment" /></Show></Show></section>;
}

function ImagePanel(props: { title: string; block: ContentBlock }) {
  const [actualSize, setActualSize] = createSignal(false);
  const [dimensions, setDimensions] = createSignal("");
  const source = () => safeDataImage(props.block.source);
  const meta = () => imageMeta(props.block.source);
  const name = () => props.title.split(/[\\/]/).pop() || props.title;
  return <section class="tool-code tool-image" data-actual-size={actualSize() ? "true" : "false"}>
    <header><span>{props.title}</span><span class="tool-image-meta">{meta().format} · {meta().size}{dimensions() ? ` · ${dimensions()}` : ""}</span></header>
    <Show when={source()} fallback={<p class="tool-image-blocked replay-muted">Image not shown (unsupported or blocked format)</p>}>
      <button class="tool-image-frame" type="button" aria-pressed={actualSize() ? "true" : "false"} aria-label={actualSize() ? "Fit image to card" : "Show image at actual size"} onClick={() => setActualSize(!actualSize())}>
        <img src={source()} alt={`Image read from ${name()}`} loading="lazy" decoding="async" onLoad={(event) => setDimensions(`${event.currentTarget.naturalWidth}×${event.currentTarget.naturalHeight}`)} />
      </button>
    </Show>
  </section>;
}

function ResultImages(props: { title: string; result?: ContentBlock }) {
  return <For each={resultImages(props.result)}>{(block) => <ImagePanel title={props.title} block={block} />}</For>;
}

// The status a result gives its call: a decision the user, a permission rule, a hook, or the auto mode classifier made,
// or an interruption or cancellation, is told apart from a failure, in the glyph, the accessible name, and the card's
// tint.
type ToolStatus = "error" | "success" | "pending" | Decision;

function resultStatus(result: ContentBlock | undefined): ToolStatus {
  if (!result) return "pending";
  return resultDecision(result) ?? (result.is_error === true ? "error" : "success");
}

// The heading of a recorded result's panel: a decision is named as such, a failure as an error.
function resultTitle(result: ContentBlock | undefined, error: string, success: string): string {
  const decision = resultDecision(result);
  return decision ? decisionLabels[decision] : result?.is_error ? error : success;
}

const statusGlyphs: Record<ToolStatus, string> = { error: "!", success: "✓", pending: "→", denied: "⊘", blocked: "⊘", "auto-denied": "⊘", unreviewed: "⊘", interrupted: "⊘", cancelled: "⊘" };
const statusNames: Record<ToolStatus, string> = {
  error: "Tool error", success: "Tool success", pending: "Tool pending", denied: "Tool denied", blocked: "Tool blocked",
  "auto-denied": "Tool denied by auto mode", unreviewed: "Tool not reviewed by auto mode", interrupted: "Tool interrupted", cancelled: "Tool cancelled",
};
const statusClass = (status: ToolStatus) => status === "error" ? "tool-card-error" : status === "success" || status === "pending" ? "" : "tool-card-decision";

function ToolContent(props: { block: ContentBlock; result?: ContentBlock; highlight?: string }) {
  const input = () => getToolInput(props.block);
  const name = () => (props.block.name ?? "").toLowerCase();
  const result = () => resultText(props.result);
  const images = () => resultImages(props.result);
  const terminal = () => ["bash", "shell", "powershell"].includes(name());
  const readTitle = () => getString(input().file_path) ?? getString(input().path) ?? "Read file";
  return <div class="tool-content">
    <Show when={name() === "edit"}><DiffPanel input={input()} /></Show>
    <Show when={name() === "write"}><CodePanel title={getString(input().file_path) ?? "Written file"} value={getString(input().content) ?? prettyValue(input())} highlight={props.highlight} /></Show>
    <Show when={name() === "read" && (result() || !images().length)}><CodePanel title={readTitle()} value={result() || prettyValue(input())} highlight={props.highlight} /></Show>
    <Show when={name() === "read"}><ResultImages title={readTitle()} result={props.result} /></Show>
    <Show when={terminal()}><CodePanel title="Command" value={getString(input().command) ?? prettyValue(input())} highlight={props.highlight} terminal /><Show when={result()}><CodePanel title={resultTitle(props.result, "Command error", "Command output")} value={result()} highlight={props.highlight} terminal /></Show></Show>
    <Show when={name() === "todowrite" || name() === "todo"}><TodoPanel input={input()} /></Show>
    <Show when={name() === "task" || name() === "agent"}><section class="tool-task"><strong>{getString(input().description) ?? getString(input().subagent_type) ?? "Task"}</strong><p>{getString(input().prompt) ?? ""}</p></section></Show>
    <Show when={name() === "askuserquestion" || name() === "ask_question"}><QuestionPanel input={input()} /></Show>
    <Show when={!(["edit", "write", "read", "bash", "shell", "powershell", "todowrite", "todo", "task", "agent", "askuserquestion", "ask_question"] as string[]).includes(name())}><CodePanel title="Tool input" value={prettyValue(input())} highlight={props.highlight} json /></Show>
    <Show when={!terminal() && name() !== "read" && result()}><CodePanel title={resultTitle(props.result, "Tool error", "Tool result")} value={result()} highlight={props.highlight} /></Show>
    <Show when={name() !== "read"}><ResultImages title="Tool result image" result={props.result} /></Show>
  </div>;
}

// A call's status, name, and command, path, or query, shared by the call's own card and by a result card that names it.
function ToolLabel(props: { block: ContentBlock; status: ToolStatus; previewId?: string }) {
  const preview = createMemo(() => toolPreviewParts(props.block));
  const previewText = () => preview().head + preview().tail;
  return <><span class="tool-status" aria-label={statusNames[props.status]}>{statusGlyphs[props.status]}</span><span>{toolTitle(props.block.name)}</span><Show when={previewText()}><span class="visually-hidden" id={props.previewId}>{truncate(previewText(), 100)}</span><Show when={preview().head && preview().tail} fallback={<span class="tool-preview" aria-hidden="true" title={previewText()}>{previewText()}</span>}><span class="tool-preview tool-preview-path" aria-hidden="true" title={previewText()}><span class="tool-preview-dir">{preview().head}</span><span class="tool-preview-name">{preview().tail}</span></span></Show></Show></>;
}

function ToolUse(props: { block: ContentBlock; result?: ContentBlock; highlight?: string; subagents?: SubagentNavigation }) {
  // A highlight opens only the calls whose input or result contains it, so a highlighted replay does not unfold every call.
  const highlighted = createMemo(() => Boolean(props.highlight) && (mentions(getToolInput(props.block), props.highlight!) || mentions(resultText(props.result), props.highlight!)));
  const [open, setOpen] = createSignal(untrack(() => Boolean(props.result?.is_error || highlighted() || /^(todowrite|askuserquestion|task|agent)$/i.test(props.block.name || ""))));
  const status = () => resultStatus(props.result);
  const recording = () => props.subagents?.targets[props.block.id || ""];
  const previewId = createUniqueId();
  createEffect(() => Boolean(highlighted() || props.result?.is_error), value => { if (value) setOpen(true); });
  // The row opens the call wherever it is pressed, the disclosure glyph beside the copy button included; presses on the
  // buttons themselves are theirs alone.
  const toggleRow = (event: MouseEvent) => { if (!(event.target instanceof Element && event.target.closest("button"))) setOpen(!open()); };
  return <section class={`tool-card ${statusClass(status())}`}>
    <div class="tool-head" onClick={toggleRow}>
      <button class="tool-summary" type="button" aria-expanded={open() ? "true" : "false"} onClick={() => { setOpen(!open()); }}><ToolLabel block={props.block} status={status()} previewId={previewId} /></button>
      <ToolCopy block={props.block} describedBy={previewId} />
      <span class="tool-disclosure" aria-hidden="true">{open() ? "−" : "+"}</span>
    </div>
    <Show when={props.subagents && /^(agent|task)$/i.test(props.block.name || "")}>
      <div class="tool-subagent-link"><Show when={recording()} fallback={<span class="family-note">{props.subagents?.pending ? "Finding linked recording…" : props.subagents?.failed ? "Linked recordings unavailable. Retry from Session family." : "No linked recording available."}</span>}>{target => <>
        <span class="tool-subagent-title" title={target().label}><Icon name="branch" size={14} />{target().label}</span>
        <button class="secondary-button" onClick={() => props.subagents?.preview(target().id)}>Preview conversation</button>
        <a class="text-button" href={props.subagents!.href(target().id)} onClick={event => props.subagents?.follow(event, target().id)}>Open session<Icon name="arrow" size={13} /></a>
      </>}</Show></div>
    </Show>
    <Show when={open()}><ToolContent block={props.block} result={props.result} highlight={props.highlight} /></Show>
  </section>;
}

// A result shown apart from its call, as in the Errors view or when the call is on another page, names that call above
// its output so the reader sees what failed and not only how.
function ToolResult(props: { block: ContentBlock; call?: ContentBlock; highlight?: string }) {
  const previewId = createUniqueId();
  const images = () => contentImages(props.block.content);
  const value = () => contentToText(props.block.content) || (images().length ? "" : prettyValue(props.block.content ?? props.block));
  const status = () => resultStatus(props.block);
  const output = () => <><Show when={value()}><CodePanel title={resultTitle(props.block, "Recorded tool error", "Recorded tool result")} value={value()} highlight={props.highlight} /></Show><For each={images()}>{(block) => <Attachment block={block} label="Recorded image result" />}</For></>;
  return <section class={`tool-card tool-result ${statusClass(status())}`}><Show when={props.call} fallback={output()}>{call => <><div class="tool-head"><div class="tool-summary tool-result-call"><ToolLabel block={call()} status={status()} previewId={previewId} /></div><ToolCopy block={call()} describedBy={previewId} /></div><div class="tool-content">{output()}</div></>}</Show></section>;
}

type ThinkingMeasure = NonNullable<ReturnType<typeof thinkingMeasure>>;

// A reasoning step whose text the API kept back still has its measured time and token count, which Claude Code writes
// on the record that carries the block, so the note says how long the model thought instead of nothing at all.
function HiddenReasoning(props: { label: string; detail: string; measure?: ThinkingMeasure | null }) {
  return <p class="tool-hidden" title={props.detail}>{props.label}<Show when={props.measure}>{measure => <> · {thinkingSummary(measure())}</>}</Show></p>;
}

const turnDurationDetail = "Claude Code 2.1.27x and later write this record at the end of each turn with the time it measured from the prompt to the reply and the number of messages it then held in memory. The recording's active time is the sum of these turns. The record carries no conversation content; Raw event shows it.";

// A turn's measured time reads as a one-line note rather than as the record's fields. Like a session state note, its
// searchable text shows only when a highlighted term is in it.
function TurnDurationNote(props: { event: ReplayEvent; durationMs: number; highlight?: string }) {
  const highlighted = () => Boolean(props.highlight) && mentions(props.event.text, props.highlight!);
  const messages = () => { const count = props.event.raw.messageCount; return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null; };
  return <>
    <p class="tool-hidden turn-duration" title={turnDurationDetail}>Turn took {duration(props.durationMs)} · measured by Claude Code<Show when={messages() !== null}> · {tokenCount(messages()!)} {messages() === 1 ? "message" : "messages"} in memory</Show></p>
    <Show when={highlighted()}><CodePanel title="turn_duration record" value={props.event.text} highlight={props.highlight} json /></Show>
  </>;
}

type ApiRetry = NonNullable<ReturnType<typeof apiRetry>>;

const apiRetryDetail = "Claude Code streams this retry banner to its UI while it waits to retry a failed API request. The request it retries can still succeed, and one that fails for good is recorded as an API error turn, so the index does not count a retry as an error. Raw event shows the record.";

// A retry reads as a one-line note with its attempt and wait rather than as an error card. Like a turn's measured time,
// its searchable text shows only when a highlighted term is in it.
function ApiRetryNote(props: { event: ReplayEvent; retry: ApiRetry; highlight?: string }) {
  const highlighted = () => Boolean(props.highlight) && mentions(props.event.text, props.highlight!);
  return <>
    <p class="tool-hidden" title={apiRetryDetail}>API retry<Show when={props.retry.attempt !== null}> · attempt {props.retry.attempt}<Show when={props.retry.limit !== null}> of {props.retry.limit}</Show></Show><Show when={props.retry.waitMs !== null}> · retry after {duration(props.retry.waitMs!)}</Show></p>
    <Show when={highlighted()}><CodePanel title="api_error record" value={props.event.text} highlight={props.highlight} json /></Show>
  </>;
}

const requestMessageDetail = "Claude Code stores each message it sends to the API once, just before the request that first sends it. Assistant turns, tool calls and results, and reasoning repeat records shown elsewhere in this recording; context Claude Code composed for the request, such as hook output, may appear only here.";

// Request messages mostly repeat records the replay already shows, so they stay closed unless a highlighted term is in
// their searchable context.
function RequestMessages(props: { run: RequestMessageRun; highlight?: string }) {
  const [open, setOpen] = createSignal(false);
  createEffect(() => Boolean(props.highlight) && props.run.messages.some(event => mentions(event.text, props.highlight!)), value => { if (value) setOpen(true); });
  const count = () => props.run.messages.length;
  const title = (event: ReplayEvent) => {
    const role = isRecord(event.raw.message) ? getString(event.raw.message.role) : undefined;
    return role ? `Recorded ${role} message` : "Recorded message";
  };
  return <details class="request-messages" open={open()} onToggle={(event) => { setOpen(event.currentTarget.open); }}>
    <summary title={props.run.partial ? `${requestMessageDetail} Earlier messages for this request may be on the previous page.` : requestMessageDetail}>{count() === 1 ? "1 message" : `${count()} messages`} stored with this request{props.run.partial ? " on this page" : ""}</summary>
    <Show when={open()}><div class="request-messages-list"><For each={props.run.messages}>{(event) => <CodePanel title={title(event)} value={eventRaw(event)} highlight={props.highlight} json />}</For></div></Show>
  </details>;
}

type NoteFiling = NonNullable<ReturnType<typeof noteFiling>>;

const noteLabels: Record<NoteFiling, string> = { bookkeeping: "Bookkeeping", state: "Session state" };
const noteDetails: Record<NoteFiling, string> = {
  bookkeeping: "Claude Code writes this record for its own bookkeeping, such as file backups, the prompt to resume with, or the shape of an API request, not as part of the transcript.",
  state: "Claude Code writes this record for its own session state, such as the permission mode, a title, or cost totals, where the latest record of its kind is the current value, not as part of the transcript.",
};
const noteDetail = "It adds no conversation content or tool calls, and a prompt it repeats is searchable only on the record that holds it. Raw event shows the record.";

// A bookkeeping or state record reads as a one-line note. Its searchable text shows only when a highlighted term is in
// it, so a find match on a mode or a path is visible without opening Raw event.
function RecordNote(props: { event: ReplayEvent; filing: NoteFiling; highlight?: string }) {
  const highlighted = () => Boolean(props.highlight) && mentions(props.event.text, props.highlight!);
  return <>
    <p class="tool-hidden" title={`${noteDetails[props.filing]} ${noteDetail}`}><code>{props.event.type}</code> · kept by Claude Code, not part of the transcript</p>
    <Show when={highlighted()}><CodePanel title={`${props.event.type} record`} value={props.event.text} highlight={props.highlight} json /></Show>
  </>;
}

function ThinkingBlock(props: { block: ContentBlock; highlight?: string; measure?: ThinkingMeasure | null }) {
  const [open, setOpen] = createSignal(false);
  const text = () => getString(props.block.thinking) ?? getString(props.block.text) ?? "";
  createEffect(() => Boolean(props.highlight) && mentions(text(), props.highlight!), value => { if (value) setOpen(true); });
  if (!text()) return <HiddenReasoning label="Reasoning not returned by the API" detail="The model reasoned here, but the API's thinking display setting returned only an encrypted signature, so there is no text to show." measure={props.measure} />;
  return <details class="tool-thinking" open={open()} onToggle={(event) => { setOpen(event.currentTarget.open); }}><summary>Reasoning<Show when={props.measure}>{measure => <span class="thinking-measure"> · {thinkingSummary(measure())}</span>}</Show></summary><Show when={open()}><CodePanel title="Recorded reasoning" value={props.block.thinking ?? props.block.text ?? ""} highlight={props.highlight} /></Show></details>;
}

function BlockRenderer(props: { block: ContentBlock; results?: Record<string, ContentBlock>; calls?: Record<string, ContentBlock>; highlight?: string; subagents?: SubagentNavigation; measure?: ThinkingMeasure | null }) {
  if (props.block.type === "text") return <Markdown content={props.block.text ?? ""} highlight={props.highlight} />;
  if (props.block.type === "thinking") return <ThinkingBlock block={props.block} highlight={props.highlight} measure={props.measure} />;
  if (props.block.type === "redacted_thinking") return <HiddenReasoning label="Reasoning redacted" detail="The API encrypted this reasoning step, so there is no text to show." measure={props.measure} />;
  if (props.block.type === "tool_use") return <ToolUse block={props.block} result={props.block.id ? props.results?.[props.block.id] : undefined} highlight={props.highlight} subagents={props.subagents} />;
  if (props.block.type === "tool_result") return <ToolResult block={props.block} call={props.block.tool_use_id ? props.calls?.[props.block.tool_use_id] : undefined} highlight={props.highlight} />;
  if (isImageBlock(props.block)) return <Attachment block={props.block} />;
  return <section class="tool-unknown"><strong>Unknown block: {props.block.type || "untitled"}</strong><CodePanel title="Raw block" value={prettyValue(props.block)} json /></section>;
}

export function EventCard(props: EventCardProps) {
  const [settled, setSettled] = createSignal(false);
  const [rawOpen, setRawOpen] = createSignal(false);
  onSettled(() => {
    setSettled(true);
  });
  const role = createMemo(() => props.event.role || "system");
  const note = createMemo(() => noteFiling(props.event.type));
  // A stand-in Claude Code wrote in place of a model turn is labeled as its own, not as Claude's reply.
  const presentation = createMemo(() => note() ? "state" : isToolResultEvent(props.event) ? "tool-result" : isStandIn(props.event) ? "stand-in" : role());
  const roleLabel = createMemo(() => presentation() === "tool-result" ? "Tool result" : note() ? noteLabels[note()!] : presentation() === "stand-in" ? "Claude Code" : role());
  const roleDetail = () => presentation() === "stand-in" ? "Claude Code wrote this record itself in place of a model turn; it is not model output." : undefined;
  const errorLabel = () => isApiError(props.event) ? apiErrorLabel(props.event) : "Error";
  // Claude Code writes most bookkeeping and state without a timestamp, so a note says so instead of reporting the time as unknown.
  const timeLabel = () => presentation() === "state" && !props.event.timestamp ? "No timestamp" : formatEventTime(props.event.timestamp);
  // A glyph ahead of the label tells user and assistant turns apart at a glance; results, stand-ins, state notes, and system records keep the plain label.
  const roleIcon = createMemo((): IconName | undefined => presentation() === "user" ? "user" : presentation() === "assistant" ? "sparkle" : undefined);
  const hasBlocks = createMemo(() => props.event.blocks.length > 0);
  const measure = createMemo(() => thinkingMeasure(props.event.raw));
  const turn = createMemo(() => turnDuration(props.event.raw));
  const retry = createMemo(() => apiRetry(props.event.raw));
  const recordedModel = () => isRecord(props.event.raw.message) ? getString(props.event.raw.message.model) : undefined;
  const permalink = () => {
    const url = new URL(location.href);
    for (const key of [...url.searchParams.keys()]) if (key.startsWith("replay")) url.searchParams.delete(key);
    url.searchParams.set("session", props.sessionId || props.event.id.slice(0, 24));
    url.searchParams.set("event", props.event.id);
    url.searchParams.delete("context");
    return url.pathname + url.search;
  };
  return <article class={`replay-event replay-event-${presentation()} ${props.event.error ? "replay-event-error" : props.event.decision ? "replay-event-decision" : ""} ${props.selected ? "replay-event-selected" : ""}`} data-event-id={props.event.id} data-settled={settled() ? "true" : "false"}>
    <header class="replay-event-header"><span class="replay-role" title={roleDetail()}><Show when={roleIcon()}>{name => <Icon name={name()} size={14} class="replay-role-icon" />}</Show>{roleLabel()}</span><Show when={props.linkEvents !== false} fallback={<span class="replay-event-link"><time datetime={props.event.timestamp}>{timeLabel()}</time></span>}><a class="replay-event-link" href={permalink()} title={`Link to event ${props.event.sequence + 1}`}><time datetime={props.event.timestamp}>{timeLabel()}</time></a></Show><Show when={props.event.role === "assistant" && recordedModel() && recordedModel() !== "<synthetic>"}><span class="replay-recorded-model" title={`Recorded model: ${truncate(recordedModel()!, 256)}`}>{truncate(modelName(recordedModel()!), 80)}</span></Show><Show when={props.event.cwd && props.showWorkspace !== false}><code title={props.event.cwd}>{props.event.cwd}</code></Show><Show when={props.event.error}><span class="replay-error-label">{errorLabel()}</span></Show><Show when={props.event.decision}>{decision => <span class="replay-decision-label">{decisionLabels[decision()]}</span>}</Show></header>
    <div class="replay-event-body"><For each={props.event.blocks}>{(block) => <BlockRenderer block={block} results={props.results} calls={props.calls} highlight={props.highlight} subagents={props.subagents} measure={measure()} />}</For><Switch>
      <Match when={note()}>{filing => <RecordNote event={props.event} filing={filing()} highlight={props.highlight} />}</Match>
      <Match when={isRequestMessage(props.event)}><p class="tool-hidden" title={`${requestMessageDetail} Raw event shows this copy.`}>Message stored for the API request that follows</p></Match>
      <Match when={turn() !== null}><TurnDurationNote event={props.event} durationMs={turn()!} highlight={props.highlight} /></Match>
      <Match when={retry()}>{value => <ApiRetryNote event={props.event} retry={value()} highlight={props.highlight} />}</Match>
      <Match when={!hasBlocks() && props.event.text}><CodePanel title={`${props.event.type} record`} value={props.event.text} highlight={props.highlight} json /></Match>
      <Match when={!hasBlocks() && !props.event.text}><section class="tool-unknown">No renderable event content.</section></Match>
    </Switch><Show when={props.requestMessages}>{run => <RequestMessages run={run()} highlight={props.highlight} />}</Show></div>
    <Show when={props.filtered && props.onShowContext}><button class="replay-context-button" type="button" onClick={() => props.onShowContext?.(props.event.id)}><Icon name="arrow" size={12} />Show surrounding context</button></Show>
    <details class="replay-raw" onToggle={(event) => { setRawOpen(event.currentTarget.open); }}><summary>Raw event</summary><Show when={rawOpen()}><CodePanel title="Recorded event" value={eventRaw(props.event)} json /></Show></details>
  </article>;
}
