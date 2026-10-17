import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { deflateSync } from "node:zlib";
import { createDemo } from "../scripts/demo";
import { Recorder } from "../src/server/recorder";
import { createHandler } from "../src/server/http";

const data = resolve(".blackbox/e2e");
await createDemo(data);
const folder = join(data, "projects", "browser-regressions");
await mkdir(folder, { recursive: true });
const event = (text: string, sequence: number, type = "user") => ({
  uuid: `browser-${sequence}`, type, cwd: "/synthetic/browser-tests", timestamp: "2026-01-01T00:00:00Z",
  message: { role: type, content: text, model: "claude-sonnet-4-5" },
});
for (let index = 0; index < 55; index++) {
  await writeFile(join(folder, `pagination-${index}.jsonl`), JSON.stringify(event(`Pagination fixture ${String(index).padStart(2, "0")}`, index)) + "\n");
}
await writeFile(join(folder, "long-recording.jsonl"), Array.from({ length: 175 }, (_, index) => {
  const record = event(`Long recording event ${index}`, index);
  return JSON.stringify(index === 0 ? { ...record, diagnostics: "Synthetic diagnostic output\n".repeat(100) } : record);
}).join("\n") + "\n");
const reasoning = (sequence: number, thinking: string) => ({ ...event("", sequence, "assistant"), message: { role: "assistant", content: [{ type: "thinking", thinking, signature: "synthetic-signature" }], model: "claude-sonnet-4-5" } });
await writeFile(join(folder, "hidden-reasoning.jsonl"), [
  event("Hidden reasoning verification", 0),
  reasoning(1, ""),
  reasoning(2, "Readable reasoning summary"),
  event("Answer after reasoning", 3, "assistant"),
].map(record => JSON.stringify(record)).join("\n") + "\n");
await writeFile(join(folder, "hidden-only-reasoning.jsonl"), [event("Hidden-only reasoning verification", 0), reasoning(1, ""), event("Answer after hidden reasoning", 2, "assistant")].map(record => JSON.stringify(record)).join("\n") + "\n");
const redactedReasoning = (sequence: number) => ({ ...event("", sequence, "assistant"), message: { role: "assistant", content: [{ type: "redacted_thinking", data: "encrypted" }], model: "claude-sonnet-4-5" } });
await writeFile(join(folder, "redacted-reasoning.jsonl"), [event("Redacted reasoning verification", 0), redactedReasoning(1), event("Answer after redacted reasoning", 2, "assistant")].map(record => JSON.stringify(record)).join("\n") + "\n");
await writeFile(join(folder, "live-recording.jsonl"), JSON.stringify(event("Live update verification", 0)) + "\n");
const prose = (text: string) => `${text}\n\n${"Recorded prose that gives each card enough height to scroll. ".repeat(4)}`;
await writeFile(join(folder, "tail-recording.jsonl"), Array.from({ length: 20 }, (_, index) => JSON.stringify(event(index ? prose(`Tail recording event ${index}`) : "Tail recording verification", index, index % 2 ? "assistant" : "user"))).join("\n") + "\n");
const timelineStart = Date.parse("2026-01-02T09:00:00Z");
// Two stretches of minute-by-minute activity separated by four idle hours, for the replay activity strip.
await writeFile(join(folder, "timeline-recording.jsonl"), Array.from({ length: 200 }, (_, index) => JSON.stringify({ ...event(index ? prose(`Timeline event ${index}`) : "Timeline scrubber verification", index, index % 2 ? "assistant" : "user"), timestamp: new Date(timelineStart + (index < 100 ? index : index + 240) * 60_000).toISOString() })).join("\n") + "\n");
await writeFile(join(folder, "tail-neighbor-recording.jsonl"), JSON.stringify(event("Tail neighbor verification", 0)) + "\n");
await writeFile(join(folder, "full-page-recording.jsonl"), Array.from({ length: 60 }, (_, index) => JSON.stringify(event(index ? prose(`Full page event ${index}`) : "Full page verification", index, index % 2 ? "assistant" : "user"))).join("\n") + "\n");
await writeFile(join(folder, "late-match-recording.jsonl"), Array.from({ length: 80 }, (_, index) => JSON.stringify(event(index === 70 ? "Needleword appears late in this recording" : index ? `Late match event ${index}` : "Late match verification", index, index % 2 ? "assistant" : "user"))).join("\n") + "\n");
// One search hit in prose and one in tool output, with enough tall records on each side that the anchored card can reach the top.
const handoffCall = (sequence: number, id: string, command: string) => ({ ...event("", sequence, "assistant"), message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command } }], model: "claude-sonnet-4-5" } });
const handoffResult = (sequence: number, id: string, output: string) => ({ ...event("", sequence), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: output }] } });
await writeFile(join(folder, "search-handoff.jsonl"), [
  event("Search handoff verification", 0),
  ...Array.from({ length: 14 }, (_, index) => event(prose(`Handoff lead-in ${index + 1}`), index + 1, index % 2 ? "user" : "assistant")),
  event(`${prose("Comparing the rollout options.")}\n\nThe Lanternwick decision keeps the retry budget unchanged.`, 15, "assistant"),
  handoffCall(16, "handoff-call-1", "bun test billing"),
  handoffResult(17, "handoff-call-1", "Quillmoss check passed after 3 attempts"),
  ...Array.from({ length: 14 }, (_, index) => event(prose(`Handoff follow-up ${index + 1}`), index + 18, index % 2 ? "user" : "assistant")),
].map(record => JSON.stringify(record)).join("\n") + "\n");
// A call and its output that both contain the find term fold onto one Conversation card, once beside a separate match
// and once with no other match at all.
await writeFile(join(folder, "folded-find.jsonl"), [
  event("Kettlewing fold verification", 0),
  handoffCall(1, "folded-call-1", "grep -rn Brambleworth logs"),
  handoffResult(2, "folded-call-1", "logs/app.log: Brambleworth retry scheduled"),
  event("The Brambleworth report is ready.", 3, "assistant"),
].map(record => JSON.stringify(record)).join("\n") + "\n");
await writeFile(join(folder, "folded-only-find.jsonl"), [
  event("Saltmarsh fold verification", 0),
  handoffCall(1, "folded-call-2", "cat Quarrystone.log"),
  handoffResult(2, "folded-call-2", "Quarrystone ok"),
  event("Finished reading the log.", 3, "assistant"),
].map(record => JSON.stringify(record)).join("\n") + "\n");
// Local command output and a Bash result that carry the terminal's escape sequences, which browsers would draw as boxes.
const sgr = (code: string) => `\u001b[${code}m`;
export const terminalProse = "Added C:\\code\\csii\\ingest-dealer-config as a working directory for this session · /permissions to manage";
await writeFile(join(folder, "terminal-styling.jsonl"), [
  event("Terminal styling verification", 0),
  event("<command-name>/add-dir</command-name><command-message>add-dir</command-message><command-args>C:\\code\\csii\\ingest-dealer-config</command-args>", 1),
  event(`<local-command-stdout>Added ${sgr("1")}C:\\code\\csii\\ingest-dealer-config${sgr("22")} as a working directory for this session ${sgr("2")}· /permissions to manage${sgr("22")}</local-command-stdout>`, 2),
  handoffCall(3, "terminal-call-1", "bun test tests/terminal.test.ts"),
  handoffResult(4, "terminal-call-1", `${sgr("32")}✓${sgr("0")} renders ${sgr("1;4")}styled${sgr("0")} output\n${sgr("38;5;208")}warning${sgr("39")} and ${sgr("38;2;200;100;50")}truecolor${sgr("0")} ${sgr("7")}inverse${sgr("0")}\n\u001b]0;window title\u0007plain tail\u001b[2K\u001b[1A`),
].map(record => JSON.stringify(record)).join("\n") + "\n");
await writeFile(join(folder, "system-interleaved-recording.jsonl"), Array.from({ length: 70 }, (_, index) => JSON.stringify(event(index ? `Interleaved event ${index}` : "System interleaved verification", index, index > 0 && index <= 5 ? "system" : index % 2 ? "assistant" : "user"))).join("\n") + "\n");
await writeFile(join(folder, "filtered-live-recording.jsonl"), JSON.stringify(event("Filtered live verification", 0)) + "\n");
await writeFile(join(folder, "unsafe-markdown.jsonl"), [event("Unsafe markdown verification", 0), event('<script>window.blackboxXss = true</script><img src="https://blocked.invalid/pixel" onerror="window.blackboxXss = true"><p class="nav-scrim">Untrusted styling</p>\n[Unsafe](javascript:alert(1))\n![Remote image](https://blocked.invalid/image)\n## Safe content', 1, "assistant")].map(record => JSON.stringify(record)).join("\n") + "\n");
const markdownRhythm = [
  "# Opening heading",
  "Introductory paragraph.",
  "## After a paragraph",
  "| Area | Decision |\n| --- | --- |\n| Scope | Keep the change focused |",
  "### After a table",
  "- Parent item\n  - Nested item\n- Sibling item",
  "#### After a list",
  "```ts\nconst result = await verifySpacing()\n```",
  "##### After code",
  "> Quoted context.\n>\n> Another quoted paragraph.",
  "###### After a quote",
  "---",
  "# After a divider",
  "Closing paragraph.",
].join("\n\n");
await writeFile(join(folder, "markdown-rhythm.jsonl"), [event("Markdown rhythm verification", 0), event(markdownRhythm, 1, "assistant")].map(record => JSON.stringify(record)).join("\n") + "\n");
const markdownWrapping = [
  "# Natural wrapping",
  "Soft-wrapped prose stays\non one line when there is room.",
  "A separate paragraph stays separate.",
  "Two-space hard break.  \nStill explicit.",
  "Backslash hard break.\\\nStill explicit.",
  "HTML hard break.<br>Still explicit.",
  "- A list item with a soft newline\n  continues naturally.\n- A separate list item.",
  "> A quote with a soft newline\n> continues naturally.",
  "```ts\nconst first = 1;\nconst second = 2;\n```",
  "Long prose wraps at the available edge instead of a fixed character count. ".repeat(30),
  `Unbroken token: ${"abcdefghij".repeat(50)}`,
].join("\n\n");
await writeFile(join(folder, "markdown-wrapping.jsonl"), [event("Markdown wrapping verification", 0), event(markdownWrapping, 1, "assistant")].map(record => JSON.stringify(record)).join("\n") + "\n");
const workspaceTransitions = [
  event("Workspace transitions verification", 0),
  event("Continuing in the original directory", 1, "assistant"),
  { ...event("Entered a worktree", 2), cwd: "/synthetic/browser-tests-worktree" },
  { ...event("Continuing in the worktree", 3, "assistant"), cwd: "/synthetic/browser-tests-worktree" },
  { ...event("No working directory recorded", 4), cwd: undefined },
  { ...event("Still in the worktree", 5, "assistant"), cwd: "/synthetic/browser-tests-worktree" },
  event("Returned to the original directory", 6),
];
await writeFile(join(folder, "workspace-transitions.jsonl"), workspaceTransitions.map(record => JSON.stringify(record)).join("\n") + "\n");
const hookRecord = {
  uuid: "browser-hook-1", parentUuid: "browser-0", isSidechain: false, type: "attachment", cwd: "/synthetic/browser-tests", timestamp: "2026-01-01T00:00:01Z",
  attachment: {
    type: "hook_success", hookName: "PreToolUse:Bash", toolUseID: "toolu_synthetic_hook", hookEvent: "PreToolUse", content: "",
    stdout: '{\n  "continue": true,\n  "hookSpecificOutput": {\n    "hookEventName": "PreToolUse",\n    "additionalContext": "Use parallel execution for independent tasks."\n  }\n}\n',
    stderr: "", exitCode: 0,
  },
};
await writeFile(join(folder, "json-highlighting.jsonl"), [event("JSON highlighting verification", 0), hookRecord].map(record => JSON.stringify(record)).join("\n") + "\n");
const tinyPng = (width: number, height: number, rgb: [number, number, number]) => {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(Buffer.from(type, "ascii"), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(rgb, y * (1 + width * 3) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]).toString("base64");
};
const imageSource = { type: "base64", media_type: "image/png", data: tinyPng(16, 12, [199, 238, 121]) };
const imageRead = (id: string, file_path: string) => ({ type: "tool_use", id, name: "Read", input: { file_path } });
await writeFile(join(folder, "image-read.jsonl"), [
  event("Image read verification", 0),
  { ...event("", 1, "assistant"), message: { role: "assistant", content: [imageRead("read-image-1", "/synthetic/browser-tests/docs/screenshot.png"), imageRead("read-mixed-1", "/synthetic/browser-tests/docs/mixed.png"), imageRead("read-svg-1", "/synthetic/browser-tests/docs/diagram.svg")] } },
  { ...event("", 2), message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "read-image-1", content: [{ type: "image", source: imageSource }] },
    { type: "tool_result", tool_use_id: "read-mixed-1", content: [{ type: "text", text: "Mixed image result caption" }, { type: "image", source: imageSource }] },
    { type: "tool_result", tool_use_id: "read-svg-1", content: [{ type: "image", source: { type: "base64", media_type: "image/svg+xml", data: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>").toString("base64") } }] },
  ] } },
  { ...event("", 3), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "read-unpaired-1", content: [{ type: "image", source: imageSource }] }] } },
  { ...event("", 4, "assistant"), message: { role: "assistant", content: [{ type: "text", text: "Attached a document block" }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-1.4").toString("base64") } }] } },
].map(record => JSON.stringify(record)).join("\n") + "\n");
export const longPreviewCommand = `bun test ${Array.from({ length: 3 }, (_, index) => `tests/synthetic-preview-suite-${index + 1}.test.ts`).join(" ")} --timeout 30000 --bail`;
export const longPreviewPath = "/synthetic/browser-tests/packages/recorder-preview/src/components/replay/summaries/very-deeply-nested-folder/tool-preview-target.tsx";
await writeFile(join(folder, "long-tool-preview.jsonl"), [
  event("Long tool preview verification", 0),
  { ...event("", 1, "assistant"), message: { role: "assistant", content: [
    { type: "tool_use", id: "long-preview-bash", name: "Bash", input: { command: longPreviewCommand } },
    { type: "tool_use", id: "long-preview-read", name: "Read", input: { file_path: longPreviewPath } },
    { type: "tool_use", id: "long-preview-mcp", name: "mcp__playwright__browser_run_code", input: { description: longPreviewCommand } },
  ] } },
].map(record => JSON.stringify(record)).join("\n") + "\n");
// A call for each kind of argument the summary row offers to copy, a delegated task that offers none, and a failing
// command whose result card carries the same control on the Errors tab.
export const copyCommand = "bun run build &&\n  bun test tests \\\n    --timeout 30000 # quiet";
export const copyReadPath = "C:\\code\\fantomc0der\\roundup\\hooks\\register.test.ts";
const copyCall = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });
const copyResult = (id: string, content: string, is_error = false) => ({ type: "tool_result", tool_use_id: id, content, is_error });
await writeFile(join(folder, "tool-copy.jsonl"), [
  event("Hazelbrook copy verification", 0),
  { ...event("", 1, "assistant"), message: { role: "assistant", content: [
    copyCall("copy-bash", "Bash", { command: `  ${copyCommand.replace("# quiet", `${sgr("2")}# quiet${sgr("22")}`)}\n` }),
    copyCall("copy-read", "Read", { file_path: copyReadPath }),
    copyCall("copy-write", "Write", { file_path: "/synthetic/copy/notes.md", content: "# Notes\n" }),
    copyCall("copy-notebook", "NotebookEdit", { notebook_path: "/synthetic/copy/analysis.ipynb", new_source: "print(1)" }),
    copyCall("copy-grep", "Grep", { pattern: "quillfeather", path: "/synthetic/copy/src" }),
    copyCall("copy-search", "WebSearch", { query: "bun test timeout flag" }),
    copyCall("copy-agent", "Agent", { description: "Review worker", prompt: "Review the change." }),
    copyCall("copy-fail", "Bash", { command: "bun test tests/flaky.test.ts" }),
  ], model: "claude-sonnet-4-5" } },
  { ...event("", 2), message: { role: "user", content: [
    copyResult("copy-bash", "built"), copyResult("copy-read", "import { test } from \"bun:test\""), copyResult("copy-write", "Wrote 8 bytes"),
    copyResult("copy-notebook", "Updated cell"), copyResult("copy-grep", "src/retry.ts:3: quillfeather"), copyResult("copy-search", "No results"),
    copyResult("copy-agent", "Done"), copyResult("copy-fail", "1 fail", true),
  ] } },
].map(record => JSON.stringify(record)).join("\n") + "\n");
// Claude Code stores the messages an API request adds as untimed `api-request-blob` copies just before the request. The
// second request's copy ends the first replay page, apart from its request at the top of the next one.
const requestBlob = (hash: string, message: Record<string, unknown>) => ({ type: "api-request-blob", sessionId: "request-copies", hash, message });
const apiRequest = (sequence: number, tail: string[]) => ({ type: "api-request", sessionId: "request-copies", id: `copy-request-${sequence}`, timestamp: "2026-01-01T00:00:05Z", tail });
await writeFile(join(folder, "request-copies.jsonl"), [
  event("Request copy verification", 0),
  handoffCall(1, "request-copy-call", "bun test tests/marshwick.test.ts"),
  handoffResult(2, "request-copy-call", "Marshwick suite passed"),
  requestBlob("copy-hash-1", { role: "assistant", content: [{ type: "tool_use", id: "request-copy-call", name: "Bash", input: { command: "bun test tests/marshwick.test.ts" } }] }),
  requestBlob("copy-hash-2", { role: "user", content: [{ type: "tool_result", tool_use_id: "request-copy-call", content: "Marshwick suite passed" }] }),
  apiRequest(5, ["copy-hash-1", "copy-hash-2"]),
  ...Array.from({ length: 53 }, (_, index) => event(`Request copy filler ${index + 1}`, index + 6, index % 2 ? "user" : "assistant")),
  requestBlob("copy-hash-3", { role: "user", content: "Request copy follow-up" }),
  apiRequest(60, ["copy-hash-3"]),
].map(record => JSON.stringify(record)).join("\n") + "\n");
// When an API request fails for good, Claude Code records the failure itself as an `assistant` record with the
// `<synthetic>` model, marked `isApiErrorMessage`; `No response requested.` is another stand-in it writes the same way.
const standIn = (sequence: number, text: string, extra: Record<string, unknown> = {}) => ({ ...event(text, sequence, "assistant"), ...extra,
  message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text }], usage: { input_tokens: 0, output_tokens: 0 } } });
await writeFile(join(folder, "api-errors.jsonl"), [
  event("API error verification", 0),
  standIn(1, 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', { isApiErrorMessage: true, error: "rate_limit", apiError: { status: 529 } }),
  standIn(2, "No response requested."),
  event("The login test passes after the retry.", 3, "assistant"),
].map(record => JSON.stringify(record)).join("\n") + "\n");
await writeFile(join(folder, "subagent-parent.jsonl"),Array.from({ length: 65 }, (_, index) => JSON.stringify({ ...event(index === 0 ? "Subagent preview parent" : `Parent event ${index}`, index), sessionId: "subagent-parent" })).join("\n") + "\n");
const agentsFolder = join(folder, "subagent-parent", "subagents");
await mkdir(agentsFolder, { recursive: true });
for (const name of ["first", "second"]) {
  await writeFile(join(agentsFolder, `agent-${name}.jsonl`), Array.from({ length: 45 }, (_, index) => {
    const record = event(index === 0 ? `Subagent child ${name}` : `Delegate ${name} event ${index}\n\nRecorded findings from the delegated task.`, index, index ? "assistant" : "user");
    return JSON.stringify({
      ...record, uuid: `agent-${name}-${index}`, sessionId: "subagent-parent", isSidechain: true, cwd: "/synthetic/delegated-worktree",
      message: index ? { ...record.message, usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } : record.message,
    });
  }).join("\n") + "\n");
}
const familyRootId = "session-family-root";
const familyAgent = (id: string, description: string, prompt: string, name = "Agent") => ({ type: "tool_use", id, name, input: { description, prompt } });
const familyResult = (toolUseId: string, agentId: string) => ({ type: "tool_result", tool_use_id: toolUseId, content: `agentId: ${agentId}` });
const familyRecord = (title: string, sessionId: string, agentId: string, parentUuid: string, sequence: number, type = "user") => ({
  ...event(title, sequence, type), uuid: `${sessionId}-${sequence}`, sessionId, agentId, parentUuid,
  isSidechain: true, cwd: "/synthetic/session-family", customTitle: sequence ? undefined : title,
});
await writeFile(join(folder, `${familyRootId}.jsonl`), [
  { ...event("Session family root", 0), uuid: "family-root-user", sessionId: familyRootId, customTitle: "Session family root" },
  { ...event("", 1, "assistant"), uuid: "family-root-launches", sessionId: familyRootId, message: { role: "assistant", content: [
    familyAgent("family-child-tool", "Implementation worker", "Inspect the implementation path."),
    familyAgent("family-sibling-tool", "Review worker", "Review the sibling change.", "Task"),
    familyAgent("family-missing-tool", "Unavailable worker", "This launch has no recording."),
  ], model: "claude-sonnet-4-5" } },
  { ...event("", 2), uuid: "family-root-results", sessionId: familyRootId, message: { role: "user", content: [
    familyResult("family-child-tool", "family-child"), familyResult("family-sibling-tool", "family-sibling"),
  ], model: "claude-sonnet-4-5" } },
  { ...event("Root conclusion", 3, "assistant"), uuid: "family-root-conclusion", sessionId: familyRootId },
].map(record => JSON.stringify(record)).join("\n") + "\n");
const familyFolder = join(folder, familyRootId, "subagents");
const familyChild = (title: string, sessionId: string, agentId: string, parentUuid: string) => [
  familyRecord(title, sessionId, agentId, parentUuid, 0),
  familyRecord("System-only family row", sessionId, agentId, parentUuid, 1, "system"),
  familyRecord(`${title} conversation result`, sessionId, agentId, parentUuid, 2, "assistant"),
];
await mkdir(familyFolder, { recursive: true });
await rm(join(familyFolder, "agent-family-orphan.jsonl"), { force: true });
await writeFile(join(familyFolder, "agent-family-child.jsonl"), [...familyChild("Implementation worker", "family-child", "family-child-tool", "family-root-launches"), {
  ...familyRecord("", "family-child", "family-child-tool", "family-child-2", 3, "assistant"), uuid: "family-child-launches",
  message: { role: "assistant", content: [familyAgent("family-nested-tool", "Nested implementation worker", "Inspect the nested implementation path.")], model: "claude-sonnet-4-5" },
}, {
  ...familyRecord("", "family-child", "family-child-tool", "family-child-launches", 4), uuid: "family-child-results",
  message: { role: "user", content: [familyResult("family-nested-tool", "family-nested")], model: "claude-sonnet-4-5" },
}].map(record => JSON.stringify(record)).join("\n") + "\n");
await writeFile(join(familyFolder, "agent-family-sibling.jsonl"), familyChild("Review worker", "family-sibling", "family-sibling-tool", "family-root-launches").map(record => JSON.stringify(record)).join("\n") + "\n");
const nestedFolder = join(familyFolder, "agent-family-child", "subagents");
await mkdir(nestedFolder, { recursive: true });
await writeFile(join(nestedFolder, "agent-family-nested.jsonl"), familyChild("Nested implementation worker", "family-nested", "family-nested-tool", "family-child-launches").map(record => JSON.stringify(record)).join("\n") + "\n");
const orphanFolder = join(folder, "missing-root", "subagents");
await mkdir(orphanFolder, { recursive: true });
await writeFile(join(orphanFolder, "agent-family-orphan.jsonl"), familyChild("Orphan worker", "missing-root", "family-orphan-tool", "missing-parent-event").map(record => JSON.stringify(record)).join("\n") + "\n");
// The overview's Files changed view: a working folder, two folders added with /add-dir (one left unchanged), an
// /add-dir that only names a folder inside the working one, a file outside every folder, a file in Claude Code's
// scratchpad, a Write whose result is an error, reads, and enough prose between them that the later changes sit on the
// second page.
const overviewStart = Date.parse("2026-01-04T15:00:00Z");
let overviewSequence = 0;
const overviewRecord = (record: Record<string, unknown>) => {
  const sequence = overviewSequence++;
  return { uuid: `overview-${sequence}`, cwd: "/synthetic/overview-app", timestamp: new Date(overviewStart + sequence * 60_000).toISOString(), ...record };
};
const overviewText = (text: string, type = "user", extra: Record<string, unknown> = {}) => overviewRecord({ type, message: { role: type, content: text, model: "claude-sonnet-4-5" }, ...extra });
const overviewCall = (id: string, name: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => overviewRecord({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }], model: "claude-sonnet-4-5" }, ...extra });
const overviewResult = (id: string, content: string, is_error = false, extra: Record<string, unknown> = {}) => overviewRecord({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error }] }, ...extra });
const overviewAddDir = (path: string, output: string) => {
  const command = overviewText(`<command-name>/add-dir</command-name>\n            <command-message>add-dir</command-message>\n            <command-args>${path}</command-args>`);
  return [command, overviewText(`<local-command-stdout>${output}</local-command-stdout>`, "user", { parentUuid: command.uuid })];
};
await writeFile(join(folder, "overview-files.jsonl"), [
  overviewText("Overview files verification"),
  overviewCall("overview-read-1", "Read", { file_path: "/synthetic/overview-app/README.md" }),
  overviewResult("overview-read-1", "# Overview app"),
  overviewCall("overview-edit-1", "Edit", { file_path: "src/app.ts", old_string: "const ready = false;", new_string: "const ready = true;" }),
  overviewResult("overview-edit-1", "The file src/app.ts has been updated."),
  overviewCall("overview-write-1", "Write", { file_path: "/synthetic/overview-app/src/config/defaults.json", content: "{}" }),
  overviewResult("overview-write-1", "Permission to write was denied.", true),
  ...overviewAddDir("/synthetic/overview-shared", `Added ${sgr("1")}/synthetic/overview-shared${sgr("22")} as a working directory for this session ${sgr("2")}· /permissions to manage${sgr("22")}`),
  ...overviewAddDir("/synthetic/overview-archive", `Added ${sgr("1")}/synthetic/overview-archive${sgr("22")} as a working directory for this session ${sgr("2")}· /permissions to manage${sgr("22")}`),
  ...overviewAddDir("/synthetic/overview-app/docs", `${sgr("1")}/synthetic/overview-app/docs${sgr("22")} is inside the current working directory ${sgr("1")}/synthetic/overview-app${sgr("22")}; loading its skills`),
  ...Array.from({ length: 62 }, (_, index) => overviewText(prose(`Overview filler ${index + 1}`), index % 2 ? "user" : "assistant")),
  overviewCall("overview-edit-2", "Edit", { file_path: "/synthetic/overview-shared/lib/format.ts", old_string: "a", new_string: "b" }),
  overviewResult("overview-edit-2", "The file has been updated."),
  overviewCall("overview-edit-3", "MultiEdit", { file_path: "src/app.ts", edits: [{ old_string: "true", new_string: "false" }] }),
  overviewResult("overview-edit-3", "Applied 1 edit."),
  overviewCall("overview-edit-4", "Edit", { file_path: "/synthetic/elsewhere/notes.md", old_string: "a", new_string: "b" }),
  overviewResult("overview-edit-4", "The file has been updated."),
  overviewCall("overview-write-2", "Write", { file_path: "/tmp/claude-1000/-synthetic-overview-app/5d2c7f1e-8a4b-4c3d-9e6f-0a1b2c3d4e5f/scratchpad/check.py", content: "print('ok')" }),
  overviewResult("overview-write-2", "File created successfully."),
  overviewText("The overview files are ready.", "assistant"),
].map(record => JSON.stringify(record)).join("\n") + "\n");
export const recorder = await Recorder.open(data, resolve(".blackbox/e2e-state"));
recorder.db.exec("DELETE FROM bookmarks; DELETE FROM groups;");
recorder.watch(250);
export const server = Bun.serve({ hostname: "127.0.0.1", port: 12003, idleTimeout: 60, fetch: createHandler({ recorder }) });
const close = async () => { await server.stop(true); await recorder.close(); process.exit(0); };
process.on("SIGINT", close);
process.on("SIGTERM", close);
