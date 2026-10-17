import { describe, expect, test } from "bun:test";
import { apiErrorLabel, boundedDiff, contentToText, imageMeta, mentions, mentionsBudget, requestMessageRuns, resultImages, resultText, safeDataImage, toolArgument, toolPreview, toolPreviewParts, toolTitle } from "../src/client/lib/content";
import type { ReplayEvent } from "../src/shared/types";

describe("replay content helpers", () => {
  test("labels an API error with the recorded kind and HTTP status when they are usable", () => {
    expect(apiErrorLabel({ raw: { isApiErrorMessage: true, error: "rate_limit", apiError: { status: 529 } } })).toBe("API error · rate limit · HTTP 529");
    expect(apiErrorLabel({ raw: { isApiErrorMessage: true, error: "billing_error" } })).toBe("API error · billing error");
    expect(apiErrorLabel({ raw: { isApiErrorMessage: true, error: "unknown", apiError: { status: 500 } } })).toBe("API error · HTTP 500");
    expect(apiErrorLabel({ raw: { isApiErrorMessage: true, error: "", apiError: { status: "529" } } })).toBe("API error");
    expect(apiErrorLabel({ raw: { isApiErrorMessage: true, error: 7, apiError: { status: 9000 } } })).toBe("API error");
    expect(apiErrorLabel({ raw: { isApiErrorMessage: true, error: "x".repeat(80), apiError: 529 } })).toBe(`API error · ${"x".repeat(39)}…`);
  });

  test("keeps mixed nested content in source order", () => {
    expect(contentToText([{ type: "text", text: "first" }, { type: "thinking", thinking: "second" }, { type: "text", text: "third" }])).toBe("first\nsecond\nthird");
  });

  test("makes a bounded diff with explicit changed lines", () => {
    expect(boundedDiff("one\ntwo", "one\nthree")).toEqual([{ kind: "same", value: "one" }, { kind: "removed", value: "two" }, { kind: "added", value: "three" }]);
  });

  test("keeps the actual changed line visible inside a long file", () => {
    const before = Array.from({ length: 300 }, (_, index) => `line ${index}`);
    const after = [...before];
    after[150] = "the important change";
    const lines = boundedDiff(before.join("\n"), after.join("\n"));
    expect(lines.some(line => line.kind === "added" && line.value === "the important change")).toBe(true);
    expect(lines.length).toBeLessThan(80);
  });

  test("only accepts supported base64 image attachments", () => {
    expect(safeDataImage({ type: "base64", media_type: "image/png", data: "aGVsbG8=" })).toBe("data:image/png;base64,aGVsbG8=");
    expect(safeDataImage({ type: "url", media_type: "image/png", data: "https://example.com/image.png" })).toBeUndefined();
  });

  test("normalizes recorded JPEG media types and rejects script-capable ones", () => {
    expect(safeDataImage({ type: "base64", media_type: "image/jpeg", data: "/9j/4AAQ" })).toBe("data:image/jpeg;base64,/9j/4AAQ");
    expect(safeDataImage({ type: "base64", media_type: "image/jpg", data: "/9j/4AAQ" })).toBe("data:image/jpeg;base64,/9j/4AAQ");
    expect(safeDataImage({ type: "base64", media_type: "IMAGE/JPEG; charset=binary", data: "/9j/4AAQ" })).toBe("data:image/jpeg;base64,/9j/4AAQ");
    expect(safeDataImage({ type: "base64", media_type: "image/bmp", data: "Qk0=" })).toBe("data:image/bmp;base64,Qk0=");
    expect(safeDataImage({ type: "base64", media_type: "image/svg+xml", data: "PHN2Zy8+" })).toBeUndefined();
    expect(imageMeta({ type: "base64", media_type: "image/jpg", data: "/9j/4AAQ" })).toEqual({ format: "JPEG", size: "6 B" });
  });

  test("separates image blocks from tool result text instead of dumping base64", () => {
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
    const imageOnly = { type: "tool_result", tool_use_id: "read-1", content: [image] };
    expect(resultText(imageOnly)).toBe("");
    expect(resultImages(imageOnly)).toEqual([image]);
    const mixed = { type: "tool_result", tool_use_id: "read-2", content: [{ type: "text", text: "caption" }, image] };
    expect(resultText(mixed)).toBe("caption");
    expect(resultImages(mixed)).toHaveLength(1);
    expect(resultText({ type: "tool_result", tool_use_id: "read-3", content: [{ type: "unknown" }] })).toContain("unknown");
    expect(resultImages(undefined)).toEqual([]);
    const document = { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } };
    const documentOnly = { type: "tool_result", tool_use_id: "read-4", content: [document] };
    expect(resultImages(documentOnly)).toEqual([]);
    expect(resultText(documentOnly)).toContain("application/pdf");
  });

  test("describes recorded images by format and decoded size", () => {
    expect(imageMeta({ type: "base64", media_type: "image/png", data: "aGVsbG8=" })).toEqual({ format: "PNG", size: "5 B" });
    expect(imageMeta({ type: "base64", media_type: "image/jpeg", data: "A".repeat(4000) })).toEqual({ format: "JPEG", size: "3 KB" });
    expect(imageMeta({ type: "base64", media_type: "image/svg+xml", data: "" })).toEqual({ format: "SVG", size: "0 B" });
    expect(imageMeta(undefined)).toEqual({ format: "Image", size: "0 B" });
  });

  test("keeps recorded tool names and unpacks MCP tool identifiers", () => {
    expect(toolTitle("AskUserQuestion")).toBe("AskUserQuestion");
    expect(toolTitle("TodoWrite")).toBe("TodoWrite");
    expect(toolTitle("mcp__playwright__browser_click")).toBe("playwright · browser_click");
    expect(toolTitle()).toBe("Tool");
  });

  test("leaves tool previews long enough for wide viewports to show", () => {
    const command = `bun test ${"tests/a-fairly-long-test-file-name.test.ts ".repeat(8)}--timeout 30000`;
    expect(toolPreview({ type: "tool_use", name: "Bash", input: { command: `  ${command}\n` } })).toBe(command);
    expect(toolPreview({ type: "tool_use", name: "Bash", input: { command: "x".repeat(5000) } })).toHaveLength(1000);
  });

  test("splits path previews before the file name", () => {
    expect(toolPreviewParts({ type: "tool_use", name: "Read", input: { file_path: "C:\\code\\app\\src\\index.ts" } })).toEqual({ head: "C:\\code\\app\\src\\", tail: "index.ts" });
    expect(toolPreviewParts({ type: "tool_use", name: "Glob", input: { pattern: "**/*.ts", path: "/repo/src/" } })).toEqual({ head: "/repo/src/", tail: "" });
    expect(toolPreviewParts({ type: "tool_use", name: "Edit", input: { file_path: "README.md" } })).toEqual({ head: "", tail: "README.md" });
    expect(toolPreviewParts({ type: "tool_use", name: "Read", input: { file_path: "C:\\code/app\\src/index.ts" } })).toEqual({ head: "C:\\code/app\\src/", tail: "index.ts" });
    expect(toolPreviewParts({ type: "tool_use", name: "NotebookEdit", input: { notebook_path: "/repo/analysis.ipynb", new_source: "print(1)" } })).toEqual({ head: "/repo/", tail: "analysis.ipynb" });
    const deep = toolPreviewParts({ type: "tool_use", name: "Read", input: { file_path: `/${"nested/".repeat(200)}index.ts` } });
    expect(deep.tail).toBe("index.ts");
    expect(deep.head.length + deep.tail.length).toBe(1000);
    expect(deep.head).toStartWith("…");
    expect(deep.head).toEndWith("nested/");
  });

  test("offers the previewed command, path, query, or pattern for copying, whole and clean", () => {
    expect(toolArgument({ type: "tool_use", name: "Bash", input: { command: "  bun run build &&\n  bun test \u001b[2m# quiet\u001b[22m\n" } })).toEqual({ kind: "command", value: "bun run build &&\n  bun test # quiet" });
    expect(toolArgument({ type: "tool_use", name: "Bash", input: { command: "x".repeat(5000) } })?.value).toHaveLength(5000);
    expect(toolArgument({ type: "tool_use", name: "Read", input: { file_path: "C:\\code\\app\\src\\index.ts" } })).toEqual({ kind: "path", value: "C:\\code\\app\\src\\index.ts" });
    expect(toolArgument({ type: "tool_use", name: "Write", input: { file_path: "notes.md", content: "# Notes" } })).toEqual({ kind: "path", value: "notes.md" });
    expect(toolArgument({ type: "tool_use", name: "NotebookEdit", input: { notebook_path: "/repo/analysis.ipynb", new_source: "print(1)" } })).toEqual({ kind: "path", value: "/repo/analysis.ipynb" });
    expect(toolArgument({ type: "tool_use", name: "Grep", input: { pattern: "retry", path: "/repo/src" } })).toEqual({ kind: "path", value: "/repo/src" });
    expect(toolArgument({ type: "tool_use", name: "Grep", input: { pattern: "retry" } })).toEqual({ kind: "pattern", value: "retry" });
    expect(toolArgument({ type: "tool_use", name: "WebSearch", input: { query: "bun test timeout" } })).toEqual({ kind: "query", value: "bun test timeout" });
    expect(toolArgument({ type: "tool_use", name: "Agent", input: { description: "Review worker", prompt: "Review the change." } })).toBeUndefined();
    expect(toolArgument({ type: "tool_use", name: "Bash", input: { command: "\u001b[2m\u001b[22m" } })).toBeUndefined();
    expect(toolArgument({ type: "tool_use", name: "Read", input: {} })).toBeUndefined();
    expect(toolArgument({ type: "tool_use", name: "Read" })).toBeUndefined();
  });

  test("previews the argument it offers for copying", () => {
    const blocks = [
      { type: "tool_use", name: "Bash", input: { command: "  bun test\n  --bail\n" } },
      { type: "tool_use", name: "Read", input: { file_path: "/repo/src/index.ts" } },
      { type: "tool_use", name: "Grep", input: { pattern: "retry", path: "/repo/src" } },
      { type: "tool_use", name: "WebSearch", input: { query: "bun test timeout" } },
    ];
    for (const block of blocks) expect(toolPreview(block)).toBe(toolArgument(block)!.value.replace(/\s+/g, " "));
  });

  test("finds a highlight term in nested recorded values without regard to case", () => {
    const input = { command: "bun test", options: [{ label: "Retry budget" }], attempts: 3, quiet: true };
    expect(mentions(input, "retry")).toBe(true);
    expect(mentions(input, "BUN TEST")).toBe(true);
    expect(mentions(input, "3")).toBe(true);
    expect(mentions(input, "true")).toBe(true);
    expect(mentions(input, "label")).toBe(false);
    expect(mentions(input, "deploy")).toBe(false);
    expect(mentions(input, "")).toBe(false);
    expect(mentions(undefined, "retry")).toBe(false);
  });

  test("stops scanning recorded content for a highlight term past the character budget", () => {
    const filler = "x".repeat(mentionsBudget);
    expect(mentions({ output: `${filler.slice(0, mentionsBudget - 20)} retry` }, "retry")).toBe(true);
    expect(mentions({ output: `${filler} retry` }, "retry")).toBe(false);
    expect(mentions([filler, "retry"], "retry")).toBe(false);
    expect(mentions(["retry", filler], "retry")).toBe(true);
  });

  test("folds each unbroken run of request message copies into the API request directly after it", () => {
    const copy = (sequence: number) => ({ id: `event-${sequence}`, sequence, type: "api-request-blob", raw: { hash: `hash-${sequence}` } }) as unknown as ReplayEvent;
    const request = (sequence: number, tail?: number[]) => ({ id: `event-${sequence}`, sequence, type: "api-request", raw: tail ? { tail: tail.map(entry => `hash-${entry}`) } : {} }) as unknown as ReplayEvent;
    const other = (sequence: number) => ({ id: `event-${sequence}`, sequence, type: "assistant", raw: {} }) as unknown as ReplayEvent;
    const summarize = (runs: ReturnType<typeof requestMessageRuns>) => [...runs].map(([id, run]) => [id, run.messages.map(event => event.id), run.partial]);
    const page = [
      copy(0), copy(1), request(2, [0, 1]),
      // A request without a tail list takes the whole run; one with a list takes only the copies it names.
      copy(3), request(4), copy(5), copy(6), request(7, [6]),
      // A filtered-out record between a copy and a request, a copy before another record, and one at the page end.
      copy(8), request(10, [8]), copy(11), other(12), copy(13),
    ];
    expect(summarize(requestMessageRuns(page))).toEqual([["event-2", ["event-0", "event-1"], false], ["event-4", ["event-3"], false], ["event-7", ["event-6"], false]]);
    // On a page that follows earlier records, the run that opens the page may continue on the previous one.
    expect(summarize(requestMessageRuns(page, true))[0]).toEqual(["event-2", ["event-0", "event-1"], true]);
    expect(summarize(requestMessageRuns(page.slice(1), true))[0]).toEqual(["event-2", ["event-1"], true]);
  });
});
