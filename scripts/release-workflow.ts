import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gt, inc, prerelease, valid } from "semver";

export const usage = `Usage:
  bun run release --patch
  bun run release --minor
  bun run release --major
  bun run release <exact-semver>

PowerShell-style aliases -BumpPatch, -BumpMinor, and -BumpMajor are also accepted.
Use the current exact version to resume an interrupted post-merge release.
Add --dry-run to print the selected version without changing anything.`;

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ReleaseRuntime {
  cwd: string;
  run(command: string, args: string[]): Promise<string>;
  tryRun(command: string, args: string[]): Promise<CommandResult>;
  sleep(milliseconds: number): Promise<void>;
  now(): number;
  log(message: string): void;
  error(message: string): void;
}

export class ReleaseCommandError extends Error {
  constructor(
    readonly command: string,
    readonly result: CommandResult,
  ) {
    super(`${command} failed with exit code ${result.exitCode}${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
}

export function createProductionRuntime(cwd = process.cwd()): ReleaseRuntime {
  const tryRun = async (command: string, args: string[]): Promise<CommandResult> => {
    const child = Bun.spawn([command, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
  };

  return {
    cwd,
    tryRun,
    async run(command, args) {
      const result = await tryRun(command, args);
      if (result.exitCode !== 0) throw new ReleaseCommandError([command, ...args].join(" "), result);
      return result.stdout;
    },
    sleep: Bun.sleep,
    now: Date.now,
    log: console.log,
    error: console.error,
  };
}

interface VersionFiles {
  packagePath: string;
  tauriPath: string;
  cargoPath: string;
  cargoLockPath: string;
  packageRaw: string;
  tauriRaw: string;
  cargoRaw: string;
  cargoLockRaw: string;
  packageJson: Record<string, unknown> & { version: string };
  tauriConfig: Record<string, unknown> & { version: string };
  cargoVersion: string;
}

interface ReleasePlan {
  currentVersion: string;
  version: string;
  tag: string;
  releaseBranch: string;
  isPrerelease: boolean;
  dryRun: boolean;
  resume: boolean;
}

async function readVersionFiles(cwd: string): Promise<VersionFiles> {
  const packagePath = join(cwd, "package.json");
  const tauriPath = join(cwd, "src-tauri", "tauri.conf.json");
  const cargoPath = join(cwd, "src-tauri", "Cargo.toml");
  const cargoLockPath = join(cwd, "src-tauri", "Cargo.lock");
  const [packageRaw, tauriRaw, cargoRaw, cargoLockRaw] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(tauriPath, "utf8"),
    readFile(cargoPath, "utf8"),
    readFile(cargoLockPath, "utf8"),
  ]);
  const packageJson = JSON.parse(packageRaw);
  const tauriConfig = JSON.parse(tauriRaw);
  const cargoVersion = cargoRaw.match(/^version = "([^"]+)"$/m)?.[1];
  if (!valid(packageJson.version)) throw new Error(`package.json contains an invalid SemVer version: ${packageJson.version}`);
  if (!cargoVersion || tauriConfig.version !== packageJson.version || cargoVersion !== packageJson.version) {
    throw new Error(`Release aborted: package.json, tauri.conf.json, and Cargo.toml must all be ${packageJson.version}.`);
  }
  return { packagePath, tauriPath, cargoPath, cargoLockPath, packageRaw, tauriRaw, cargoRaw, cargoLockRaw, packageJson, tauriConfig, cargoVersion };
}

function createPlan(args: string[], currentVersion: string): ReleasePlan {
  const dryRun = args.includes("--dry-run");
  const inputs = args.filter(argument => argument !== "--dry-run");
  const bumps = new Map<string, "major" | "minor" | "patch">([
    ["--major", "major"], ["-bumpmajor", "major"],
    ["--minor", "minor"], ["-bumpminor", "minor"],
    ["--patch", "patch"], ["-bumppatch", "patch"],
  ]);
  const bumpInputs = inputs.filter(argument => bumps.has(argument.toLowerCase()));
  const explicitInputs = inputs.filter(argument => !bumps.has(argument.toLowerCase()));
  if (inputs.length !== 1 || (bumpInputs.length === 1) === (explicitInputs.length === 1)) {
    throw new Error(usage);
  }

  const requestedBump = bumpInputs[0] ? bumps.get(bumpInputs[0].toLowerCase()) : undefined;
  const version = requestedBump ? inc(currentVersion, requestedBump) : valid(explicitInputs[0].replace(/^v/, ""));
  if (!version) throw new Error(`Invalid SemVer release version.\n\n${usage}`);
  const resume = !requestedBump && version === currentVersion;
  if (!resume && !gt(version, currentVersion)) {
    throw new Error(`Release aborted: ${version} must be greater than the current version ${currentVersion}.`);
  }

  const tag = `v${version}`;
  return {
    currentVersion,
    version,
    tag,
    releaseBranch: `release/${tag}`,
    isPrerelease: prerelease(version) !== null,
    dryRun,
    resume,
  };
}

async function writeVersion(files: VersionFiles, version: string) {
  files.packageJson.version = version;
  files.tauriConfig.version = version;
  await Promise.all([
    writeFile(files.packagePath, `${JSON.stringify(files.packageJson, null, 2)}\n`),
    writeFile(files.tauriPath, `${JSON.stringify(files.tauriConfig, null, 2)}\n`),
    writeFile(files.cargoPath, files.cargoRaw.replace(/^version = ".*"$/m, `version = "${version}"`)),
  ]);
}

async function restoreVersionFiles(files: VersionFiles) {
  await Promise.all([
    writeFile(files.packagePath, files.packageRaw),
    writeFile(files.tauriPath, files.tauriRaw),
    writeFile(files.cargoPath, files.cargoRaw),
    writeFile(files.cargoLockPath, files.cargoLockRaw),
  ]);
}

function parseJson<T>(text: string, description: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Could not parse ${description}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function preflight(runtime: ReleaseRuntime) {
  if (await runtime.run("git", ["status", "--porcelain"])) {
    throw new Error("Release aborted: the working tree is not clean.");
  }
  if ((await runtime.run("git", ["branch", "--show-current"])) !== "main") {
    throw new Error("Release aborted: switch to the main branch first.");
  }
  await runtime.run("gh", ["auth", "status"]);
  await runtime.run("git", ["fetch", "origin", "main", "--tags"]);
  if ((await runtime.run("git", ["rev-list", "--left-right", "--count", "origin/main...HEAD"])) !== "0\t0") {
    throw new Error("Release aborted: main must exactly match origin/main.");
  }
}

async function cleanupPreparedBranch(runtime: ReleaseRuntime, files: VersionFiles, branch: string, remotePushed: boolean) {
  runtime.log(`Cleaning up incomplete release branch ${branch}...`);
  await restoreVersionFiles(files);
  await runtime.tryRun("git", ["switch", "main"]);
  await runtime.tryRun("git", ["branch", "-D", branch]);
  if (remotePushed) await runtime.tryRun("git", ["push", "origin", "--delete", branch]);
}

async function findOpenReleasePullRequest(runtime: ReleaseRuntime, branch: string): Promise<string> {
  const output = await runtime.run("gh", [
    "pr", "list", "--base", "main", "--head", branch, "--state", "open", "--json", "url",
  ]);
  const pullRequests = parseJson<Array<{ url: string }>>(output, `open pull requests for ${branch}`);
  return pullRequests[0]?.url || "";
}

async function prepareReleasePullRequest(runtime: ReleaseRuntime, files: VersionFiles, plan: ReleasePlan): Promise<string> {
  if (await runtime.run("git", ["tag", "--list", plan.tag])) {
    throw new Error(`Release aborted: ${plan.tag} already exists.`);
  }
  if (await runtime.run("git", ["branch", "--list", plan.releaseBranch])) {
    throw new Error(`Release aborted: local branch ${plan.releaseBranch} already exists. Remove or rename it before retrying.`);
  }
  if (await runtime.run("git", ["ls-remote", "--heads", "origin", plan.releaseBranch])) {
    throw new Error(`Release aborted: origin/${plan.releaseBranch} already exists. Close its PR and delete the branch before retrying.`);
  }

  await runtime.run("git", ["switch", "-c", plan.releaseBranch]);
  let remotePushed = false;
  let prUrl = "";
  try {
    await writeVersion(files, plan.version);
    await runtime.run("bun", ["install", "--frozen-lockfile"]);
    await runtime.run("bun", ["run", "check"]);
    await runtime.run("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
    await runtime.run("git", ["add", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]);
    await runtime.run("git", ["commit", "-m", `Release ${plan.tag}`]);
    await runtime.run("git", ["push", "-u", "origin", plan.releaseBranch]);
    remotePushed = true;

    const prBody = `## Summary
- bump the synchronized application version from ${plan.currentVersion} to ${plan.version}
- prepare ${plan.tag} for the protected-main release workflow

## Validation
- \`bun run check\`
- \`cargo check --manifest-path src-tauri/Cargo.toml\`

Auto-merge is enabled after creation. Once repository policy is satisfied, the release command tags the merged main commit, builds the desktop artifacts, and publishes the GitHub release.`;
    prUrl = await runtime.run("gh", [
      "pr", "create", "--base", "main", "--head", plan.releaseBranch,
      "--title", `Release ${plan.tag}`, "--body", prBody,
    ]);
    if (!prUrl) throw new Error("Release aborted: GitHub did not return the release PR URL.");
    runtime.log(`Created release PR: ${prUrl}`);
    return prUrl;
  } catch (error) {
    if (!prUrl) await cleanupPreparedBranch(runtime, files, plan.releaseBranch, remotePushed);
    throw error;
  }
}

interface PullRequestStatus {
  state: "OPEN" | "CLOSED" | "MERGED";
  mergeStateStatus: string;
  headRefOid: string;
  mergeCommit?: { oid: string } | null;
  statusCheckRollup?: Array<{ name?: string; status?: string; conclusion?: string }>;
}

async function enableAutoMerge(runtime: ReleaseRuntime, prUrl: string, plan: ReleasePlan, headCommit: string) {
  await runtime.run("gh", [
    "pr", "merge", prUrl, "--auto", "--squash", "--delete-branch",
    "--match-head-commit", headCommit, "--subject", `Release ${plan.tag}`,
    "--body", "Validated by the protected-main release pull request.",
  ]);
}

async function enableAutoMergeAndWait(runtime: ReleaseRuntime, prUrl: string, plan: ReleasePlan): Promise<string> {
  const initial = parseJson<{ headRefOid: string }>(
    await runtime.run("gh", ["pr", "view", prUrl, "--json", "headRefOid"]),
    "release PR head",
  );
  await enableAutoMerge(runtime, prUrl, plan, initial.headRefOid);

  runtime.log(`Auto-merge enabled for ${prUrl}. Waiting for repository policy...`);
  let lastStatus = "";
  let refreshAutoMerge = false;
  for (;;) {
    const result = await runtime.tryRun("gh", [
      "pr", "view", prUrl, "--json", "state,mergeStateStatus,headRefOid,mergeCommit,statusCheckRollup",
    ]);
    if (result.exitCode !== 0) {
      runtime.error(`Could not read release PR state; retrying: ${result.stderr || result.stdout}`);
      await runtime.sleep(10_000);
      continue;
    }

    let status: PullRequestStatus;
    try {
      status = parseJson<PullRequestStatus>(result.stdout, "release PR state");
    } catch (error) {
      runtime.error(`${error instanceof Error ? error.message : String(error)}; retrying.`);
      await runtime.sleep(10_000);
      continue;
    }

    if (status.state === "MERGED") {
      if (status.mergeCommit?.oid) return status.mergeCommit.oid;
      runtime.error("Release PR is merged but its merge commit is not available yet; retrying.");
      await runtime.sleep(2_000);
      continue;
    }
    if (status.state === "CLOSED") throw new Error(`Release aborted: ${prUrl} was closed without merging.`);
    if (refreshAutoMerge) {
      await enableAutoMerge(runtime, prUrl, plan, status.headRefOid);
      refreshAutoMerge = false;
    }
    if (status.mergeStateStatus === "DIRTY") {
      throw new Error(`Release aborted: ${prUrl} has merge conflicts.`);
    }

    const failedCheck = status.statusCheckRollup?.find(check =>
      check.status === "COMPLETED" && check.conclusion &&
      ["ACTION_REQUIRED", "CANCELLED", "FAILURE", "STARTUP_FAILURE", "TIMED_OUT"].includes(check.conclusion)
    );
    if (failedCheck) {
      throw new Error(`Release aborted: required check ${failedCheck.name || "unknown"} concluded ${failedCheck.conclusion}.`);
    }

    if (status.mergeStateStatus === "BEHIND") {
      runtime.log("Release PR is behind main; rebasing it and waiting for fresh checks...");
      await runtime.run("gh", ["pr", "update-branch", prUrl, "--rebase"]);
      refreshAutoMerge = true;
    } else if (lastStatus !== status.mergeStateStatus) {
      runtime.log(`Release PR status: ${status.mergeStateStatus}.`);
      lastStatus = status.mergeStateStatus;
    }
    await runtime.sleep(10_000);
  }
}

async function synchronizeMergedMain(runtime: ReleaseRuntime, plan: ReleasePlan, releaseCommit: string) {
  await runtime.run("git", ["switch", "main"]);
  await runtime.run("git", ["pull", "--ff-only", "origin", "main"]);
  if (await runtime.run("git", ["branch", "--list", plan.releaseBranch])) {
    await runtime.run("git", ["branch", "-D", plan.releaseBranch]);
  }
  if ((await runtime.run("git", ["rev-list", "--left-right", "--count", "origin/main...HEAD"])) !== "0\t0") {
    throw new Error("Release aborted: main did not synchronize to the merged release PR.");
  }
  const ancestor = await runtime.tryRun("git", ["merge-base", "--is-ancestor", releaseCommit, "HEAD"]);
  if (ancestor.exitCode !== 0) {
    throw new Error(`Release aborted: merged release commit ${releaseCommit} is not on main.`);
  }
  const mergedFiles = await readVersionFiles(runtime.cwd);
  if (mergedFiles.packageJson.version !== plan.version) {
    throw new Error(`Release aborted: merged main does not contain synchronized version ${plan.version}.`);
  }
}

async function findVersionCommit(runtime: ReleaseRuntime, version: string): Promise<string> {
  const commit = await runtime.run("git", [
    "log", "-1", "--format=%H", "-S", `"version": "${version}"`, "--", "package.json",
  ]);
  if (!commit) throw new Error(`Release aborted: could not find the commit that introduced version ${version}.`);
  const ancestor = await runtime.tryRun("git", ["merge-base", "--is-ancestor", commit, "HEAD"]);
  if (ancestor.exitCode !== 0) throw new Error(`Release aborted: version commit ${commit} is not on main.`);
  return commit;
}

async function ensureReleaseTag(runtime: ReleaseRuntime, plan: ReleasePlan, releaseCommit: string) {
  await runtime.run("git", ["fetch", "origin", "main", "--tags"]);
  const localTag = await runtime.run("git", ["tag", "--list", plan.tag]);
  const remoteTag = await runtime.run("git", ["ls-remote", "--tags", "origin", `refs/tags/${plan.tag}`]);

  if (localTag) {
    const localTarget = await runtime.run("git", ["rev-list", "-n", "1", plan.tag]);
    if (localTarget !== releaseCommit) {
      throw new Error(`Release aborted: local ${plan.tag} points to ${localTarget}, not release commit ${releaseCommit}.`);
    }
  }

  if (remoteTag) {
    if (!localTag) throw new Error(`Release aborted: origin contains ${plan.tag}, but it was not fetched locally.`);
    runtime.log(`Reusing existing tag ${plan.tag}.`);
    return;
  }

  if (!localTag) await runtime.run("git", ["tag", "-a", plan.tag, releaseCommit, "-m", `Release ${plan.tag}`]);
  await runtime.run("git", ["push", "origin", plan.tag]);
}

interface ReleaseInfo {
  isDraft: boolean;
  isPrerelease: boolean;
  publishedAt: string | null;
  url: string;
}

async function ensureDraftRelease(runtime: ReleaseRuntime, plan: ReleasePlan): Promise<{ published: boolean }> {
  const existing = await runtime.tryRun("gh", [
    "release", "view", plan.tag, "--json", "isDraft,isPrerelease,publishedAt,url",
  ]);
  if (existing.exitCode === 0) {
    const release = parseJson<ReleaseInfo>(existing.stdout, `${plan.tag} release metadata`);
    if (!release.isDraft) {
      runtime.log(`${plan.tag} is already published: ${release.url}`);
      return { published: true };
    }
    runtime.log(`Reusing draft release ${plan.tag}.`);
    return { published: false };
  }
  if (!/release not found/i.test(`${existing.stderr}\n${existing.stdout}`)) {
    throw new ReleaseCommandError(`gh release view ${plan.tag}`, existing);
  }

  const args = ["release", "create", plan.tag, "--draft", "--verify-tag", "--generate-notes", "--title", `claude-blackbox ${plan.tag}`];
  if (plan.isPrerelease) args.splice(4, 0, "--prerelease");
  await runtime.run("gh", args);
  return { published: false };
}

interface WorkflowRun {
  databaseId: number;
  displayTitle: string;
  createdAt: string;
  status: string;
  conclusion: string;
}

async function listReleaseRuns(runtime: ReleaseRuntime): Promise<WorkflowRun[]> {
  const output = await runtime.run("gh", [
    "run", "list", "--workflow", "desktop-release.yml", "--event", "workflow_dispatch",
    "--limit", "20", "--json", "databaseId,displayTitle,createdAt,status,conclusion",
  ]);
  return parseJson<WorkflowRun[]>(output, "desktop release workflow runs");
}

async function ensureReleaseWorkflow(runtime: ReleaseRuntime, plan: ReleasePlan): Promise<string> {
  const displayTitle = `Desktop release ${plan.tag}`;
  const existing = (await listReleaseRuns(runtime)).find(run =>
    run.displayTitle === displayTitle && (run.status !== "completed" || run.conclusion === "success")
  );
  if (existing) {
    runtime.log(`Reusing desktop release workflow run ${existing.databaseId}.`);
    return String(existing.databaseId);
  }

  const startedAt = runtime.now();
  await runtime.run("gh", ["workflow", "run", "desktop-release.yml", "--ref", "main", "-f", `tag=${plan.tag}`]);
  for (;;) {
    try {
      const match = (await listReleaseRuns(runtime)).find(run =>
        run.displayTitle === displayTitle && Date.parse(run.createdAt) >= startedAt - 30_000
      );
      if (match) return String(match.databaseId);
    } catch (error) {
      runtime.error(`${error instanceof Error ? error.message : String(error)}; retrying workflow lookup.`);
    }
    await runtime.sleep(2_000);
  }
}

async function publishRelease(runtime: ReleaseRuntime, plan: ReleasePlan) {
  const runId = await ensureReleaseWorkflow(runtime, plan);
  await runtime.run("gh", ["run", "watch", runId, "--exit-status"]);
  const args = ["release", "edit", plan.tag, "--draft=false"];
  if (!plan.isPrerelease) args.push("--latest");
  await runtime.run("gh", args);
  runtime.log(`Published ${plan.tag}.`);
}

export async function runRelease(args: string[], runtime = createProductionRuntime()) {
  let files = await readVersionFiles(runtime.cwd);
  const plan = createPlan(args, files.packageJson.version);
  runtime.log(`Release ${plan.currentVersion} -> ${plan.version}${plan.resume ? " (resume)" : ""}`);
  runtime.log(`Release PR branch: ${plan.releaseBranch}`);
  if (plan.dryRun) return;

  await preflight(runtime);
  let releaseCommit = "";
  if (!plan.resume) {
    const existingPr = await findOpenReleasePullRequest(runtime, plan.releaseBranch);
    const prUrl = existingPr || await prepareReleasePullRequest(runtime, files, plan);
    if (existingPr) runtime.log(`Resuming release PR: ${existingPr}`);
    try {
      releaseCommit = await enableAutoMergeAndWait(runtime, prUrl, plan);
    } catch (error) {
      await runtime.tryRun("git", ["switch", "main"]);
      throw error;
    }
    await synchronizeMergedMain(runtime, plan, releaseCommit);
    files = await readVersionFiles(runtime.cwd);
  } else {
    runtime.log(`Resuming ${plan.tag} from synchronized main.`);
    releaseCommit = await findVersionCommit(runtime, plan.version);
  }

  if (files.packageJson.version !== plan.version) {
    throw new Error(`Release aborted: main is ${files.packageJson.version}, expected ${plan.version}.`);
  }
  await ensureReleaseTag(runtime, plan, releaseCommit);
  const release = await ensureDraftRelease(runtime, plan);
  if (!release.published) await publishRelease(runtime, plan);
}
