import { describe, expect, test } from "bun:test";
import { JSON_SCAN_LIMIT, jsonSegments, markSegments, sliceSegments, type TextSegment } from "../src/client/lib/json-highlight";

const joined = (segments: TextSegment[]) => segments.map(segment => segment.text).join("");
const tagged = (segments: TextSegment[]) => segments.filter(segment => segment.kind).map(segment => [segment.kind, segment.text]);
const plain = (segments: TextSegment[]) => segments.filter(segment => !segment.kind).map(segment => segment.text);

describe("json highlighting", () => {
  test("tags every token of a complete JSON document and preserves the text", () => {
    const text = '{\n  "name": "box",\n  "count": -12.5e3,\n  "ok": true,\n  "off": false,\n  "none": null,\n  "list": [1, "two", {}]\n}';
    const segments = jsonSegments(text);
    expect(joined(segments)).toBe(text);
    expect(tagged(segments)).toEqual([
      ["punctuation", "{"], ["key", '"name"'], ["punctuation", ":"], ["string", '"box"'], ["punctuation", ","],
      ["key", '"count"'], ["punctuation", ":"], ["number", "-12.5e3"], ["punctuation", ","],
      ["key", '"ok"'], ["punctuation", ":"], ["boolean", "true"], ["punctuation", ","],
      ["key", '"off"'], ["punctuation", ":"], ["boolean", "false"], ["punctuation", ","],
      ["key", '"none"'], ["punctuation", ":"], ["null", "null"], ["punctuation", ","],
      ["key", '"list"'], ["punctuation", ":"], ["punctuation", "["], ["number", "1"], ["punctuation", ","], ["string", '"two"'], ["punctuation", ","], ["punctuation", "{"], ["punctuation", "}"], ["punctuation", "]"],
      ["punctuation", "}"],
    ]);
    expect(plain(segments).every(text => /^\s+$/.test(text))).toBe(true);
  });

  test("highlights a payload embedded in a recorded hook record and leaves the rest plain", () => {
    const text = [
      "parentUuid: 24d9e835-c318-4e53-9e9b-1cd22254736e",
      "isSidechain: false",
      "attachment: type: hook_success",
      "hookName: PreToolUse:Bash",
      'stdout: {\n  "continue": true,\n  "hookSpecificOutput": {\n    "hookEventName": "PreToolUse",\n    "additionalContext": "Use run_in_background for long operations (npm install, builds, tests)."\n  }\n}\n',
      "stderr: ",
      "exitCode: 0",
    ].join("\n");
    const segments = jsonSegments(text);
    expect(joined(segments)).toBe(text);
    expect(segments[0]).toEqual({ text: text.slice(0, text.indexOf("{")) });
    expect(segments.at(-1)).toEqual({ text: "\n\nstderr: \nexitCode: 0" });
    expect(tagged(segments).filter(([kind]) => kind === "key").map(([, text]) => text)).toEqual(['"continue"', '"hookSpecificOutput"', '"hookEventName"', '"additionalContext"']);
    expect(tagged(segments).filter(([kind]) => kind === "string").map(([, text]) => text)).toEqual(['"PreToolUse"', '"Use run_in_background for long operations (npm install, builds, tests)."']);
    expect(tagged(segments).filter(([kind]) => kind === "boolean")).toEqual([["boolean", "true"]]);
  });

  test("ignores incomplete, invalid, or non-JSON bracket content", () => {
    for (const text of [
      'stdout: {\n  "continue": true,\n',
      '{"trailing": 1,}',
      "{'single': 1}",
      "{unquoted: 1}",
      '{"a": 01}',
      '{"a": "line\nbreak"}',
      '{"a": "bad \\x escape"}',
      '{"a": [1, 2}',
      "function call() { return value[index]; }",
      "- [ ] markdown task with tasks[0] and matrix[1][2]",
      "empty containers {} and [[]] are not payloads",
    ]) expect(jsonSegments(text)).toEqual([{ text }]);
  });

  test("recovers payloads that follow or sit inside invalid brackets", () => {
    const text = 'before { not json } after {"a": [1, 2]} tail [3]';
    const segments = jsonSegments(text);
    expect(joined(segments)).toBe(text);
    expect(plain(segments).filter(text => !/^\s+$/.test(text))).toEqual(["before { not json } after ", " tail "]);
    expect(tagged(segments).filter(([kind]) => kind === "number").map(([, text]) => text)).toEqual(["1", "2", "3"]);
  });

  test("handles brackets, quotes, and escapes inside strings", () => {
    const text = '{"text": "a } b ] c \\" d \\\\ e \\u00e9", "nested": "{\\"inner\\": [1]}"}';
    const segments = jsonSegments(text);
    expect(joined(segments)).toBe(text);
    expect(tagged(segments).filter(([kind]) => kind === "string").map(([, text]) => text)).toEqual(['"a } b ] c \\" d \\\\ e \\u00e9"', '"{\\"inner\\": [1]}"']);
    expect(tagged(segments).filter(([kind]) => kind === "punctuation").length).toBe(5);
  });

  test("tags consecutive and nested payloads from a JSON lines record", () => {
    const text = '{"a":1}\n{"b":[{"c":null}]}';
    const segments = jsonSegments(text);
    expect(joined(segments)).toBe(text);
    expect(tagged(segments).filter(([kind]) => kind === "key").map(([, text]) => text)).toEqual(['"a"', '"b"', '"c"']);
    expect(plain(segments)).toEqual(["\n"]);
  });

  test("stays bounded on oversized values and runaway brackets", () => {
    const oversized = `{"data": "${"x".repeat(JSON_SCAN_LIMIT)}"}`;
    expect(jsonSegments(oversized)).toEqual([{ text: oversized }]);
    const runaway = `${"[".repeat(50_000)} ${"{".repeat(50_000)}`;
    const started = performance.now();
    expect(jsonSegments(runaway)).toEqual([{ text: runaway }]);
    expect(performance.now() - started).toBeLessThan(2000);
    const dense = `[${Array.from({ length: 40_000 }, (_, index) => index).join(",")}]`;
    expect(jsonSegments(dense)).toEqual([{ text: dense }]);
  });

  test("slices segments to a preview window without losing token kinds", () => {
    const segments = jsonSegments('{"key": "value", "n": 42}');
    const window = sliceSegments(segments, 2, 17);
    expect(joined(window)).toBe('key": "value", ');
    expect(window[0]).toEqual({ text: 'key"', kind: "key" });
    expect(window.at(-1)).toEqual({ text: " " });
    expect(sliceSegments(segments, 0, 1)).toEqual([{ text: "{", kind: "punctuation" }]);
    expect(sliceSegments(segments, 100, 200)).toEqual([]);
  });

  test("groups search matches into runs that may span token boundaries", () => {
    expect(markSegments(jsonSegments('{"continue": true}'), '": TR')).toEqual([
      { match: false, segments: [{ text: "{", kind: "punctuation" }, { text: '"continue', kind: "key" }] },
      { match: true, segments: [{ text: '"', kind: "key" }, { text: ":", kind: "punctuation" }, { text: " " }, { text: "tr", kind: "boolean" }] },
      { match: false, segments: [{ text: "ue", kind: "boolean" }, { text: "}", kind: "punctuation" }] },
    ]);
    expect(markSegments([{ text: "Plain Text" }], "text")).toEqual([{ match: false, segments: [{ text: "Plain " }] }, { match: true, segments: [{ text: "Text" }] }]);
    expect(markSegments([{ text: "Plain Text" }], "")).toEqual([{ match: false, segments: [{ text: "Plain Text" }] }]);
    expect(markSegments([{ text: "aaa" }], "a")).toEqual([{ match: true, segments: [{ text: "a" }, { text: "a" }, { text: "a" }] }]);
    expect(markSegments([{ text: "" }], "a")).toEqual([]);
  });
});
