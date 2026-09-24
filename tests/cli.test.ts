import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDirectory } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function startServer(flags: string[], stdin: "pipe" | "ignore") {
  const root = await mkdtemp(join(tmpdir(), "blackbox-cli-"));
  await mkdir(join(root, "claude", "projects"), { recursive: true });
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port;
  await probe.stop(true);
  const server = Bun.spawn([process.execPath, "src/server/cli.ts", "--dir", join(root, "claude"), "--state-dir", join(root, "state"), "--port", String(port), ...flags], {
    cwd: join(import.meta.dir, ".."), stdin, stdout: "ignore", stderr: "pipe",
  });
  cleanup.push(async () => { server.kill(); await server.exited; await removeTestDirectory(root); });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/catalog`)).ok) return server;
    } catch {}
    if (server.exitCode !== null) throw new Error(`server exited early: ${await new Response(server.stderr).text()}`);
    await Bun.sleep(100);
  }
  throw new Error("server did not start");
}

async function settle(server: ReturnType<typeof Bun.spawn>, ms: number): Promise<number | null> {
  return Promise.race([server.exited, Bun.sleep(ms).then(() => null)]);
}

test("--exit-with-parent shuts the server down when stdin closes", async () => {
  const server = await startServer(["--exit-with-parent"], "pipe");
  expect(await settle(server, 300)).toBeNull();
  const stdin = server.stdin;
  if (!stdin) throw new Error("stdin was not piped");
  stdin.end();
  expect(await settle(server, 10_000)).toBe(0);
}, 30_000);

test("browser mode keeps serving without a stdin", async () => {
  const server = await startServer([], "ignore");
  expect(await settle(server, 500)).toBeNull();
}, 30_000);
