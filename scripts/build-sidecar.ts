import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || (await Bun.$`rustc --print host-tuple`.text()).trim();
const targets: Record<string, string> = {
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "aarch64-pc-windows-msvc": "bun-windows-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
};
const bunTarget = targets[targetTriple];
if (!bunTarget) throw new Error(`Unsupported Tauri target triple: ${targetTriple}`);

await Bun.$`bun run build`;

const binariesDir = join(import.meta.dir, "..", "src-tauri", "binaries");
await mkdir(binariesDir, { recursive: true });
const extension = targetTriple.includes("windows") ? ".exe" : "";
const outfile = join(binariesDir, `claude-blackbox-server-${targetTriple}${extension}`);
const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "..", "src", "server", "cli.ts")],
  compile: {
    target: bunTarget as Bun.Build.CompileTarget,
    outfile,
    assets: [join(import.meta.dir, "..", "dist")],
  },
  minify: true,
  naming: { asset: "[dir]/[name].[ext]" },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`Built ${outfile}`);
