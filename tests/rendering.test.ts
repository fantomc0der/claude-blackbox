import { describe, expect, test } from "bun:test";
import { boundedDiff, contentToText, safeDataImage, toolTitle } from "../src/client/lib/content";

describe("replay content helpers", () => {
  test("keeps mixed nested content in source order", () => {
    expect(contentToText([{ type: "text", text: "first" }, { type: "thinking", thinking: "second" }, { type: "text", text: "third" }])).toBe("first\nsecond\nthird");
  });

  test("makes a bounded diff with explicit changed lines", () => {
    expect(boundedDiff("one\ntwo", "one\nthree")).toEqual([{ kind: "same", value: "one" }, { kind: "removed", value: "two" }, { kind: "added", value: "three" }]);
  });

  test("only accepts supported base64 image attachments", () => {
    expect(safeDataImage({ type: "base64", media_type: "image/png", data: "aGVsbG8=" })).toBe("data:image/png;base64,aGVsbG8=");
    expect(safeDataImage({ type: "url", media_type: "image/png", data: "https://example.com/image.png" })).toBeUndefined();
  });

  test("normalizes tool names for labels", () => {
    expect(toolTitle("AskUserQuestion")).toBe("Ask User Question");
  });
});
