import { expect, test } from "bun:test";
import { desktopRestartPlan, runLocalDesktop, type DesktopProcess, type DesktopRuntime } from "../scripts/desktop-local";

const root = "C:\\code\\blackbox";
const targetDir = `${root}\\src-tauri\\target`;
const processInfo = (id: number, name: string, path: string, parentId = 0, commandLine = ""): DesktopProcess => ({ id, name, path, parentId, commandLine, created: "2026-09-30T00:00:00Z" });
const app = processInfo(10, "claude-blackbox.exe", `${targetDir}\\debug\\claude-blackbox.exe`);
const sidecar = processInfo(11, "claude-blackbox-server.exe", `${targetDir}\\debug\\claude-blackbox-server.exe`, 10);

test("local desktop process matching is path-scoped and case-insensitive", () => {
  const foreign = processInfo(12, "claude-blackbox.exe", "C:\\installed\\claude-blackbox.exe");
  const unrelated = processInfo(13, "bun.exe", "C:\\tools\\bun.exe");
  const plan = desktopRestartPlan([{ ...app, path: app.path.toUpperCase() }, sidecar, foreign, unrelated], root, targetDir);
  expect(plan.stop.map(process => process.id)).toEqual([10, 11]);
  expect(plan.foreign.map(process => process.id)).toEqual([12]);
  expect(desktopRestartPlan([processInfo(14, "claude-blackbox.exe", "")], root, targetDir).foreign).toHaveLength(1);
});

test("local dev watchers stop before their descendants without touching another checkout", () => {
  const watcher = processInfo(20, "tauri.exe", `${root}\\node_modules\\@tauri-apps\\cli-win32-x64-msvc\\tauri.exe`, 0, '"tauri.exe" dev');
  const cargo = processInfo(21, "cargo.exe", "C:\\tools\\cargo.exe", 20);
  const other = { ...watcher, id: 22, path: watcher.path.replace("blackbox\\", "blackbox-other\\") };
  const plan = desktopRestartPlan([app, { ...sidecar, parentId: 10 }, watcher, cargo, other, processInfo(23, "rustc.exe", "C:\\tools\\rustc.exe", 21)], root, targetDir);
  expect(plan.stop[0].id).toBe(20);
  expect(plan.stop.map(process => process.id).sort()).toEqual([10, 11, 20, 21, 23]);
});

test("Bun-hosted dev watchers are identified through local app ancestry", () => {
  const watcher = processInfo(30, "bun.exe", "C:\\tools\\bun.exe", 0, "bun tauri dev");
  const cargo = processInfo(31, "cargo.exe", "C:\\tools\\cargo.exe", 30, "cargo run");
  const other = { ...watcher, id: 32 };
  const plan = desktopRestartPlan([watcher, cargo, { ...app, parentId: 31 }, sidecar, other], root, targetDir);
  expect(plan.stop[0].id).toBe(30);
  expect(plan.stop.map(process => process.id).sort()).toEqual([10, 11, 30, 31]);
});

test("a reused parent PID never makes an unrelated watcher part of the local app", () => {
  const reused = { ...processInfo(30, "bun.exe", "C:\\tools\\bun.exe", 0, "bun tauri dev"), created: "2026-09-30T00:01:00Z" };
  const plan = desktopRestartPlan([reused, { ...app, parentId: 30 }], root, targetDir);
  expect(plan.stop.map(process => process.id)).toEqual([10]);
});

function runtime(initial: DesktopProcess[] = [app, sidecar]) {
  let processes = initial;
  const calls: string[] = [];
  const logs: string[] = [];
  const fake: DesktopRuntime = {
    root, targetDir, log: message => logs.push(message), processes: async () => processes,
    stop: async selected => { calls.push("stop"); processes = processes.filter(process => !selected.some(item => item.id === process.id)); },
    build: async () => { calls.push("build"); },
    launch: async executable => { calls.push(`launch:${executable}`); },
  };
  return { fake, calls, logs, setProcesses: (value: DesktopProcess[]) => { processes = value; } };
}

test("local launcher stops old processes, builds, then launches the exact fresh executable", async () => {
  const setup = runtime();
  await runLocalDesktop(setup.fake);
  expect(setup.calls).toEqual(["stop", "build", `launch:${targetDir}\\debug\\claude-blackbox.exe`]);
});

test("dry-run has no process or build side effects", async () => {
  const setup = runtime();
  await runLocalDesktop(setup.fake, true);
  expect(setup.calls).toEqual([]);
  expect(setup.logs.join("\n")).toContain("Would stop local claude-blackbox.exe (PID 10)");
  expect(setup.logs.join("\n")).toContain("Would launch:");
});

test("a foreign app blocks the launcher before any local processes are stopped", async () => {
  const setup = runtime([app, processInfo(50, "claude-blackbox.exe", "C:\\other\\claude-blackbox.exe")]);
  await expect(runLocalDesktop(setup.fake)).rejects.toThrow("it was not stopped");
  expect(setup.calls).toEqual([]);
});

test("failed builds never launch the old executable", async () => {
  const setup = runtime();
  setup.fake.build = async () => { setup.calls.push("build"); throw new Error("build failed"); };
  await expect(runLocalDesktop(setup.fake)).rejects.toThrow("build failed");
  expect(setup.calls).toEqual(["stop", "build"]);
});

test("a surviving watcher blocks building and a concurrent app blocks launching", async () => {
  const surviving = runtime();
  surviving.fake.stop = async () => {};
  await expect(runLocalDesktop(surviving.fake)).rejects.toThrow("still running or restarted");
  expect(surviving.calls).toEqual([]);
  const concurrent = runtime([]);
  concurrent.fake.build = async () => { concurrent.calls.push("build"); concurrent.setProcesses([app]); };
  await expect(runLocalDesktop(concurrent.fake)).rejects.toThrow("still running or restarted");
  expect(concurrent.calls).toEqual(["stop", "build"]);
});
