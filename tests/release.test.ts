import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { ReleaseCommandError, runRelease, type CommandResult, type ReleaseRuntime } from "../scripts/release-workflow";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function createWorkspace(version: string) {
  const cwd = await mkdtemp(join(tmpdir(), "claude-blackbox-release-"));
  workspaces.push(cwd);
  await mkdir(join(cwd, "src-tauri"), { recursive: true });
  await writeFile(join(cwd, "package.json"), `${JSON.stringify({ name: "claude-blackbox", version }, null, 2)}\n`);
  await writeFile(join(cwd, "src-tauri", "tauri.conf.json"), `${JSON.stringify({ version }, null, 2)}\n`);
  await writeFile(join(cwd, "src-tauri", "Cargo.toml"), `[package]\nname = "claude-blackbox"\nversion = "${version}"\n`);
  await writeFile(join(cwd, "src-tauri", "Cargo.lock"), `[[package]]\nname = "claude-blackbox"\nversion = "${version}"\n`);
  return cwd;
}

class FakeRuntime implements ReleaseRuntime {
  readonly commands: string[] = [];
  readonly logs: string[] = [];
  readonly errors: string[] = [];
  readonly localTags = new Set<string>();
  readonly remoteTags = new Set<string>();
  currentBranch = "main";
  workflowDispatched = false;
  failCommand = "";
  prViews = [
    { state: "OPEN", mergeStateStatus: "BLOCKED", headRefOid: "release-head", mergeCommit: null, statusCheckRollup: [{ name: "app", status: "IN_PROGRESS", conclusion: "" }] },
    { state: "MERGED", mergeStateStatus: "CLEAN", headRefOid: "release-head", mergeCommit: { oid: "merged-head" }, statusCheckRollup: [] },
  ];

  constructor(readonly cwd: string) {}

  async run(command: string, args: string[]) {
    const result = await this.tryRun(command, args);
    if (result.exitCode !== 0) throw new ReleaseCommandError([command, ...args].join(" "), result);
    return result.stdout;
  }

  async tryRun(command: string, args: string[]): Promise<CommandResult> {
    const key = [command, ...args].join(" ");
    this.commands.push(key);
    if (key === this.failCommand) return { exitCode: 1, stdout: "", stderr: "simulated failure" };
    return this.respond(command, args);
  }

  async sleep() {}
  now() { return Date.parse("2026-09-23T20:00:00-04:00"); }
  log(message: string) { this.logs.push(message); }
  error(message: string) { this.errors.push(message); }

  private respond(command: string, args: string[]): CommandResult {
    const ok = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
    if (command === "git" && args.join(" ") === "status --porcelain") return ok();
    if (command === "git" && args.join(" ") === "branch --show-current") return ok(this.currentBranch);
    if (command === "git" && args[0] === "rev-list" && args[1] === "--left-right") return ok("0\t0");
    if (command === "git" && args[0] === "branch" && args[1] === "--list") return ok();
    if (command === "git" && args[0] === "ls-remote" && args[1] === "--heads") return ok();
    if (command === "git" && args[0] === "tag" && args[1] === "--list") return ok(this.localTags.has(args[2]) ? args[2] : "");
    if (command === "git" && args[0] === "ls-remote" && args[1] === "--tags") {
      const tag = args[3].replace("refs/tags/", "");
      return ok(this.remoteTags.has(tag) ? `tag-object\trefs/tags/${tag}` : "");
    }
    if (command === "git" && args[0] === "switch") {
      this.currentBranch = args[1] === "-c" ? args[2] : args[1];
      return ok();
    }
    if (command === "git" && args[0] === "rev-parse") return ok(this.currentBranch === "main" ? "merged-head" : "release-head");
    if (command === "git" && args[0] === "rev-list" && args[1] === "-n") return ok("merged-head");
    if (command === "git" && args[0] === "log") return ok("merged-head");
    if (command === "git" && args[0] === "tag" && args[1] === "-a") {
      this.localTags.add(args[2]);
      return ok();
    }
    if (command === "git" && args[0] === "push" && args[1] === "origin" && args[2]?.startsWith("v")) {
      this.remoteTags.add(args[2]);
      return ok();
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "list") return ok("[]");
    if (command === "gh" && args[0] === "pr" && args[1] === "create") return ok("https://github.test/pull/1");
    if (command === "gh" && args[0] === "pr" && args[1] === "view" && args.at(-1) === "headRefOid") {
      return ok(JSON.stringify({ headRefOid: "release-head" }));
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "view") return ok(JSON.stringify(this.prViews.shift()));
    if (command === "gh" && args[0] === "release" && args[1] === "view") return { exitCode: 1, stdout: "", stderr: "release not found" };
    if (command === "gh" && args[0] === "workflow" && args[1] === "run") {
      this.workflowDispatched = true;
      return ok();
    }
    if (command === "gh" && args[0] === "run" && args[1] === "list") {
      return ok(this.workflowDispatched ? JSON.stringify([{ databaseId: 77, displayTitle: "Desktop release v0.5.0", createdAt: "2026-09-23T23:59:50Z", status: "in_progress", conclusion: "" }]) : "[]");
    }
    return ok();
  }
}

async function packageVersion(cwd: string) {
  return JSON.parse(await readFile(join(cwd, "package.json"), "utf8")).version as string;
}

describe("release automation", () => {
  test("dry-run plans the release PR without executing commands or changing files", async () => {
    const cwd = await createWorkspace("0.4.0");
    const runtime = new FakeRuntime(cwd);

    await runRelease(["--minor", "--dry-run"], runtime);

    expect(runtime.commands).toEqual([]);
    expect(runtime.logs).toContain("Release PR branch: release/v0.5.0");
    expect(await packageVersion(cwd)).toBe("0.4.0");
  });

  test("auto-merges through protected main before tagging and publishing", async () => {
    const cwd = await createWorkspace("0.4.0");
    const runtime = new FakeRuntime(cwd);

    await runRelease(["--minor"], runtime);

    expect(await packageVersion(cwd)).toBe("0.5.0");
    const autoMerge = runtime.commands.findIndex(command => command.startsWith("gh pr merge ") && command.includes(" --auto "));
    const mergedState = runtime.commands.findLastIndex(command => command.startsWith("gh pr view "));
    const tag = runtime.commands.findIndex(command => command === "git tag -a v0.5.0 merged-head -m Release v0.5.0");
    expect(autoMerge).toBeGreaterThan(-1);
    expect(mergedState).toBeGreaterThan(autoMerge);
    expect(tag).toBeGreaterThan(mergedState);
    expect(runtime.commands.some(command => /^git push origin .*main/.test(command))).toBe(false);
    expect(runtime.commands).toContain("gh release edit v0.5.0 --draft=false --latest");
  });

  test("restores files and removes the generated branch when local validation fails", async () => {
    const cwd = await createWorkspace("0.4.0");
    const runtime = new FakeRuntime(cwd);
    runtime.failCommand = "bun run check";

    await expect(runRelease(["--minor"], runtime)).rejects.toThrow("simulated failure");

    expect(await packageVersion(cwd)).toBe("0.4.0");
    expect(runtime.commands).toContain("git switch main");
    expect(runtime.commands).toContain("git branch -D release/v0.5.0");
    expect(runtime.commands.some(command => command.startsWith("gh pr create "))).toBe(false);
  });

  test("leaves a failed release PR untagged and returns the operator to main", async () => {
    const cwd = await createWorkspace("0.4.0");
    const runtime = new FakeRuntime(cwd);
    runtime.prViews = [{
      state: "OPEN",
      mergeStateStatus: "BLOCKED",
      headRefOid: "release-head",
      mergeCommit: null,
      statusCheckRollup: [{ name: "app", status: "COMPLETED", conclusion: "FAILURE" }],
    }];

    await expect(runRelease(["--minor"], runtime)).rejects.toThrow("required check app concluded FAILURE");

    expect(runtime.currentBranch).toBe("main");
    expect(runtime.commands.some(command => command.startsWith("git tag -a "))).toBe(false);
    expect(runtime.commands.some(command => command.startsWith("gh release create "))).toBe(false);
  });

  test("resumes an already-merged exact version from tagging onward", async () => {
    const cwd = await createWorkspace("0.5.0");
    const runtime = new FakeRuntime(cwd);

    await runRelease(["0.5.0"], runtime);

    expect(runtime.logs).toContain("Release 0.5.0 -> 0.5.0 (resume)");
    expect(runtime.commands.some(command => command.startsWith("gh pr create "))).toBe(false);
    expect(runtime.commands.some(command => command.startsWith("gh pr merge "))).toBe(false);
    expect(runtime.commands).toContain("git tag -a v0.5.0 merged-head -m Release v0.5.0");
    expect(runtime.commands).toContain("gh release edit v0.5.0 --draft=false --latest");
  });
});
