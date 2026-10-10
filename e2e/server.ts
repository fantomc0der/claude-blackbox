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
await writeFile(join(folder, "subagent-parent.jsonl"),Array.from({ length: 65 }, (_, index) => JSON.stringify({ ...event(index === 0 ? "Subagent preview parent" : `Parent event ${index}`, index), sessionId: "subagent-parent" })).join("\n") + "\n");
const agentsFolder = join(folder, "subagent-parent", "subagents");
await mkdir(agentsFolder, { recursive: true });
for (const name of ["first", "second"]) {
  await writeFile(join(agentsFolder, `agent-${name}.jsonl`), Array.from({ length: 45 }, (_, index) => JSON.stringify({
    ...event(index === 0 ? `Subagent child ${name}` : `Delegate ${name} event ${index}\n\nRecorded findings from the delegated task.`, index, index ? "assistant" : "user"),
    sessionId: "subagent-parent", isSidechain: true, cwd: "/synthetic/delegated-worktree",
  })).join("\n") + "\n");
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
export const recorder = await Recorder.open(data, resolve(".blackbox/e2e-state"));
recorder.db.exec("DELETE FROM bookmarks; DELETE FROM groups;");
recorder.watch(250);
export const server = Bun.serve({ hostname: "127.0.0.1", port: 12003, idleTimeout: 60, fetch: createHandler({ recorder }) });
const close = async () => { await server.stop(true); await recorder.close(); process.exit(0); };
process.on("SIGINT", close);
process.on("SIGTERM", close);
