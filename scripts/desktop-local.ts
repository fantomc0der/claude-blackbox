import { resolve, win32 } from "node:path";

export interface DesktopProcess {
  id: number;
  parentId: number;
  name: string;
  path: string;
  commandLine: string;
  created: string;
}

export interface DesktopRuntime {
  root: string;
  targetDir: string;
  processes: () => Promise<DesktopProcess[]>;
  stop: (processes: DesktopProcess[]) => Promise<void>;
  build: () => Promise<void>;
  launch: (executable: string) => Promise<void>;
  log: (message: string) => void;
}

const canonical = (path: string) => win32.resolve(path).toLowerCase();

export function desktopRestartPlan(processes: DesktopProcess[], root: string, targetDir: string) {
  const executables = new Set(["debug", "release"].flatMap(profile => ["claude-blackbox.exe", "claude-blackbox-server.exe"]
    .map(name => canonical(win32.join(targetDir, profile, name)))));
  const modules = canonical(win32.join(root, "node_modules")) + "\\";
  const local = (process: DesktopProcess) => Boolean(process.path) && executables.has(canonical(process.path));
  const foreign = processes.filter(process => process.name.toLowerCase() === "claude-blackbox.exe" && !local(process));
  const watchers = processes.filter(process => process.name.toLowerCase() === "tauri.exe" && process.path
    && canonical(process.path).startsWith(modules) && /(?:^|\s)"?dev"?(?:\s|$)/i.test(process.commandLine));
  const byId = new Map(processes.map(process => [process.id, process]));
  for (const app of processes.filter(local)) {
    const visited = new Set<number>();
    let descendant = app;
    let parent = byId.get(app.parentId);
    while (parent && !visited.has(parent.id)) {
      if (Date.parse(parent.created) > Date.parse(descendant.created)) break;
      visited.add(parent.id);
      if (/^(bun|node|tauri)\.exe$/i.test(parent.name)
        && /(?:\b(?:tauri(?:\.js)?|cli\.js)"?\s+dev\b|\brun\s+desktop(?:\s|$))/i.test(parent.commandLine)) watchers.push(parent);
      descendant = parent;
      parent = byId.get(parent.parentId);
    }
  }
  const stop = [...new Map([...watchers, ...processes.filter(local)].map(process => [process.id, process])).values()];
  const selected = new Set(stop.map(process => process.id));
  for (let index = 0; index < stop.length; index++) {
    for (const child of processes) {
      if (child.parentId !== stop[index].id || selected.has(child.id)) continue;
      selected.add(child.id);
      stop.push(child);
    }
  }
  return { stop, foreign };
}

function assertNoForeignInstances(processes: DesktopProcess[]) {
  if (!processes.length) return;
  throw new Error(`Another installed app or checkout is running. Quit it from its system tray before retrying; it was not stopped.\n${processes.map(process => `  PID ${process.id}: ${process.path || "executable path unavailable"}`).join("\n")}`);
}

export async function runLocalDesktop(runtime: DesktopRuntime, dryRun = false) {
  const executable = win32.join(runtime.targetDir, "debug", "claude-blackbox.exe");
  const plan = desktopRestartPlan(await runtime.processes(), runtime.root, runtime.targetDir);
  assertNoForeignInstances(plan.foreign);
  for (const process of plan.stop) runtime.log(`${dryRun ? "Would stop" : "Stopping"} local ${process.name} (PID ${process.id})`);
  runtime.log(`${dryRun ? "Would build" : "Building"}: bun tauri build --debug --no-bundle`);
  if (dryRun) { runtime.log(`Would launch: ${executable}`); return; }
  await runtime.stop(plan.stop);
  const check = async () => {
    const current = desktopRestartPlan(await runtime.processes(), runtime.root, runtime.targetDir);
    assertNoForeignInstances(current.foreign);
    if (current.stop.length) throw new Error("A local app or development watcher is still running or restarted. Stop its terminal and retry; no additional app was launched.");
  };
  await check();
  await runtime.build();
  await check();
  await runtime.launch(executable);
  runtime.log(`Opened the updated local desktop app: ${executable}`);
}

async function output(command: string[], cwd: string, env: Record<string, string> = {}) {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command[0]} failed (${code}): ${stderr.trim() || stdout.trim()}`);
  return stdout.trim();
}

function powershell(script: string, cwd: string, env: Record<string, string> = {}) {
  return output(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; ${script}`], cwd, env);
}

async function createRuntime(): Promise<DesktopRuntime> {
  if (process.platform !== "win32") throw new Error("desktop:local currently supports Windows. Use bun run desktop on macOS or Linux.");
  const root = resolve(import.meta.dir, "..");
  const metadata = JSON.parse(await output(["cargo", "metadata", "--no-deps", "--format-version", "1", "--manifest-path", win32.join(root, "src-tauri", "Cargo.toml")], root));
  if (typeof metadata.target_directory !== "string" || !win32.isAbsolute(metadata.target_directory)) throw new Error("Cargo did not report an absolute target directory.");
  return {
    root, targetDir: metadata.target_directory,
    log: console.log,
    processes: async () => JSON.parse(await powershell(`
      $session = (Get-Process -Id $PID).SessionId
      $items = @(Get-CimInstance Win32_Process | Where-Object { $_.SessionId -eq $session } | ForEach-Object {
        @{ id = [int]$_.ProcessId; parentId = [int]$_.ParentProcessId; name = [string]$_.Name;
           path = [string]$_.ExecutablePath; commandLine = [string]$_.CommandLine;
           created = $_.CreationDate.ToUniversalTime().ToString('o') }
      })
      ConvertTo-Json -InputObject $items -Compress
    `, root)),
    stop: async processes => {
      if (!processes.length) return;
      await powershell(`
        foreach ($item in (ConvertFrom-Json $env:BLACKBOX_LOCAL_PROCESSES)) {
          $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($item.id)"
          if (-not $current) { continue }
          if ($current.CreationDate.ToUniversalTime().ToString('o') -ne $item.created) {
            throw "PID $($item.id) was reused; refusing to stop a different process."
          }
          $target = Get-Process -Id $item.id -ErrorAction SilentlyContinue
          if ($target) {
            try {
              $target.Kill()
              if (-not $target.WaitForExit(10000)) { throw "PID $($item.id) did not exit." }
            } catch {
              if (Get-Process -Id $item.id -ErrorAction SilentlyContinue) { throw }
            }
          }
        }
      `, root, { BLACKBOX_LOCAL_PROCESSES: JSON.stringify(processes) });
    },
    build: async () => {
      const child = Bun.spawn([process.execPath, "tauri", "build", "--debug", "--no-bundle"], { cwd: root, stdout: "inherit", stderr: "inherit", windowsHide: true });
      const code = await child.exited;
      if (code !== 0) throw new Error(`Desktop build failed (${code}); the old executable was not launched.`);
    },
    launch: async executable => {
      if (!await Bun.file(executable).exists()) throw new Error(`Built desktop executable not found: ${executable}`);
      await powershell(`
        $app = Start-Process -FilePath $env:BLACKBOX_LOCAL_EXE -WorkingDirectory $env:BLACKBOX_LOCAL_ROOT -WindowStyle Hidden -PassThru
        $deadline = (Get-Date).AddSeconds(30)
        do {
          Start-Sleep -Milliseconds 250
          $app.Refresh()
          if ($app.HasExited) { throw "The desktop app exited before opening its window. Check for another running instance or a startup error." }
          if ($app.MainWindowHandle -ne 0) { return }
        } while ((Get-Date) -lt $deadline)
        throw "The desktop process started (PID $($app.Id)), but its window did not appear within 30 seconds."
      `, root, { BLACKBOX_LOCAL_EXE: executable, BLACKBOX_LOCAL_ROOT: root });
    },
  };
}

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    if (args.some(argument => !["--dry-run", "--help", "-h"].includes(argument))) throw new Error("Usage: bun run desktop:local [--dry-run]");
    if (args.includes("--help") || args.includes("-h")) {
      console.log("Usage: bun run desktop:local [--dry-run]\nWindows: stop this checkout's app and dev watcher, build a fresh debug desktop app, then open it. Other installed apps/checkouts are never stopped. --dry-run only reports planned actions.");
    } else await runLocalDesktop(await createRuntime(), args.includes("--dry-run"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
