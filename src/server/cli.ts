#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import packageJson from "../../package.json";
import { Recorder } from "./recorder";
import { createHandler } from "./http";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: {
  dir: { type: "string", short: "d" }, "state-dir": { type: "string" },
  port: { type: "string", short: "p", default: "12001" },
  dev: { type: "boolean", default: false }, help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
}, strict: true });

if (values.help) {
  console.log(`claude-blackbox — The flight recorder for your Claude Code sessions.

Usage: bun start [options]
  -d, --dir <path>        Claude data directory (default: CLAUDE_CONFIG_DIR or ~/.claude)
  --state-dir <path>      Private derived index and preferences directory
  -p, --port <number>     Loopback HTTP port (default: 12001)
  -h, --help              Show this help
  -v, --version           Show version

Read-only recordings. Local search. No account, telemetry, or cloud services.`);
  process.exit(0);
}
if (values.version) { console.log(packageJson.version); process.exit(0); }
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error("Port must be an integer from 1 to 65535."); process.exit(1); }
const dataDir = resolve(values.dir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
const sourceKey = createHash("sha256").update(dataDir).digest("hex").slice(0, 12);
const stateDir = resolve(values["state-dir"] || join(homedir(), ".cache", "claude-blackbox", sourceKey));
const webDir = Bun.isStandaloneExecutable ? join(import.meta.dir, "dist") : undefined;
const started = performance.now();
const recorder = await Recorder.open(dataDir, stateDir);
const server = Bun.serve({
  hostname: "127.0.0.1", port, idleTimeout: 60, maxRequestBodySize: 16384,
  fetch: createHandler({ recorder, development: values.dev, webDir }),
});
recorder.watch();
const catalog = await recorder.catalog();
console.log(`\n  ◈ claude-blackbox\n  ${catalog.sessions} recordings · indexed in ${Math.round(performance.now() - started)}ms\n  http://127.0.0.1:${server.port}\n  Source: ${dataDir}\n  Index:  ${stateDir}\n`);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await server.stop(true);
  await recorder.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
