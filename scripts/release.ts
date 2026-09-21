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

console.log(`Release ${currentVersion} -> ${version}`);
if (dryRun) process.exit(0);

const tag = `v${version}`;
const isPrerelease = prerelease(version) !== null;
const run = async (strings: TemplateStringsArray, ...values: ShellExpression[]) => {
  const result = await Bun.$(strings, ...values).quiet().nothrow();
  if (result.exitCode !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.exitCode);
  }
  return result.stdout.toString().trim();
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
await run`git tag -a ${tag} -m ${`Release ${tag}`}`;
await run`git push origin main ${tag}`;
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
