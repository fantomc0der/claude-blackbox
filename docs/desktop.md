# Desktop app

The Tauri desktop app is an optional alternative wrapper around the same local application. It compiles the Bun server and `dist/` UI into a sidecar executable, starts that sidecar on a free loopback port, and opens the Tauri webview at that private `127.0.0.1` URL. The browser workflow in the [README](../README.md#quick-start) remains supported and unchanged.

Desktop bundles include the Bun runtime, so they are substantially larger than a typical Tauri application. The backend still listens on a dynamically selected loopback TCP port; the existing hostname, origin, request-shape, and cross-site checks remain active. See [Architecture](architecture.md#optional-desktop-runtime) for how the wrapper and sidecar fit together.

## Build

Building the desktop app requires the platform prerequisites for **Tauri 2**, including Rust and the native webview dependencies for your operating system:

```sh
bun install
bun run desktop
```

`bun run desktop` builds the current-platform sidecar and launches Tauri in development mode. To produce installers or application bundles:

```sh
bun run desktop:build
```

## System tray

While the desktop app is running, claude-blackbox also lives in the system tray. Closing the window keeps the session archive available in the tray by default; left-click the tray icon to reopen it, or right-click for updates, release downloads, settings, and a full quit. Under **Settings**, clear **Keep running when window is closed** if the window close button should exit the app instead.

Launching the app while it is already running, including while it sits in the tray, reopens the existing window instead of starting a second copy. The window opens as soon as the local server is up; a large recording history keeps indexing in the background and the library fills in as sessions are read.

## Updates

Install the first release that includes the tray updater manually. Earlier builds do not yet know how to check for updates; after that one-time upgrade, future signed releases can be installed from the tray menu.

## Local preview on Windows

On Windows, use the repeatable local preview launcher to rebuild and open this checkout without leaving a development watcher running:

```sh
bun run desktop:local
bun run desktop:local --dry-run
```

- It checks the current Windows session for existing processes, stops this checkout's debug/release desktop app, sidecars, and local Tauri development watcher (including their child processes), then builds the UI, sidecar, and debug desktop executable without producing an installer.
- The preview opens in its own window and stays running after the command exits. Stopping a local instance closes its window and tray process; source recordings, bookmarks, and workspace groups are not removed.
- An installed app or another checkout must be quit from its tray first: the launcher reports it rather than stopping unrelated processes or accidentally reopening an older build.
- A failed build never launches the stale executable.
- `--dry-run` reports the process and launch plan without stopping, building, or opening anything.
- Bun, Rust, and the usual Tauri prerequisites must already be installed; the launcher does not install dependencies.

On macOS/Linux, continue to use `bun run desktop`.

## Development cache warning

These desktop launchers currently share the default index with the installed app when reading the same Claude directory. A newer development build can upgrade that index and prevent an older installed version from starting. Stopping the installed app avoids a process conflict, not a cache-compatibility conflict. Use the isolated browser workflow in [Development](development.md) for routine development and review; desktop validation needs an explicitly verified isolation or migration plan.
