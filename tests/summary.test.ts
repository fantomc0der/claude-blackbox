import { describe, expect, test } from "bun:test";
import { addedDirectory, buildSummary, isAddDirCommand, resolveRecorded, within, type SummaryCall, type SummaryRoot } from "../src/server/summary";

const sgr = (code: string) => `\u001b[${code}m`;
const record = (id: string) => ({ id, position: null, timestamp: "2026-10-11T01:26:42.000Z" });
const call = (id: string, tool: string, path: string, error = false, cwd = "C:\\code\\orbit"): SummaryCall => ({ tool, path, cwd, error, record: record(id) });

describe("recording summary paths", () => {
  test("resolves relative inputs against the recorded working directory in that path's own style", () => {
    expect(resolveRecorded("src/app.ts", "C:\\code\\orbit")).toBe("C:\\code\\orbit\\src\\app.ts");
    expect(resolveRecorded("src/app.ts", "/work/orbit")).toBe("/work/orbit/src/app.ts");
    expect(resolveRecorded("C:/code/orbit/src/app.ts", "/elsewhere")).toBe("C:\\code\\orbit\\src\\app.ts");
    expect(resolveRecorded("/work/orbit/../atlas/x.ts", "")).toBe("/work/atlas/x.ts");
    expect(resolveRecorded("notes.md", "")).toBe("notes.md");
    expect(resolveRecorded("  ", "/work")).toBe("");
    // The working directory's style decides the join, whatever machine serves the recording.
    expect(resolveRecorded("src\\a.ts", "/work/app")).toBe("/work/app/src/a.ts");
    expect(resolveRecorded("src/a.ts", "relative/cwd")).toBe("src/a.ts");
    // A home-relative path names a directory the recording never records.
    expect(resolveRecorded("~/.claude/settings.json", "/work/app")).toBe("~/.claude/settings.json");
    expect(resolveRecorded("~", "C:\\work")).toBe("~");
  });

  test("contains paths at separator boundaries, ignoring case and separator style only on Windows", () => {
    expect(within("C:\\code\\app\\src\\a.ts", "c:/code/app")).toBe("src\\a.ts");
    expect(within("C:\\code\\app2\\a.ts", "C:\\code\\app")).toBeNull();
    expect(within("F:\\movies\\a.mkv", "f:\\")).toBe("movies\\a.mkv");
    expect(within("/work/App/a.ts", "/work/app")).toBeNull();
    expect(within("/work/app/a.ts", "/work/app/")).toBe("a.ts");
    expect(within("/etc/hosts", "/")).toBe("etc/hosts");
  });
});

describe("/add-dir records", () => {
  const command = "<command-name>/add-dir</command-name>\n            <command-message>add-dir</command-message>\n            <command-args>C:\\code\\roundup</command-args>";

  test("recognizes the command only as a record of its own, not quoted in prose", () => {
    expect(isAddDirCommand(command)).toBe(true);
    expect(isAddDirCommand(`\n  ${command}`)).toBe(true);
    expect(isAddDirCommand("<command-name>/model</command-name>")).toBe(false);
    expect(isAddDirCommand("How do I use /add-dir?")).toBe(false);
    expect(isAddDirCommand(`What does ${command} print?`)).toBe(false);
  });

  test("counts an outcome as an added folder only when Claude Code says it was added", () => {
    expect(addedDirectory(`<local-command-stdout>Added ${sgr("1")}C:\\code\\roundup${sgr("22")} as a working directory for this session ${sgr("2")}· /permissions to manage${sgr("22")}</local-command-stdout>`)).toBe("C:\\code\\roundup");
    expect(addedDirectory(`<local-command-stdout>${sgr("1")}C:\\code\\roundup${sgr("22")} is already added as a working directory.</local-command-stdout>`)).toBeNull();
    expect(addedDirectory(`<local-command-stdout>${sgr("1")}C:\\code\\notes${sgr("22")} is inside the current working directory ${sgr("1")}C:\\code${sgr("22")}; loading its skills</local-command-stdout>`)).toBeNull();
    expect(addedDirectory("Added C:\\code\\roundup as a working directory for this session")).toBeNull();
    expect(addedDirectory("It prints <local-command-stdout>Added /work/fake as a working directory</local-command-stdout>")).toBeNull();
    expect(addedDirectory("<local-command-stdout>Added /home/jo  doe/app as a working directory</local-command-stdout>")).toBe("/home/jo  doe/app");
  });
});

describe("recording summary grouping", () => {
  test("groups changed files under the deepest folder and keeps reads of unchanged files apart", () => {
    const roots: SummaryRoot[] = [
      { path: "C:\\code\\orbit", added: false, record: record("cwd") },
      { path: "C:\\code\\shared\\", added: true, record: record("add-shared") },
      { path: "C:\\code\\orbit\\packages\\ui", added: true, record: record("add-ui") },
      { path: "c:\\CODE\\orbit", added: true, record: record("add-again") },
      { path: "D:\\empty", added: true, record: record("add-empty") },
    ];
    const summary = buildSummary(roots, [
      call("e1", "Edit", "src/app.ts"),
      call("e2", "Write", "C:/code/orbit/src/app.ts", true),
      call("e3", "MultiEdit", "C:\\code\\orbit\\packages\\ui\\button.tsx"),
      call("e4", "NotebookEdit", "C:\\code\\shared\\analysis.ipynb"),
      call("e5", "Edit", "C:\\Users\\me\\.claude\\settings.json"),
      call("r1", "Read", "src/app.ts"),
      call("r2", "Read", "README.md"),
      call("r3", "Read", "C:\\code\\orbit\\README.md"),
      call("r4", "Read", "missing.md", true),
    ]);
    expect(summary.folders.map(folder => [folder.path, folder.working?.id ?? null, folder.added?.id ?? null,
      folder.files.map(file => [file.display, file.changes.map(change => [change.id, change.tool, change.error])])])).toEqual([
      ["C:\\code\\orbit", "cwd", "add-again", [["src\\app.ts", [["e1", "Edit", false], ["e2", "Write", true]]]]],
      ["C:\\code\\shared", null, "add-shared", [["analysis.ipynb", [["e4", "NotebookEdit", false]]]]],
      ["C:\\code\\orbit\\packages\\ui", null, "add-ui", [["button.tsx", [["e3", "MultiEdit", false]]]]],
      ["D:\\empty", null, "add-empty", []],
    ]);
    expect(summary.other.map(file => file.display)).toEqual(["C:\\Users\\me\\.claude\\settings.json"]);
    expect(summary.read.map(file => [file.display, file.folder, file.reads, file.id])).toEqual([["README.md", "C:\\code\\orbit", 2, "r2"]]);
    expect(summary).toMatchObject({ changedFiles: 4, readFiles: 1, limited: false });
  });

  test("merges folders recorded with different spellings of one path", () => {
    const summary = buildSummary([
      { path: "/a/./b", added: false, record: record("cwd") },
      { path: "/a/b/", added: true, record: record("added") },
    ], [call("e1", "Edit", "/a/b/x.ts", false, "/a/b")]);
    expect(summary.folders.map(folder => [folder.path, folder.working?.id, folder.added?.id, folder.files.map(file => file.display)])).toEqual([["/a/b", "cwd", "added", ["x.ts"]]]);
  });

  test("counts every change and error even when a file lists only its first changes", () => {
    const calls = Array.from({ length: 150 }, (_, index) => call(`e${index}`, "Edit", "/work/busy.ts", index % 50 === 0, "/work"));
    const summary = buildSummary([{ path: "/work", added: false, record: record("cwd") }], calls);
    expect(summary.folders[0].files[0]).toMatchObject({ display: "busy.ts", count: 150, errors: 3 });
    expect(summary.folders[0].files[0].changes).toHaveLength(100);
    expect(summary.limited).toBe(true);
  });

  test("orders files by path and bounds very large recordings", () => {
    const calls = Array.from({ length: 501 }, (_, index) => call(`e${index}`, "Edit", `/work/src/file-${index}.ts`, false, "/work"));
    const summary = buildSummary([{ path: "/work", added: false, record: record("cwd") }], calls);
    expect(summary).toMatchObject({ changedFiles: 501, limited: true });
    expect(summary.folders[0].files).toHaveLength(500);
    expect(summary.folders[0].files.slice(0, 3).map(file => file.display)).toEqual(["src/file-0.ts", "src/file-1.ts", "src/file-2.ts"]);
    expect(summary.folders[0].files.at(-1)!.display).toBe("src/file-499.ts");
  });
});
