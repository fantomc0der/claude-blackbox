import { describe, expect, test } from "bun:test";
import { boundedDiff, contentToText, imageMeta, resultImages, resultText, safeDataImage, toolTitle } from "../src/client/lib/content";

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
});
