import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

export interface ReleaseAsset {
  name: string;
  apiUrl: string;
}

export interface UpdaterRelease {
  product: string;
  version: string;
  pubDate: string;
  assets: ReleaseAsset[];
}

export interface UpdaterManifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
}

// The first bundle listed for each target is the one the updater installs by default: AppImage on
// Linux x64, DEB on Linux ARM64 (which ships no AppImage), and NSIS on Windows.
export function updaterBundles(product: string, version: string) {
  const bundle = `${product}_${version}`;
  const rpm = `${product}-${version}-1`;
  return [
    { target: "darwin-aarch64", bundle: "app", asset: `${bundle}_aarch64.app.tar.gz` },
    { target: "darwin-x86_64", bundle: "app", asset: `${bundle}_x64.app.tar.gz` },
    { target: "linux-aarch64", bundle: "deb", asset: `${bundle}_arm64.deb` },
    { target: "linux-aarch64", bundle: "rpm", asset: `${rpm}.aarch64.rpm` },
    { target: "linux-x86_64", bundle: "appimage", asset: `${bundle}_amd64.AppImage` },
    { target: "linux-x86_64", bundle: "deb", asset: `${bundle}_amd64.deb` },
    { target: "linux-x86_64", bundle: "rpm", asset: `${rpm}.x86_64.rpm` },
    { target: "windows-x86_64", bundle: "nsis", asset: `${bundle}_x64-setup.exe` },
    { target: "windows-x86_64", bundle: "msi", asset: `${bundle}_x64_en-US.msi` },
  ];
}

export async function buildUpdaterManifest(
  release: UpdaterRelease,
  readAsset: (asset: ReleaseAsset) => Promise<string>,
): Promise<UpdaterManifest> {
  const assets = new Map(release.assets.map(asset => [asset.name, asset]));
  const bundles = updaterBundles(release.product, release.version);
  const missing = bundles.flatMap(({ asset }) => [asset, `${asset}.sig`]).filter(name => !assets.has(name));
  if (missing.length) {
    throw new Error(`Cannot write latest.json for ${release.version}: the release is missing ${missing.join(", ")}.`);
  }

  const platforms: UpdaterManifest["platforms"] = {};
  for (const { target, bundle, asset } of bundles) {
    const signature = await readAsset(assets.get(`${asset}.sig`)!);
    if (!signature.trim()) throw new Error(`Cannot write latest.json for ${release.version}: ${asset}.sig is empty.`);
    const entry = { signature, url: assets.get(asset)!.apiUrl };
    platforms[target] ??= entry;
    platforms[`${target}-${bundle}`] = entry;
  }
  return { version: release.version, notes: "", pub_date: release.pubDate, platforms };
}

export async function publishUpdaterManifest(tag: string) {
  const tauriConfig = JSON.parse(await readFile(join(import.meta.dir, "..", "src-tauri", "tauri.conf.json"), "utf8"));
  const { assets } = await $`gh release view ${tag} --json assets`.json() as { assets: ReleaseAsset[] };
  const manifest = await buildUpdaterManifest(
    { product: tauriConfig.productName, version: tag.replace(/^v/, ""), pubDate: new Date().toISOString(), assets },
    asset => $`gh release download ${tag} --pattern ${asset.name} --output -`.text(),
  );

  const dir = await mkdtemp(join(tmpdir(), "claude-blackbox-updater-"));
  try {
    const path = join(dir, "latest.json");
    await writeFile(path, JSON.stringify(manifest, null, 2));
    await $`gh release upload ${tag} ${path} --clobber`.quiet();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log(`Uploaded latest.json for ${tag} with ${Object.keys(manifest.platforms).join(", ")}.`);
}

if (import.meta.main) {
  try {
    const tag = Bun.argv[2];
    if (!tag) throw new Error("Usage: bun scripts/updater-manifest.ts <tag>");
    await publishUpdaterManifest(tag);
  } catch (error) {
    const stderr = error instanceof $.ShellError ? `: ${error.stderr.toString().trim()}` : "";
    console.error(error instanceof Error ? `${error.message}${stderr}` : String(error));
    process.exitCode = 1;
  }
}
