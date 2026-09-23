import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
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
export const recorder = await Recorder.open(data, resolve(".blackbox/e2e-state"));
recorder.db.exec("DELETE FROM bookmarks; DELETE FROM groups;");
recorder.watch(250);
export const server = Bun.serve({ hostname: "127.0.0.1", port: 12003, idleTimeout: 60, fetch: createHandler({ recorder }) });
const close = async () => { await server.stop(true); await recorder.close(); process.exit(0); };
process.on("SIGINT", close);
process.on("SIGTERM", close);
