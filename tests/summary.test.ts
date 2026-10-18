import { describe, expect, test } from "bun:test";
import { addedDirectory, buildCommands, buildSummary, commandParts, isAddDirCommand, otherProgram, placeSummary, resolveRecorded, scratchpadRoot, summaryRecordIds, within, type SummaryCall, type SummaryRoot, type SummaryRunCall } from "../src/server/summary";

const sgr = (code: string) => `\u001b[${code}m`;
const record = (id: string) => ({ id, position: null, timestamp: "2026-10-11T01:26:42.000Z" });
const call = (id: string, tool: string, path: string, error = false, cwd = "C:\\code\\orbit", decision: SummaryCall["decision"] = null): SummaryCall => ({ tool, path, cwd, error, decision, record: record(id) });

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

  test("recognizes Claude Code's per-session scratchpad directory by its whole shape", () => {
    const windows = "C:\\Users\\micha\\AppData\\Local\\Temp\\claude\\C--code-fantomc0der-roundup\\47dceab4-2ec6-45c3-a63f-ea059f0215f0\\scratchpad";
    expect(scratchpadRoot(`${windows}\\apply_tests_docs.py`)).toBe(windows);
    expect(scratchpadRoot(`${windows}\\out\\report.md`)).toBe(windows);
    expect(scratchpadRoot(`${windows.toUpperCase()}\\x.py`)).toBe(windows.toUpperCase());
    const linux = "/tmp/claude-1000/-home-user-claude-blackbox/a50a03a5-cc21-5aa2-b2e3-8940383015ad/scratchpad";
    expect(scratchpadRoot(`${linux}/check.py`)).toBe(linux);
    expect(scratchpadRoot("/var/folders/x1/abc/T/claude/-Users-me-app/a50a03a5-cc21-5aa2-b2e3-8940383015ad/scratchpad/notes.md")).toBe("/var/folders/x1/abc/T/claude/-Users-me-app/a50a03a5-cc21-5aa2-b2e3-8940383015ad/scratchpad");
    // The scratchpad directory itself names no file, and a project's own `scratchpad` folder is not Claude Code's.
    expect(scratchpadRoot(linux)).toBeNull();
    expect(scratchpadRoot(`${linux}/`)).toBeNull();
    expect(scratchpadRoot("/work/app/scratchpad/check.py")).toBeNull();
    expect(scratchpadRoot("/tmp/claude-1000/-home-user-app/latest/scratchpad/check.py")).toBeNull();
    expect(scratchpadRoot("/tmp/claude-1000/a50a03a5-cc21-5aa2-b2e3-8940383015ad/scratchpad/check.py")).toBeNull();
    expect(scratchpadRoot("/tmp/myclaude/-home-user-app/a50a03a5-cc21-5aa2-b2e3-8940383015ad/scratchpad/check.py")).toBeNull();
    expect(scratchpadRoot("/tmp/claude-1000/-home-user-app/a50a03a5-cc21-5aa2-b2e3-8940383015ad/tasks/agent.output")).toBeNull();
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
      call("e6", "Write", "C:\\Users\\me\\AppData\\Local\\Temp\\claude\\C--code-orbit\\47dceab4-2ec6-45c3-a63f-ea059f0215f0\\scratchpad\\check.py"),
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
    expect(summary.scratchpads.map(scratchpad => [scratchpad.path, scratchpad.files.map(file => [file.display, file.changes.map(change => change.id)])])).toEqual([
      ["C:\\Users\\me\\AppData\\Local\\Temp\\claude\\C--code-orbit\\47dceab4-2ec6-45c3-a63f-ea059f0215f0\\scratchpad", [["check.py", ["e6"]]]],
    ]);
    expect(summary.other.map(file => file.display)).toEqual(["C:\\Users\\me\\.claude\\settings.json"]);
    expect(summary.read.map(file => [file.display, file.folder, file.reads, file.id])).toEqual([["README.md", "C:\\code\\orbit", 2, "r2"]]);
    expect(summary).toMatchObject({ changedFiles: 5, readFiles: 1, limited: false });
  });

  test("keeps each scratchpad apart and leaves one inside a recorded folder under that folder", () => {
    const first = "/tmp/claude-1000/-work-app/11111111-2222-4333-8444-555555555555/scratchpad";
    const second = "/tmp/claude-1000/-work-app/66666666-7777-4888-9999-aaaaaaaaaaaa/scratchpad";
    const summary = buildSummary([{ path: "/work/app", added: false, record: record("cwd") }, { path: "/work/empty", added: true, record: record("added") }], [
      call("e1", "Write", `${second}/later.py`, false, "/work/app"),
      call("e2", "Write", `${first}/out/report.md`, false, "/work/app"),
      call("e3", "Edit", `${first}/check.py`, false, "/work/app"),
      call("e4", "Edit", "/work/app/scratchpad/notes.md", false, "/work/app"),
      call("e5", "Edit", "/etc/hosts", false, "/work/app"),
      call("r1", "Read", `${second}/input.txt`, false, "/work/app"),
      call("r2", "Read", "/var/log/syslog", false, "/work/app"),
    ]);
    expect(summary.scratchpads.map(scratchpad => [scratchpad.path, scratchpad.files.map(file => file.display)])).toEqual([[second, ["later.py"]], [first, ["check.py", "out/report.md"]]]);
    expect(summary.folders.map(folder => [folder.path, folder.files.map(file => file.display)])).toEqual([["/work/app", ["scratchpad/notes.md"]], ["/work/empty", []]]);
    expect(summary.other.map(file => file.display)).toEqual(["/etc/hosts"]);
    expect(summary.read.map(file => [file.display, file.folder])).toEqual([["input.txt", second], ["/var/log/syslog", ""]]);

    // A scratchpad inside a recorded folder belongs to that folder, as any other file does.
    const contained = buildSummary([{ path: "/tmp", added: false, record: record("cwd") }], [call("e1", "Write", `${first}/check.py`, false, "/tmp")]);
    expect(contained.folders[0].files.map(file => file.display)).toEqual(["claude-1000/-work-app/11111111-2222-4333-8444-555555555555/scratchpad/check.py"]);
    expect(contained.scratchpads).toEqual([]);
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
    expect(summary.folders[0].files[0]).toMatchObject({ display: "busy.ts", count: 150, errors: 3, stopped: 0 });
    expect(summary.folders[0].files[0].changes).toHaveLength(100);
    expect(summary.limited).toBe(true);
  });

  test("counts a change a decision stopped apart from an error, and a stopped read as no read", () => {
    const summary = buildSummary([{ path: "/work", added: false, record: record("cwd") }], [
      call("e1", "Edit", "/work/app.ts", false, "/work", "denied"),
      call("e2", "Edit", "/work/app.ts", true, "/work"),
      call("e3", "Write", "/work/app.ts", false, "/work", "blocked"),
      call("e4", "Edit", "/work/app.ts", false, "/work", "cancelled"),
      call("r1", "Read", "/work/config.ts", false, "/work", "interrupted"),
      call("r2", "Read", "/work/notes.md", false, "/work"),
    ]);
    expect(summary.folders[0].files.map(file => [file.display, file.count, file.errors, file.stopped, file.changes.map(change => [change.tool, change.error, change.decision])]))
      .toEqual([["app.ts", 4, 1, 3, [["Edit", false, "denied"], ["Edit", true, null], ["Write", false, "blocked"], ["Edit", false, "cancelled"]]]]);
    expect(summary.read.map(file => file.display)).toEqual(["notes.md"]);
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

describe("recording summary commands", () => {
  const run = (id: string, tool: string, text: string, options: Partial<Pick<SummaryRunCall, "detail" | "background" | "error" | "decision" | "pending">> = {}): SummaryRunCall =>
    ({ tool, text, detail: "", background: false, error: false, decision: null, pending: false, ...options, record: record(id) });

  test("reads the program a command starts with past its cd steps, environment settings, and comments", () => {
    expect(commandParts("bun test")).toEqual({ program: "bun", lead: "", head: "bun test", lines: 1 });
    expect(commandParts("cd /home/me/app && bun test tests/foo.test.ts")).toEqual({ program: "bun", lead: "cd /home/me/app &&", head: "bun test tests/foo.test.ts", lines: 1 });
    expect(commandParts("cd \"/home/me/my app\"; FOO=1 BAR=\"x y\" bun run check 2>&1 | tail -5")).toEqual({ program: "bun", lead: "cd \"/home/me/my app\"; FOO=1 BAR=\"x y\"", head: "bun run check 2>&1 | tail -5", lines: 1 });
    expect(commandParts("# the tests\n\ncargo test --locked")).toEqual({ program: "cargo", lead: "# the tests", head: "cargo test --locked", lines: 1 });
    expect(commandParts("cd app\nbun test")).toEqual({ program: "bun", lead: "cd app", head: "bun test", lines: 1 });
    expect(commandParts("/usr/bin/git status").program).toBe("git");
    expect(commandParts("./scripts/dev.sh --watch").program).toBe("dev.sh");
    expect(commandParts("& \"C:\\Tools\\git.exe\" status").program).toBe("git");
    expect(commandParts("'C:\\Program Files\\Git\\bin\\git.exe' log").program).toBe("git");
    expect(commandParts("Get-ChildItem -Recurse").program).toBe("Get-ChildItem");
    // A wrapper is the program, since it is what ran first, and a chain belongs to its first program.
    expect(commandParts("sudo apt install x").program).toBe("sudo");
    expect(commandParts("git add -A && git commit -m 'x'").program).toBe("git");
    expect(commandParts("ls;").program).toBe("ls");
    // The head is the first line from the program on; a heredoc body stays in the text.
    expect(commandParts("cat <<'EOF' > x.txt\nhello\n\nEOF")).toMatchObject({ head: "cat <<'EOF' > x.txt", lines: 3 });
    expect(commandParts("   ")).toEqual({ program: "", lead: "", head: "", lines: 0 });
    expect(commandParts(`bun ${"x".repeat(300)}`).head).toHaveLength(200);
  });

  test("deduplicates commands by their text, groups them by program, and keeps every run's outcome", () => {
    const built = buildCommands([
      run("c1", "Bash", "cd /work && bun test", { error: true }),
      run("c2", "Bash", "git status"),
      run("c3", "Bash", "cd /work && bun test\r\n", { decision: "denied" }),
      run("c4", "PowerShell", "git status"),
      run("c5", "Bash", "/usr/bin/git diff --stat"),
      run("c6", "Bash", "cd /work && bun test"),
      run("c7", "Bash", "bun run dev", { background: true }),
      run("c8", "Bash", "cargo test", { pending: true }),
      run("c9", "Bash", "   "),
      run("c10", "Bash", "\u001b[1mFOO=1\u001b[0m"),
      run("c11", "Bash", "FOO=1"),
    ]);
    expect(built.commands.map(group => [group.name, group.count, group.errors, group.stopped, group.commands.map(command => [command.text, command.head, command.lead, command.count, command.runs.map(run => run.id)])])).toEqual([
      ["bun", 4, 1, 1, [["bun run dev", "bun run dev", "", 1, ["c7"]], ["cd /work && bun test", "bun test", "cd /work &&", 3, ["c1", "c3", "c6"]]]],
      ["git", 3, 0, 0, [["/usr/bin/git diff --stat", "/usr/bin/git diff --stat", "", 1, ["c5"]], ["git status", "git status", "", 2, ["c2", "c4"]]]],
      ["FOO=1", 2, 0, 0, [["FOO=1", "FOO=1", "", 2, ["c10", "c11"]]]],
      ["cargo", 1, 0, 0, [["cargo test", "cargo test", "", 1, ["c8"]]]],
    ]);
    expect(built.commands[0].commands[1].runs.map(run => [run.tool, run.error, run.decision])).toEqual([["Bash", true, null], ["Bash", false, "denied"], ["Bash", false, null]]);
    expect(built.commands[0].commands[0].runs[0]).toMatchObject({ background: true, pending: false });
    expect(built.commands[3].commands[0].runs[0]).toMatchObject({ background: false, pending: true });
    expect(built).toMatchObject({ commandCount: 6, commandRuns: 10, searchCount: 0, searchRuns: 0, searches: [], limited: false });
  });

  test("groups searches by tool, apart from the commands, telling scopes apart", () => {
    const built = buildCommands([
      run("s1", "Grep", "retry", { detail: "src · *.ts" }),
      run("s2", "Glob", "**/*.test.ts"),
      run("s3", "Grep", "retry", { detail: "src · *.ts" }),
      run("s4", "Grep", "retry"),
      run("s5", "WebSearch", "bun test timeout"),
      run("c1", "Bash", "bun test"),
    ]);
    expect(built.searches.map(group => [group.name, group.count, group.commands.map(command => [command.text, command.detail, command.count])])).toEqual([
      ["Grep", 3, [["retry", "", 1], ["retry", "src · *.ts", 2]]],
      ["Glob", 1, [["**/*.test.ts", "", 1]]],
      ["WebSearch", 1, [["bun test timeout", "", 1]]],
    ]);
    expect(built).toMatchObject({ commandCount: 1, commandRuns: 1, searchCount: 4, searchRuns: 5 });
  });

  test("orders the programs run most first, their latest command first, and the catch-all last", () => {
    const built = buildCommands([
      run("c1", "Bash", "ls"), run("c2", "Bash", "git status"), run("c3", "Bash", "git diff"), run("c4", "Bash", "bun test"),
      run("c5", "Bash", "bun run check"), run("c6", "Bash", "git status"), run("c7", "Bash", "bun test"), run("c8", "Bash", "ls"),
    ]);
    expect(built.commands.map(group => [group.name, group.count, group.commands.map(command => command.text)])).toEqual([
      ["git", 3, ["git status", "git diff"]], ["bun", 3, ["bun test", "bun run check"]], ["ls", 2, ["ls"]],
    ]);
    // Programs past the group limit and commands without a program share the Other group, which sits last whatever its size.
    const many = buildCommands([...Array.from({ length: 35 }, (_, index) => run(`p${index}`, "Bash", `tool${index} run`)), ...Array.from({ length: 5 }, (_, index) => run(`q${index}`, "Bash", "# only a comment"))]);
    expect(many.commands).toHaveLength(31);
    expect(many.commands.at(-1)).toMatchObject({ name: otherProgram, count: 10 });
    expect(many.commands.at(-1)!.commands.map(command => command.text)).toEqual(["# only a comment", ...Array.from({ length: 5 }, (_, index) => `tool${4 - index} run`)]);
    expect(many.limited).toBe(true);
  });

  test("keeps the latest runs of a command run very often, and counts every run", () => {
    const built = buildCommands(Array.from({ length: 150 }, (_, index) => run(`r${index}`, "Bash", "bun test", { error: index % 50 === 0 })));
    const command = built.commands[0].commands[0];
    expect(command).toMatchObject({ count: 150, errors: 3, stopped: 0 });
    expect(command.runs).toHaveLength(100);
    expect(command.runs[0].id).toBe("r50");
    expect(command.runs.at(-1)!.id).toBe("r149");
    expect(built.limited).toBe(true);
    const long = buildCommands([run("l1", "Bash", `echo ${"y".repeat(2000)}`)]);
    expect(long.commands[0].commands[0].text).toHaveLength(1000);
    expect(long.commands[0].commands[0].lines).toBe(1);
  });

  test("places every run under the replay filters with the files", () => {
    const summary = buildSummary([{ path: "/work", added: false, record: record("cwd") }], [call("e1", "Edit", "/work/app.ts", false, "/work")], [run("c1", "Bash", "bun test"), run("s1", "Grep", "ready")]);
    expect(summaryRecordIds(summary).sort()).toEqual(["c1", "cwd", "e1", "s1"]);
    const placed = placeSummary(summary, new Map([["c1", 7]]));
    expect(placed.commands[0].commands[0].runs[0].position).toBe(7);
    expect(placed.searches[0].commands[0].runs[0].position).toBeNull();
    expect(summary).toMatchObject({ commandCount: 1, commandRuns: 1, searchCount: 1, searchRuns: 1, changedFiles: 1 });
  });
});
