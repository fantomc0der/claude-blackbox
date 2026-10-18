import { describe, expect, test } from "bun:test";
import { addedDirectory, buildCommands, buildPrompts, buildSummary, commandParts, commandSteps, isAddDirCommand, otherProgram, placeSummary, resolveRecorded, scratchpadRoot, summaryRecordIds, within, type SummaryCall, type SummaryMessage, type SummaryRoot, type SummaryRunCall } from "../src/server/summary";

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

describe("recording summary prompts", () => {
  const message = (id: string, sequence: number, text: string): SummaryMessage => ({ text, sequence, record: { ...record(id), timestamp: `2026-10-11T0${sequence % 10}:00:00.000Z` } });
  const command = (name: string, args: string) => `<command-name>${name}</command-name>\n<command-message>${name.slice(1)}</command-message>\n<command-args>${args}</command-args>`;

  test("lists what was typed, by kind, and skips the records nothing was typed into", () => {
    const { prompts, count, limited } = buildPrompts([
      message("p1", 0, "Add retries to the upload client"),
      message("c1", 2, command("/compact", "")),
      message("o1", 3, "<local-command-stdout>Compacted</local-command-stdout>"),
      message("c2", 4, command("/review", "PR 12")),
      message("s1", 5, "<bash-input>bun test</bash-input>"),
      message("o2", 6, "<bash-stdout>186 pass</bash-stdout><bash-stderr></bash-stderr>"),
      message("i1", 7, "<ide_opened_file>The user opened the file /work/app.ts in the IDE.</ide_opened_file>"),
      message("p2", 8, "<system-reminder>Follow CLAUDE.md</system-reminder>Ship it"),
    ], []);
    expect(prompts.map(prompt => [prompt.id, prompt.kind, prompt.text])).toEqual([
      ["p1", "prompt", "Add retries to the upload client"], ["c1", "command", "/compact"], ["c2", "command", "/review PR 12"], ["s1", "shell", "! bun test"], ["p2", "prompt", "Ship it"],
    ]);
    expect(prompts.every(prompt => prompt.position === null && prompt.errors === 0 && prompt.stopped === 0)).toBe(true);
    expect([count, limited]).toEqual([5, false]);
  });

  test("counts each failure and stopped tool under the prompt it followed, up to the next prompt", () => {
    const { prompts } = buildPrompts([message("p1", 1, "First"), message("p2", 5, "Second"), message("p3", 9, "Third")], [
      { sequence: 0, error: true, stopped: false },
      { sequence: 7, error: false, stopped: true },
      { sequence: 2, error: true, stopped: false },
      { sequence: 5, error: true, stopped: true },
      { sequence: 4, error: false, stopped: true },
    ]);
    expect(prompts.map(prompt => [prompt.id, prompt.errors, prompt.stopped])).toEqual([["p1", 1, 1], ["p2", 1, 2], ["p3", 0, 0]]);
  });

  test("bounds very long recordings while still counting every prompt", () => {
    const messages = Array.from({ length: 502 }, (_, index) => message(`p${index}`, index, `Prompt ${index}`));
    const { prompts, count, limited } = buildPrompts(messages, [{ sequence: 501, error: true, stopped: false }]);
    expect([prompts.length, count, limited]).toEqual([500, 502, true]);
    expect(prompts.at(-1)).toMatchObject({ id: "p499", errors: 0 });
    const summary = buildSummary([], [], messages, []);
    expect(summary).toMatchObject({ promptCount: 502, limited: true, changedFiles: 0 });
    expect(summary.prompts).toHaveLength(500);
  });
});

describe("recording summary commands", () => {
  const run = (id: string, tool: string, text: string, options: Partial<Pick<SummaryRunCall, "detail" | "background" | "error" | "decision" | "pending">> = {}): SummaryRunCall =>
    ({ tool, text, detail: "", background: false, error: false, decision: null, pending: false, ...options, record: record(id) });

  test("recognizes single programs without rewriting their recorded preview", () => {
    expect(commandParts("bun test")).toEqual({ program: "bun", head: "bun test", lines: 1 });
    expect(commandParts('FOO=1 BAR="x y" bun test')).toEqual({ program: "bun", head: 'FOO=1 BAR="x y" bun test', lines: 1 });
    expect(commandParts("/usr/bin/git status").program).toBe("git");
    expect(commandParts("./scripts/dev.sh --watch").program).toBe("dev.sh");
    expect(commandParts("& \"C:\\Tools\\git.exe\" status").program).toBe("git");
    expect(commandParts("'C:\\Program Files\\Git\\bin\\git.exe' log").program).toBe("git");
    expect(commandParts("Get-ChildItem -Recurse").program).toBe("Get-ChildItem");
    expect(commandParts("sudo apt install x").program).toBe("sudo");
    expect(commandParts("   ")).toEqual({ program: "", head: "", lines: 0 });
    expect(commandParts(`bun ${"x".repeat(300)}`).head).toHaveLength(200);
  });

  test.each([
    'S="C:/Temp/scratch"', 'F=/tmp/scratch', '$sp = "C:\\Temp\\scratch"',
    'cd /work && S="/tmp/scratch" && python "$S/test.py" 2>&1 | tail -8',
    'S="/tmp/scratch" && python "$S/test.py"', 'M=/tmp; cat "$M"',
    "git add -A && git commit -m 'x'", "ls | wc -l", "git status || echo failed", "ls;", "bun test &",
    "cd app\nbun test", "# tests\n\ncargo test --locked", "cat <<'EOF' > x.txt\nhello\n\nEOF\nls",
    'python -c "print(1)\nprint(2)" | tail -1', 'bash -c "python test.py | tail -8"', 'pwsh -Command "Get-ChildItem"',
    'echo "$(cat file)"', 'echo `cat file`', 'diff <(cat a) <(cat b)', 'if true; then ls; fi',
    '"Test-Path F:\\ => "', '"unfinished', '"unfinished\nline', '$command --version', '"$ROOT/bin/python" test.py',
    'echo ${VALUE:-$(cat file)}', '# only a comment', '&& python test.py', '>output python test.py',
    'S=/tmp 2>output python test.py', '2>&1 python test.py', "git status # done\nls", 'python -c "\nprint(1)\n"\nls',
  ])("keeps ambiguous shell input in Other: %s", text => {
    expect(commandParts(text).program).toBe("");
    expect(commandParts(text).head).toBe(text.split("\n")[0]);
    expect(commandParts(text).lines).toBe(text.split("\n").filter(line => line.trim()).length);
  });

  test.each([
    ['python -X utf8 -c "\nimport re\nh = open(r\'C:/x.html\').read()\ni = h.find(\'class=\\"title\\"\')\n# a comment\nprint(seg[i-600:i+120])\n"', "python", 7],
    ['python -c "print(1)\nprint(2)"', "python", 2],
    ["ls \\\n  -la", "ls", 2],
    ["py\\\nthon -c 'print(1)'", "python", 2],
    ["cat <<'EOF' > x.txt\nhello\n\nEOF", "cat", 3],
    ["python - <<EOF\nimport sys; print(sys.argv) && echo\nEOF", "python", 3],
    ["cat <<-EOF\n\tgh pr view\n\tEOF", "cat", 3],
    ["cat <<EOF # body follows\nEOF\n\n", "cat", 2],
    ['python - <<< "print(1)"', "python", 1],
    ["git commit -F- <<'MSG'\nSubject\n\nBody; details\nMSG", "git", 4],
  ])("reads a quoted newline, a continued line, or a heredoc as one call: %s", (text, program, lines) => {
    expect(commandParts(text)).toEqual({ program, head: text.split("\n")[0].trim(), lines });
  });

  test("reads PowerShell continuations, escapes, and here-strings as one call", () => {
    expect(commandParts("git status `\n  --short", "PowerShell").program).toBe("git");
    expect(commandParts("gi`\nt status", "PowerShell").program).toBe("git");
    expect(commandParts('Get-Content "a`nb" -Tail 5', "PowerShell").program).toBe("Get-Content");
    expect(commandParts("python -c @\"\nprint(\"hi\"); exit(1)\n\"@", "PowerShell")).toEqual({ program: "python", head: 'python -c @"', lines: 3 });
    expect(commandParts("python -c @'\nprint(1)\n'@; git push", "PowerShell").program).toBe("");
    expect(commandParts("git commit -m @'\nmsg", "PowerShell").program).toBe("");
  });

  test.each([
    ['python -c "print(1); print(2)"', "python"],
    ["printf '%s' 'a && b | c'", "printf"],
    ['curl "https://example.test/?a=1&b=2"', "curl"],
    ['S="/tmp/a;b" python "$S/test.py" 2>&1', "python"],
    ["cat file > output.txt 2>&1", "cat"],
    ["echo one\\;two", "echo"],
    ["git status # && ignored", "git"],
  ])("does not confuse quoted arguments or redirects with chains: %s", (text, program) => {
    expect(commandParts(text).program).toBe(program);
    expect(commandParts(text).head).toBe(text);
  });

  test("treats PowerShell assignments and dynamic invocations conservatively", () => {
    expect(commandParts('& "C:\\Tools\\python.exe" test.py', "PowerShell").program).toBe("python");
    expect(commandParts('$sp = "C:\\Temp"; & "$sp/test.ps1"', "PowerShell").program).toBe("");
    expect(commandParts('FOO=1 python test.py', "PowerShell").program).toBe("");
    expect(commandParts('"C:\\Tools\\python.exe"', "PowerShell").program).toBe("");
  });

  test("groups language and network tools without assigning a purpose to unknown utilities", () => {
    const commands = ["python3.12 test.py", "dotnet test", "go test ./...", "cargo test", "curl https://example.test", "wget https://example.test", "Invoke-WebRequest https://example.test", "wc -l file", "ls", "Other --help", "S=/tmp", "python test.py | tail -8"];
    const built = buildCommands(commands.map((text, index) => run(`r${index}`, "Bash", text)));
    expect(built.commands.map(group => [group.name, group.category])).toEqual([
      ["python3.12", "language"], ["dotnet", "language"], ["go", "language"], ["cargo", "language"],
      ["curl", "network"], ["wget", "network"], ["Invoke-WebRequest", "network"],
      ["wc", "files"], ["ls", "files"], ["Other", "shell"], ["python", "language"], ["Other", "other"],
    ]);
    expect(built.commands.at(-1)?.count).toBe(2);
    const mixed = buildCommands([run("b", "Bash", "FOO=1 python test.py"), run("p", "PowerShell", "FOO=1 python test.py")]);
    expect(mixed.commands).toMatchObject([{ category: "other", count: 2 }]);
  });

  test("keeps fetches distinct by URL and prompt, outside shell and search totals", () => {
    const summary = buildSummary([], [], [], [], [
      run("f1", "WebFetch", "https://example.test/docs", { detail: "Find setup", error: true }),
      run("f2", "webfetch", "https://example.test/docs", { detail: "Find setup" }),
      run("f3", "WebFetch", "https://example.test/docs", { detail: "Find API", pending: true }),
    ]);
    expect(summary).toMatchObject({ commandCount: 0, commandRuns: 0, searchCount: 0, searchRuns: 0, fetchCount: 2, fetchRuns: 3 });
    expect(summary.fetches).toMatchObject([{ category: "network", count: 3, errors: 1, commands: [
      { detail: "Find API", count: 1, runs: [{ id: "f3", pending: true }] },
      { detail: "Find setup", count: 2, errors: 1, runs: [{ id: "f1" }, { id: "f2" }] },
    ] }]);
    expect(summaryRecordIds(summary).sort()).toEqual(["f1", "f2", "f3"]);
    const placed = placeSummary(summary, new Map([["f3", 7]]));
    expect(placed.fetches[0].commands[0].runs[0].position).toBe(7);
    expect(placed.fetches[0].commands[1].runs[0].position).toBeNull();
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
    expect(built.commands.map(group => [group.name, group.count, group.errors, group.stopped, group.commands.map(command => [command.text, command.head, command.count, command.runs.map(run => run.id)])])).toEqual([
      ["bun", 4, 1, 1, [["bun run dev", "bun run dev", 1, ["c7"]], ["cd /work && bun test", "…bun test", 3, ["c1", "c3", "c6"]]]],
      ["git", 3, 0, 0, [["/usr/bin/git diff --stat", "/usr/bin/git diff --stat", 1, ["c5"]], ["git status", "git status", 2, ["c2", "c4"]]]],
      ["cargo", 1, 0, 0, [["cargo test", "cargo test", 1, ["c8"]]]],
      ["Other", 5, 1, 1, [["FOO=1", "FOO=1", 2, ["c10", "c11"]], ["cd /work && bun test", "cd /work && bun test", 3, ["c1", "c3", "c6"]]]],
    ]);
    expect(built.commands[3].commands[1].runs.map(run => [run.tool, run.error, run.decision])).toEqual([["Bash", true, null], ["Bash", false, "denied"], ["Bash", false, null]]);
    expect(built.commands[0].commands[0].runs[0]).toMatchObject({ background: true, pending: false });
    expect(built.commands[0].commands[1]).toMatchObject({ key: `${built.commands[3].commands[1].key}:bun`, step: { line: 1, step: 2, steps: 2 }, also: [] });
    expect(built.commands[3].commands[1]).toMatchObject({ also: ["bun"] });
    expect(built.commands[3].commands[1].step).toBeUndefined();
    expect(built.commands[2].commands[0].runs[0]).toMatchObject({ background: false, pending: true });
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
    // A program that happens to be called "other" keeps a group of its own, apart from the catch-all.
    const named = buildCommands([run("o1", "Bash", "Other --version"), run("o2", "Bash", "other --help"), run("o3", "Bash", "# nothing")]);
    expect(named.commands.map(group => [group.name, group.commands.map(command => command.text)])).toEqual([["other", ["other --help", "Other --version"]], [otherProgram, ["# nothing"]]]);
    expect(named.limited).toBe(false);
  });

  test.each(["Grep", "WebFetch"])("keeps newline boundaries distinct in %s inputs", tool => {
    const built = buildCommands([
      run("a", tool, "https://example.test", { detail: "Find setup\ninstructions", error: true }),
      run("b", tool, "instructions\nhttps://example.test", { detail: "Find setup" }),
    ]);
    const commands = (tool === "Grep" ? built.searches : built.fetches)[0].commands;
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({ count: 1, errors: 0, runs: [{ id: "b" }] });
    expect(commands[1]).toMatchObject({ count: 1, errors: 1, runs: [{ id: "a" }] });
    expect(commands[0].key).not.toBe(commands[1].key);
  });

  test("keeps shell row identities separate from structured search and fetch identities", () => {
    const built = buildCommands([
      run("s", "Grep", "ready", { detail: "src" }),
      run("f", "WebFetch", "https://example.test", { detail: "Find setup" }),
      run("c1", "Bash", "grep\nsrc\nready"),
      run("c2", "Bash", JSON.stringify(["grep", "src", "ready"])),
      run("c3", "Bash", JSON.stringify(["webfetch", "Find setup", "https://example.test"])),
    ]);
    const keys = [...built.commands, ...built.searches, ...built.fetches].flatMap(group => group.commands.map(command => command.key));
    expect(keys).toHaveLength(6);
    expect(new Set(keys).size).toBe(6);
  });

  test("caps displayed entries while whole-recording totals still count omitted entries", () => {
    const calls = Array.from({ length: 501 }, (_, index) => [
      run(`c${index}`, "Bash", `python test${index}.py`),
      run(`s${index}`, "Grep", `pattern${index}`),
      run(`f${index}`, "WebFetch", `https://example.test/${index}`),
    ]).flat();
    const built = buildCommands(calls);
    expect(built).toMatchObject({ limited: true, commandCount: 501, commandRuns: 501, searchCount: 501, searchRuns: 501, fetchCount: 501, fetchRuns: 501 });
    for (const groups of [built.commands, built.searches, built.fetches]) {
      expect(groups.reduce((count, group) => count + group.commands.length, 0)).toBe(500);
      expect(groups.reduce((count, group) => count + group.count, 0)).toBe(500);
    }
  });

  test("keeps capped script and fetch previews distinct with stable full-input keys", () => {
    const prefix = `S="${"x".repeat(1100)}"\npython `;
    const calls = [run("a", "Bash", `${prefix}a.py`), run("b", "Bash", `${prefix}b.py`)];
    const initial = buildCommands(calls).commands[0].commands;
    expect(initial[0].text).toBe(initial[1].text);
    expect(initial[0].key).not.toBe(initial[1].key);
    const refreshed = buildCommands([...calls, run("c", "Bash", `${prefix}a.py`)]).commands[0].commands;
    expect(refreshed[0].key).toBe(initial[1].key);
    const detail = "x".repeat(220);
    const fetched = buildCommands([run("f1", "WebFetch", "https://example.test", { detail: `${detail}a` }), run("f2", "WebFetch", "https://example.test", { detail: `${detail}b` })]).fetches[0].commands;
    expect(fetched[0].detail).toBe(fetched[1].detail);
    expect(fetched[0].key).not.toBe(fetched[1].key);
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
    const summary = buildSummary([{ path: "/work", added: false, record: record("cwd") }], [call("e1", "Edit", "/work/app.ts", false, "/work")], [], [], [run("c1", "Bash", "bun test"), run("s1", "Grep", "ready")]);
    expect(summaryRecordIds(summary).sort()).toEqual(["c1", "cwd", "e1", "s1"]);
    const placed = placeSummary(summary, new Map([["c1", 7]]));
    expect(placed.commands[0].commands[0].runs[0].position).toBe(7);
    expect(placed.searches[0].commands[0].runs[0].position).toBeNull();
    expect(summary).toMatchObject({ commandCount: 1, commandRuns: 1, searchCount: 1, searchRuns: 1, changedFiles: 1 });
  });

  test.each<[string, [string, string, number, string, boolean][], string]>([
    ["git add -A && git commit -m 'x && y' && git push", [["git", "git add -A && git commit -m 'x && y' && git push", 1, "1/3", false], ["git", "…git commit -m 'x && y' && git push", 1, "2/3", false], ["git", "…git push", 1, "3/3", false]], "Bash"],
    ["cd app && bun test | tail -3", [["cd", "cd app && bun test | tail -3", 1, "1/3", false], ["bun", "…bun test | tail -3", 1, "2/3", false], ["tail", "…tail -3", 1, "3/3", true]], "Bash"],
    ["F=/tmp/scratch\npython \"$F/check.py\"\n\nwc -l \"$F/output.txt\"", [["python", 'python "$F/check.py"', 2, "1/1", false], ["wc", 'wc -l "$F/output.txt"', 3, "1/1", false]], "Bash"],
    ["cat <<'EOF' > x.txt\ngh pr view\n\nEOF\necho done", [["cat", "cat <<'EOF' > x.txt", 1, "1/1", false], ["echo", "echo done", 4, "1/1", false]], "Bash"],
    ["cat <<-EOF\n\tgh pr view\n\tEOF\ngh pr list", [["cat", "cat <<-EOF", 1, "1/1", false], ["gh", "gh pr list", 4, "1/1", false]], "Bash"],
    ["gh api repos/x/pulls/1 --jq '.[] | \"id=\\(.id)\"' | head -5", [["gh", "gh api repos/x/pulls/1 --jq '.[] | \"id=\\(.id)\"' | head -5", 1, "1/2", false], ["head", "…head -5", 1, "2/2", true]], "Bash"],
    ['echo "$(cat file)" && ls', [["echo", 'echo "$(cat file)" && ls', 1, "1/2", false], ["ls", "…ls", 1, "2/2", false]], "Bash"],
    ["echo `cat file` && diff <(cat a) <(cat b)", [["echo", "echo `cat file` && diff <(cat a) <(cat b)", 1, "1/2", false], ["diff", "…diff <(cat a) <(cat b)", 1, "2/2", false]], "Bash"],
    ["if true; then ls; fi", [["true", "…true; then ls; fi", 1, "1/3", false], ["ls", "…ls; fi", 1, "2/3", false]], "Bash"],
    ["for f in *.ts; do cat $f; done", [["cat", "…cat $f; done", 1, "2/3", false]], "Bash"],
    ["(cd app && make) && mv file.{a,b}", [["cd", "…cd app && make) && mv file.{a,b}", 1, "1/3", false], ["make", "…make) && mv file.{a,b}", 1, "2/3", false], ["mv", "…mv file.{a,b}", 1, "3/3", false]], "Bash"],
    ["{ git status; git diff; } | cat", [["git", "…git status; git diff; } | cat", 1, "1/3", false], ["git", "…git diff; } | cat", 1, "2/3", false], ["cat", "…cat", 1, "3/3", true]], "Bash"],
    ["# comment\n\ncargo test --locked # trailing && ignored", [["cargo", "cargo test --locked # trailing && ignored", 1, "1/1", false]], "Bash"],
    ["echo one\\;two && ls \\\n  -la", [["echo", "echo one\\;two && ls \\", 1, "1/2", false], ["ls", "…ls \\", 1, "2/2", false]], "Bash"],
    ["gi\\\nt status && ls", [["git", "gi\\", 1, "1/1", false], ["ls", "…ls", 2, "1/1", false]], "Bash"],
    ["S=/tmp 2>output python test.py; FOO=1 BAR=2 bun test &", [["bun", "…bun test &", 1, "2/2", false]], "Bash"],
    ["cat file > out 2>&1 && gh pr view 1 >/dev/null", [["cat", "cat file > out 2>&1 && gh pr view 1 >/dev/null", 1, "1/2", false], ["gh", "…gh pr view 1 >/dev/null", 1, "2/2", false]], "Bash"],
    ["echo ${VAR:-$(cat file)} && gh --version", [["echo", "echo ${VAR:-$(cat file)} && gh --version", 1, "1/2", false], ["gh", "…gh --version", 1, "2/2", false]], "Bash"],
    ["python -c \"print(1)\nprint(2)\"", [["python", 'python -c "print(1)', 1, "1/1", false]], "Bash"],
    [">output python test.py", [], "Bash"],
    ["2>&1 python test.py", [], "Bash"],
    ["'unfinished && ls", [], "Bash"],
    ["$cmd --version; \"$ROOT/bin/python\" test.py; `which gh` x; ${GH} auth", [], "Bash"],
    ["git commit -m @'\nmulti line\n'@; git push", [["git", "git commit -m @'", 1, "1/1", false], ["git", "…git push", 3, "1/1", false]], "PowerShell"],
    ['$sp = "C:\\Temp"; & "$sp/test.ps1"; & "C:\\Tools\\git.exe" status | Select-String x', [["git", '…& "C:\\Tools\\git.exe" status | Select-String x', 1, "3/4", false], ["Select-String", "…Select-String x", 1, "4/4", true]], "PowerShell"],
    ["if ($x) { Get-ChildItem -Recurse } else { Remove-Item x }", [["Get-ChildItem", "…Get-ChildItem -Recurse } else { Remove-Item x }", 1, "2/3", false], ["Remove-Item", "…Remove-Item x }", 1, "3/3", false]], "PowerShell"],
    ["foreach ($f in Get-ChildItem) { Get-Content $f }", [["Get-Content", "…Get-Content $f }", 1, "2/2", false]], "PowerShell"],
    ["git --% log --format=%H; gh pr list", [["git", "git --% log --format=%H; gh pr list", 1, "1/1", false]], "PowerShell"],
    ["<# block\ncomment #> git status; \"C:\\x.exe\" run", [["git", "…git status; \"C:\\x.exe\" run", 2, "1/2", false]], "PowerShell"],
    ["git status `\n  --short; (Get-Date) && gh pr list", [["git", "git status `", 1, "1/1", false], ["gh", "…gh pr list", 2, "2/2", false]], "PowerShell"],
  ])("finds the top-level calls of a multi-step command: %s", (text, expected, tool) => {
    expect(commandSteps(text, tool).map(step => [step.program, step.head, step.line, `${step.step}/${step.steps}`, step.consumer])).toEqual(expected);
  });

  test("caps a step's preview and counts lines as commandParts does", () => {
    const text = `cd app && gh ${"x".repeat(300)}\n\n\ngit push`;
    const steps = commandSteps(text);
    expect(steps.map(step => [step.program, step.head.length, step.line])).toEqual([["cd", 200, 1], ["gh", 200, 1], ["git", 8, 2]]);
    expect(steps[1].head.startsWith("…gh xxx")).toBe(true);
    expect(steps[1].head.endsWith("…")).toBe(true);
    expect(commandParts(text).lines).toBe(2);
  });

  test("lists a multi-step command under each categorized or standalone program it calls, once, and names those groups on its Other row", () => {
    const built = buildCommands([
      run("c1", "Bash", "git add -A && git commit -m 'x' && git push"),
      run("c2", "Bash", "cd app && bun test | tail -3", { error: true }),
      run("c3", "Bash", 'netstat -ano | grep -q ":12003" && echo BUSY'),
      run("c4", "Bash", "echo hi && cat f && ls", { decision: "denied" }),
      run("c5", "Bash", "netstat -ano"),
      run("p1", "PowerShell", "git commit -m @'\nmsg\n'@; git push"),
      run("c6", "Bash", "herdr status"),
    ]);
    expect(built.commands.map(group => [group.name, group.category, group.count, group.errors, group.stopped, group.commands.map(command => [command.head, command.step ?? null, command.also ?? null])])).toEqual([
      ["git", "source", 2, 0, 0, [["git commit -m @'", { line: 1, step: 1, steps: 1 }, []], ["git add -A && git commit -m 'x' && git push", { line: 1, step: 1, steps: 3 }, []]]],
      ["netstat", "shell", 2, 0, 0, [["netstat -ano", null, null], ['netstat -ano | grep -q ":12003" && echo BUSY', { line: 1, step: 1, steps: 3 }, []]]],
      ["bun", "language", 1, 1, 0, [["…bun test | tail -3", { line: 1, step: 2, steps: 3 }, []]]],
      ["cat", "files", 1, 0, 1, [["…cat f && ls", { line: 1, step: 2, steps: 3 }, ["ls"]]]],
      ["ls", "files", 1, 0, 1, [["…ls", { line: 1, step: 3, steps: 3 }, ["cat"]]]],
      ["herdr", "shell", 1, 0, 0, [["herdr status", null, null]]],
      [otherProgram, "other", 5, 1, 1, [["git commit -m @'", null, ["git"]], ["echo hi && cat f && ls", null, ["cat", "ls"]], ['netstat -ano | grep -q ":12003" && echo BUSY', null, ["netstat"]], ["cd app && bun test | tail -3", null, ["bun"]], ["git add -A && git commit -m 'x' && git push", null, ["git"]]]],
    ]);
    const other = built.commands.at(-1)!.commands;
    expect(built.commands[0].commands.map(command => command.key)).toEqual([`${other[0].key}:git`, `${other[4].key}:git`]);
    expect(built.commands[0].commands[1].runs).toEqual(other[4].runs);
    expect(built).toMatchObject({ commandCount: 7, commandRuns: 7, limited: false });
    // A text both shells ran has no steps even when both read it as having no single program.
    const both = buildCommands([run("b1", "Bash", "cd app && git status"), run("b2", "PowerShell", "cd app && git status")]);
    expect(both.commands).toHaveLength(1);
    expect(both.commands[0]).toMatchObject({ name: otherProgram, count: 2 });
    expect(both.commands[0].commands[0].also).toBeUndefined();
    // A step cannot open a group past the group limit, and the command stays listed under Other without naming it.
    const many = buildCommands([...Array.from({ length: 30 }, (_, index) => run(`p${index}`, "Bash", `tool${index} run`)), run("x", "Bash", "cd app && git status")]);
    expect(many.commands).toHaveLength(31);
    expect(many.commands.some(group => group.name === "git")).toBe(false);
    expect(many.commands.at(-1)!.commands[0].also).toBeUndefined();
    expect(many.limited).toBe(false);
  });
});
