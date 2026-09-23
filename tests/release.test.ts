import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { inc } from "semver";

describe("release automation", () => {
  test("dry-run plans a protected-main release PR without changing versions", async () => {
    const paths = ["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"];
    const before = await Promise.all(paths.map(path => readFile(path, "utf8")));
    const currentVersion = JSON.parse(before[0]).version as string;
    const nextVersion = inc(currentVersion, "minor");
    expect(nextVersion).not.toBeNull();
    const result = Bun.spawnSync(
      [process.execPath, "scripts/release.ts", "--minor", "--dry-run"],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );

    expect(result.exitCode).toBe(0);
    expect(Buffer.from(result.stdout).toString()).toContain(`Release PR branch: release/v${nextVersion}`);
    expect(await Promise.all(paths.map(path => readFile(path, "utf8")))).toEqual(before);
  });

  test("routes the release commit through a pull request instead of pushing main", async () => {
    const script = await readFile("scripts/release.ts", "utf8");
    expect(script).toContain("gh pr create");
    expect(script).toContain("gh pr checks");
    expect(script).toContain("gh pr merge");
    expect(script).not.toContain("git push origin main");
  });
});
