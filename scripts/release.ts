import { readFile, writeFile } from "node:fs/promises";
import type { ShellExpression } from "bun";
import { gt, inc, prerelease, valid } from "semver";

const usage = `Usage:
  bun run release --patch
  bun run release --minor
  bun run release --major
  bun run release <exact-semver>

PowerShell-style aliases -BumpPatch, -BumpMinor, and -BumpMajor are also accepted.
Add --dry-run to print the selected version without changing anything.`;
const args = Bun.argv.slice(2);
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
  console.error(usage);
  process.exit(1);
}

const packagePath = "package.json";
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const currentVersion = valid(packageJson.version);
if (!currentVersion) throw new Error(`package.json contains an invalid SemVer version: ${packageJson.version}`);
const requestedBump = bumpInputs[0] ? bumps.get(bumpInputs[0].toLowerCase()) : undefined;
const version = requestedBump ? inc(currentVersion, requestedBump) : valid(explicitInputs[0].replace(/^v/, ""));
if (!version) {
  console.error(`Invalid SemVer release version.\n\n${usage}`);
  process.exit(1);
}
if (!gt(version, currentVersion)) {
  console.error(`Release aborted: ${version} must be greater than the current version ${currentVersion}.`);
  process.exit(1);
}

const tauriPath = "src-tauri/tauri.conf.json";
const tauriConfig = JSON.parse(await readFile(tauriPath, "utf8"));
const cargoPath = "src-tauri/Cargo.toml";
const cargo = await readFile(cargoPath, "utf8");
const cargoVersion = cargo.match(/^version = "([^"]+)"$/m)?.[1];
if (tauriConfig.version !== currentVersion || cargoVersion !== currentVersion) {
  console.error(`Release aborted: package.json, tauri.conf.json, and Cargo.toml must all be ${currentVersion}.`);
  process.exit(1);
}

const tag = `v${version}`;
const releaseBranch = `release/${tag}`;
const isPrerelease = prerelease(version) !== null;
console.log(`Release ${currentVersion} -> ${version}`);
console.log(`Release PR branch: ${releaseBranch}`);
if (dryRun) process.exit(0);

const run = async (strings: TemplateStringsArray, ...values: ShellExpression[]) => {
  const result = await Bun.$(strings, ...values).quiet().nothrow();
  if (result.exitCode !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.exitCode);
  }
  return result.stdout.toString().trim();
};

const waitForRequiredChecks = async (prUrl: string) => {
  console.log(`Waiting for required checks on ${prUrl}...`);
  let checksReported = false;
  for (let attempt = 0; attempt < 60 && !checksReported; attempt++) {
    const result = await Bun.$`gh pr checks ${prUrl} --required --json name`.quiet().nothrow();
    const output = result.stdout.toString().trim();
    if (output) {
      const checks = JSON.parse(output) as Array<{ name: string }>;
      checksReported = checks.length > 0;
    }
    if (!checksReported) await Bun.sleep(2_000);
  }
  if (!checksReported) {
    console.error(`Release aborted: required checks were not reported for ${prUrl}.`);
    process.exit(1);
  }
  await run`gh pr checks ${prUrl} --required --watch --fail-fast --interval 10`;
};

if (await run`git status --porcelain`) {
  console.error("Release aborted: the working tree is not clean.");
  process.exit(1);
}
if ((await run`git branch --show-current`) !== "main") {
  console.error("Release aborted: switch to the main branch first.");
  process.exit(1);
}

await run`gh auth status`;
await run`git fetch origin main --tags`;
if ((await run`git rev-list --left-right --count origin/main...HEAD`) !== "0\t0") {
  console.error("Release aborted: main must exactly match origin/main.");
  process.exit(1);
}
if ((await Bun.$`git tag --list ${tag}`.quiet().text()).trim()) {
  console.error(`Release aborted: ${tag} already exists.`);
  process.exit(1);
}
if ((await run`git ls-remote --tags origin ${`refs/tags/${tag}`}`).trim()) {
  console.error(`Release aborted: origin already contains ${tag}.`);
  process.exit(1);
}
if ((await Bun.$`git branch --list ${releaseBranch}`.quiet().text()).trim()) {
  console.error(`Release aborted: local branch ${releaseBranch} already exists.`);
  process.exit(1);
}
if ((await run`git ls-remote --heads origin ${releaseBranch}`).trim()) {
  console.error(`Release aborted: origin/${releaseBranch} already exists.`);
  process.exit(1);
}

await run`git switch -c ${releaseBranch}`;

packageJson.version = version;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

tauriConfig.version = version;
await writeFile(tauriPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

await writeFile(cargoPath, cargo.replace(/^version = ".*"$/m, `version = "${version}"`));

await run`bun install --frozen-lockfile`;
await run`bun run check`;
await run`cargo check --manifest-path src-tauri/Cargo.toml`;
await run`git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock`;
await run`git commit -m ${`Release ${tag}`}`;
await run`git push -u origin ${releaseBranch}`;

const prBody = `## Summary
- bump the synchronized application version from ${currentVersion} to ${version}
- prepare ${tag} for the protected-main release workflow

## Validation
- \`bun run check\`
- \`cargo check --manifest-path src-tauri/Cargo.toml\`

After the required pull-request checks pass, the release command will squash-merge this PR, tag the merged main commit, build the desktop artifacts, and publish the GitHub release.`;
const prUrl = await run`gh pr create --base main --head ${releaseBranch} --title ${`Release ${tag}`} --body ${prBody}`;
console.log(`Created release PR: ${prUrl}`);
await waitForRequiredChecks(prUrl);

const releaseCommit = await run`git rev-parse HEAD`;
await run`gh pr merge ${prUrl} --squash --delete-branch --match-head-commit ${releaseCommit} --subject ${`Release ${tag}`} --body ${`Validated by the required release pull-request checks.`}`;
await run`git switch main`;
await run`git pull --ff-only origin main`;
if ((await Bun.$`git branch --list ${releaseBranch}`.quiet().text()).trim()) {
  await run`git branch -D ${releaseBranch}`;
}
if ((await run`git rev-list --left-right --count origin/main...HEAD`) !== "0\t0") {
  console.error("Release aborted: main did not synchronize to the merged release PR.");
  process.exit(1);
}

const mergedPackageJson = JSON.parse(await readFile(packagePath, "utf8"));
const mergedTauriConfig = JSON.parse(await readFile(tauriPath, "utf8"));
const mergedCargo = await readFile(cargoPath, "utf8");
const mergedCargoVersion = mergedCargo.match(/^version = "([^"]+)"$/m)?.[1];
if (mergedPackageJson.version !== version || mergedTauriConfig.version !== version || mergedCargoVersion !== version) {
  console.error(`Release aborted: merged main does not contain synchronized version ${version}.`);
  process.exit(1);
}

await run`git tag -a ${tag} -m ${`Release ${tag}`}`;
await run`git push origin ${tag}`;
if (isPrerelease) {
  await run`gh release create ${tag} --draft --prerelease --verify-tag --generate-notes --title ${`claude-blackbox ${tag}`}`;
} else {
  await run`gh release create ${tag} --draft --verify-tag --generate-notes --title ${`claude-blackbox ${tag}`}`;
}

const startedAt = Date.now();
await run`gh workflow run desktop-release.yml --ref main -f ${`tag=${tag}`}`;
let runId = "";
for (let attempt = 0; attempt < 30 && !runId; attempt++) {
  const runs = JSON.parse(await run`gh run list --workflow desktop-release.yml --event workflow_dispatch --limit 20 --json databaseId,displayTitle,createdAt`);
  const match = runs.find((item: { displayTitle: string; createdAt: string }) =>
    item.displayTitle === `Desktop release ${tag}` && Date.parse(item.createdAt) >= startedAt - 30_000,
  );
  runId = match ? String(match.databaseId) : "";
  if (!runId) await Bun.sleep(2_000);
}
if (!runId) {
  console.error(`Draft ${tag} was created, but the desktop workflow run could not be located.`);
  process.exit(1);
}

await run`gh run watch ${runId} --exit-status`;
if (isPrerelease) await run`gh release edit ${tag} --draft=false`;
else await run`gh release edit ${tag} --draft=false --latest`;
console.log(`Published ${tag}.`);
