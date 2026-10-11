import { describe, expect, test } from "bun:test";
import { boundedDiff, contentToText, imageMeta, resultImages, resultText, safeDataImage, toolPreview, toolPreviewParts, toolTitle } from "../src/client/lib/content";

describe("replay content helpers", () => {
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
    const deep = toolPreviewParts({ type: "tool_use", name: "Read", input: { file_path: `/${"nested/".repeat(200)}index.ts` } });
    expect(deep.tail).toBe("index.ts");
    expect(deep.head.length + deep.tail.length).toBe(1000);
    expect(deep.head).toStartWith("…");
    expect(deep.head).toEndWith("nested/");
  });
});
