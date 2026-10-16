import { expect, test } from "bun:test";
import { buildUpdaterManifest, type ReleaseAsset, type UpdaterRelease } from "../scripts/updater-manifest";

const bundles = [
  "claude-blackbox_1.0.2_aarch64.app.tar.gz",
  "claude-blackbox_1.0.2_x64.app.tar.gz",
  "claude-blackbox_1.0.2_arm64.deb",
  "claude-blackbox-1.0.2-1.aarch64.rpm",
  "claude-blackbox_1.0.2_amd64.AppImage",
  "claude-blackbox_1.0.2_amd64.deb",
  "claude-blackbox-1.0.2-1.x86_64.rpm",
  "claude-blackbox_1.0.2_x64-setup.exe",
  "claude-blackbox_1.0.2_x64_en-US.msi",
];
const extras = ["claude-blackbox_1.0.2_aarch64.dmg", "claude-blackbox_1.0.2_x64.dmg", "latest.json"];

const urlOf = (name: string) => `https://api.github.com/repos/fantomc0der/claude-blackbox/releases/assets/${name}`;
const asset = (name: string): ReleaseAsset => ({ name, apiUrl: urlOf(name) });
const release = (names: string[]): UpdaterRelease => ({
  product: "claude-blackbox",
  version: "1.0.2",
  pubDate: "2026-10-16T04:07:04.941Z",
  assets: names.map(asset),
});
const allAssets = [...bundles, ...bundles.map(name => `${name}.sig`), ...extras];
const readSignature = async (signature: ReleaseAsset) => `signature of ${signature.name}`;

test("updater manifest lists every shipped bundle and the default installer for each target", async () => {
  const manifest = await buildUpdaterManifest(release(allAssets), readSignature);
  expect(manifest).toMatchObject({ version: "1.0.2", notes: "", pub_date: "2026-10-16T04:07:04.941Z" });
  expect(Object.keys(manifest.platforms).sort()).toEqual([
    "darwin-aarch64",
    "darwin-aarch64-app",
    "darwin-x86_64",
    "darwin-x86_64-app",
    "linux-aarch64",
    "linux-aarch64-deb",
    "linux-aarch64-rpm",
    "linux-x86_64",
    "linux-x86_64-appimage",
    "linux-x86_64-deb",
    "linux-x86_64-rpm",
    "windows-x86_64",
    "windows-x86_64-msi",
    "windows-x86_64-nsis",
  ]);
  expect(manifest.platforms["darwin-aarch64-app"]).toEqual({
    signature: "signature of claude-blackbox_1.0.2_aarch64.app.tar.gz.sig",
    url: urlOf("claude-blackbox_1.0.2_aarch64.app.tar.gz"),
  });
  expect(manifest.platforms["darwin-aarch64"]).toEqual(manifest.platforms["darwin-aarch64-app"]);
  expect(manifest.platforms["linux-x86_64"]).toEqual(manifest.platforms["linux-x86_64-appimage"]);
  expect(manifest.platforms["linux-aarch64"]).toEqual(manifest.platforms["linux-aarch64-deb"]);
  expect(manifest.platforms["windows-x86_64"]).toEqual(manifest.platforms["windows-x86_64-nsis"]);
  expect(manifest.platforms["windows-x86_64-msi"]?.url).toBe(urlOf("claude-blackbox_1.0.2_x64_en-US.msi"));
});

test("updater manifest names every missing bundle and signature before downloading any", async () => {
  const downloads: string[] = [];
  const incomplete = allAssets.filter(name =>
    name !== "claude-blackbox_1.0.2_x64_en-US.msi" && name !== "claude-blackbox_1.0.2_aarch64.app.tar.gz.sig"
  );
  const result = buildUpdaterManifest(release(incomplete), async signature => {
    downloads.push(signature.name);
    return "signature";
  });
  await expect(result).rejects.toThrow(
    "Cannot write latest.json for 1.0.2: the release is missing claude-blackbox_1.0.2_aarch64.app.tar.gz.sig, claude-blackbox_1.0.2_x64_en-US.msi.",
  );
  expect(downloads).toEqual([]);
});

test("updater manifest rejects an empty signature", async () => {
  const result = buildUpdaterManifest(release(allAssets), async signature =>
    signature.name.endsWith("_x64-setup.exe.sig") ? "\n" : "signature"
  );
  await expect(result).rejects.toThrow("claude-blackbox_1.0.2_x64-setup.exe.sig is empty.");
});
