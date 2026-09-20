export {};

const args = Bun.argv.slice(2);
const server = Bun.spawn([process.execPath, "--watch", "src/server/cli.ts", "--dev", ...args], { stdout: "inherit", stderr: "inherit" });
const client = Bun.spawn([process.execPath, "--bun", "vite", "--host", "127.0.0.1"], { stdout: "inherit", stderr: "inherit" });
const stop = () => { server.kill(); client.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const code = await Promise.race([server.exited, client.exited]);
stop();
process.exit(code);
