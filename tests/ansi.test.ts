import { describe, expect, test } from "bun:test";
import { stripAnsi, terminalRuns, type TerminalRun } from "../src/shared/ansi";
import { markSegments, sliceSegments } from "../src/client/lib/json-highlight";
import { displaySnippet, promptTitle, normalize } from "../src/server/normalize";

const esc = (code: string) => `\u001b[${code}m`;
const joined = (runs: TerminalRun[]) => runs.map(run => run.text).join("");
const addDir = `<local-command-stdout>Added ${esc("1")}C:\\code\\csii\\ingest-dealer-config${esc("22")} as a working directory for this session ${esc("2")}· /permissions to manage${esc("22")}</local-command-stdout>`;

describe("ANSI escape sequences", () => {
  test("strips styling, cursor, title, and hyperlink sequences and keeps the text between them", () => {
    expect(stripAnsi(addDir)).toBe("<local-command-stdout>Added C:\\code\\csii\\ingest-dealer-config as a working directory for this session · /permissions to manage</local-command-stdout>");
    expect(stripAnsi("\u001b[2K\u001b[1A\u001b[?25lprogress\u001b[?25h 100%\u001b[0K")).toBe("progress 100%");
    expect(stripAnsi("\u001b]0;window title\u0007visible")).toBe("visible");
    expect(stripAnsi("\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\ after")).toBe("link after");
    expect(stripAnsi("\u001bPq#0;2;0;0;0\u001b\\plain \u001b(B\u001b=\u001b7text\u001b8")).toBe("plain text");
    expect(stripAnsi("\u009b1mbright\u009b0m")).toBe("bright");
  });

  test("removes the control characters browsers draw as boxes and keeps tabs and line breaks", () => {
    expect(stripAnsi("a\u0000b\u0007c\u000bd\u000ce\u007ff\u0085g\u009fh")).toBe("abcdefgh");
    expect(stripAnsi("column\tvalue\r\nnext line\n")).toBe("column\tvalue\r\nnext line\n");
    expect(stripAnsi("lone escape \u001b")).toBe("lone escape ");
  });

  test("leaves clean text alone and bounds the damage from an unterminated string sequence", () => {
    const clean = "Plain [1m text with brackets] and ünïcödé 🚀";
    expect(stripAnsi(clean)).toBe(clean);
    expect(stripAnsi("\u001b]0;no terminator\n\u001b[1mstill shown\u001b[0m")).toBe("0;no terminator\nstill shown");
  });

  test("turns SGR sequences into styled runs whose text concatenates to the stripped text", () => {
    const text = `${esc("1")}bold${esc("22")} plain ${esc("2;3")}dim italic${esc("0")} ${esc("4")}under${esc("9")}both${esc("24")}strike${esc("29")} ${esc("7")}inverse${esc("27")}`;
    const runs = terminalRuns(text);
    expect(joined(runs)).toBe(stripAnsi(text));
    expect(runs).toEqual([
      { text: "bold", terminal: { bold: true } },
      { text: " plain " },
      { text: "dim italic", terminal: { dim: true, italic: true } },
      { text: " " },
      { text: "under", terminal: { underline: true } },
      { text: "both", terminal: { underline: true, strike: true } },
      { text: "strike", terminal: { strike: true } },
      { text: " " },
      { text: "inverse", terminal: { inverse: true } },
    ]);
  });

  test("maps named, bright, 256-color, and 24-bit colors", () => {
    const text = `${esc("31")}red${esc("39")} ${esc("93;44")}bright on blue${esc("0")} ${esc("38;5;208")}orange${esc("48;5;250")}gray${esc("0")} ${esc("38;2;200;100;50")}true${esc("0")} ${esc("38:2::1:2:3")}colon${esc("0")} ${esc("38:5:9")}bright red${esc("0")}`;
    expect(terminalRuns(text).filter(run => run.terminal).map(run => [run.text, run.terminal])).toEqual([
      ["red", { fg: 1 }],
      ["bright on blue", { fg: 11, bg: 4 }],
      ["orange", { fg: "rgb(255, 135, 0)" }],
      ["gray", { fg: "rgb(255, 135, 0)", bg: "rgb(188, 188, 188)" }],
      ["true", { fg: "rgb(200, 100, 50)" }],
      ["colon", { fg: "rgb(1, 2, 3)" }],
      ["bright red", { fg: 9 }],
    ]);
    expect(terminalRuns(`${esc("38;5;16")}a${esc("38;5;231")}b${esc("38;5;232")}c${esc("38;5;255")}d`).map(run => run.terminal?.fg)).toEqual(["rgb(0, 0, 0)", "rgb(255, 255, 255)", "rgb(8, 8, 8)", "rgb(238, 238, 238)"]);
  });

  test("ignores malformed colors and unknown codes without losing the surrounding text or state", () => {
    const text = `${esc("1")}a${esc("38;5;999")}b${esc("38;2;1;2")}c${esc("38;9")}d${esc("200")}e${esc("1;?")}f${esc("")}g`;
    const runs = terminalRuns(text);
    expect(joined(runs)).toBe("abcdefg");
    expect(runs).toEqual([{ text: "abcdef", terminal: { bold: true } }, { text: "g" }]);
    expect(terminalRuns(`${esc("0;1")}reset then bold${esc("0")}`)).toEqual([{ text: "reset then bold", terminal: { bold: true } }]);
  });

  test("merges neighbouring runs that share a style and drops non-SGR sequences silently", () => {
    expect(terminalRuns(`${esc("1")}one ${esc("1")}two\u001b[2K${esc("22")}${esc("1")}three${esc("0")}`)).toEqual([{ text: "one twothree", terminal: { bold: true } }]);
    expect(terminalRuns("")).toEqual([]);
    expect(terminalRuns("plain")).toEqual([{ text: "plain" }]);
    expect(terminalRuns(`${esc("1")}${esc("0")}`)).toEqual([]);
  });

  test("keeps terminal styling when segments are sliced or marked", () => {
    const segments = terminalRuns(`${esc("32")}passed${esc("0")} 3 tests`);
    expect(sliceSegments(segments, 2, 9)).toEqual([{ text: "ssed", terminal: { fg: 2 } }, { text: " 3 " }]);
    expect(markSegments(segments, "sed 3")).toEqual([
      { match: false, segments: [{ text: "pas", terminal: { fg: 2 } }] },
      { match: true, segments: [{ text: "sed", terminal: { fg: 2 } }, { text: " 3" }] },
      { match: false, segments: [{ text: " tests" }] },
    ]);
  });

  test("keeps escape sequences out of session titles and search snippets", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "2026-10-14T18:09:45.275Z", message: { role: "user", content: addDir } };
    expect(promptTitle(normalize(raw, "s", 0, 0))).toBe("Added C:\\code\\csii\\ingest-dealer-config as a working directory for this session · /permissions to manage");
    expect(displaySnippet(JSON.stringify(raw), "working directory")).toBe("<local-command-stdout>Added C:\\code\\csii\\ingest-dealer-config as a working directory for this session · /permissions to manage</local-command-stdout>");
  });
});
