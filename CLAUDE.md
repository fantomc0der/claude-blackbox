# Repository Guidance

## Architecture That Must Stay Intact

- The Bun server is the application backend. `src-tauri` is only a desktop lifecycle wrapper that starts the compiled Bun sidecar and opens its loopback URL; do not reimplement recorder, HTTP, SQLite, or client behavior in Rust.
- Browser and desktop modes must share the same `src/server` code and security boundary. The desktop wrapper chooses a dynamic `127.0.0.1` port, restricts navigation to that exact origin, and exposes no Tauri APIs to the loopback page.
- The desktop wrapper is single-instance: a second launch hands off to the running process and shows its window, so it must never accumulate wrapper and sidecar pairs. The sidecar binds its port before the first index and indexes in the background; the wrapper only waits for the port, gives up as soon as the sidecar exits, reports startup failures in a native dialog, and quits if the sidecar later dies so the next launch can start a working one.
- Closing the desktop window hides it to the system tray by default and leaves the sidecar running. The tray's **Keep running when window is closed** setting makes close quit instead, and a failed tray setup disables close-to-tray for that run. Every real exit must stop the sidecar: tray quit, app exit, and the updater's `on_before_exit` hook, which runs before the Windows installer force-exits the process. Forced kills from the installer, Task Manager, or a crash skip those hooks, so three backstops exist and must stay: the Windows job object in `src-tauri/src/job.rs`, the sidecar's `--exit-with-parent` stdin watch, and the NSIS hooks in `src-tauri/windows/hooks.nsh` that kill a lingering server before files are replaced or removed.
- Production UI assets normally live in `dist/`. A compiled sidecar embeds that directory and resolves it through `Bun.isStandaloneExecutable`; changes to asset paths must work in both source and standalone modes.

## Security And Data Invariants

- The HTTP server must remain loopback-only and reject foreign hostnames, origins, cross-site requests, and unsafe mutation shapes. Do not weaken these checks to make desktop integration easier.
- Claude recording files are read-only source data. Bookmarks, groups, and search indexes belong only in the separate state directory, which must never resolve inside the Claude source directory.
- The derived SQLite index contains sensitive transcript content. Do not add telemetry, cloud synchronization, remote assets, or real transcript fixtures.
- Markdown and attachments are untrusted recorded content. Preserve sanitization, remote-image blocking, bounded rendering, and explicit attachment reveal behavior.

## Development State Isolation (Required)

- Agent-owned development, preview, screenshot, and test runs must use an explicit isolated `--state-dir`. Never use the installed application's default cache at `~/.cache/claude-blackbox/<source-directory-hash>` for these runs. Builds reading the same Claude directory share that default cache: changing the port, browser profile, executable path, or branch does not isolate it. Startup can migrate the index and prevent an older installed app from opening it, even when both builds report the same application version.
- Use disposable, ignored state outside the recording source directory, preferably `.blackbox/<task>-state` in the current checkout. Use separate directories for concurrent tasks or incompatible schema versions. Verify resolved source/state paths and the actual server arguments before launching; do not assume a launcher default selected safe state.
- Prefer synthetic recordings for tests and screenshots. If real recordings are needed, keep their source read-only and index them into isolated development state. Installed indexes and their contents must not become committed or published fixtures.

Safe browser workflows:

```sh
bun run dev --state-dir .blackbox/dev-state

bun scripts/demo.ts
bun run dev --dir .blackbox/demo --state-dir .blackbox/demo-dev-state

bun run build
bun start --state-dir .blackbox/review-state --port 12004
```

- Check that the chosen ports are free. Do not stop an installed app or unrelated server to make room. Record the processes started for the task and stop only those when finished. On Windows, verify the actual listener/server PID as well as any launcher or shim PID; stopping a shim or closing a browser tab does not prove its server stopped.
- Desktop previews require the same isolation. The current Tauri wrapper does not forward `--state-dir` to its sidecar, so `bun run desktop`, `bun run desktop:local`, and locally built desktop binaries are not automatically safe. Do not assume a wrapper flag or an undocumented environment variable isolates state. If the launcher cannot provide a verified isolated state path, use the browser workflow or ask for explicit authorization before using the installed cache. Do not silently change the user's recording-source environment as a workaround.
- Installed-index inspection must use a genuinely read-only SQLite connection. `Recorder.open()` and server startup may initialize or migrate state, even with scanning disabled; they are not read-only inspection tools.
- Installed-state repair requires separate, explicit authorization. Back up the complete cache, including any required SQLite journal files; preserve bookmarks and workspace groups (`bookmarks`, `groups`, and `group_paths`); and verify the replacement before switching it into use. Do not bypass schema-version checks or discard the installed cache to make a development build start. Keep source recordings and installed executables unchanged unless the user separately requests changes to them.

## Toolchain Traps

- Use Bun, not Node, for scripts, builds, and tests. The lockfile is `bun.lock`; do not introduce `package-lock.json`, `yarn.lock`, or the legacy binary `bun.lockb`.
- GitHub's current Dependabot Bun image cannot parse this repository's lockfile version 2. JavaScript updates are handled by the scheduled `Dependency Maintenance` workflow; Dependabot remains enabled for Cargo, Actions, and security alerts.
- Solid and `@solidjs/web` are pinned to the same Solid 2 prerelease, with a matching compiler plugin. Upgrade the runtime, renderer, and plugin together.
- Browser tests use Bun's test runner and an installed Microsoft Edge through Playwright. Do not replace them with Playwright's Node test runner without intentionally redesigning the harness.
- `src-tauri/binaries`, `src-tauri/gen`, `src-tauri/target`, and `dist` are generated. Only the `.gitkeep`, Tauri source/configuration, Cargo lockfile, and selected desktop icons belong in git.
- Tauri requires a target-suffixed sidecar name. `scripts/build-sidecar.ts` maps Rust target triples to Bun compile targets and embeds `dist`; update both sides together when adding a platform.

## Validation And Releases

- Run `bun run check` for type checking, unit tests, and the production web build. Run `bun run test:e2e` when UI behavior changes.
- Validate desktop changes with `bun run desktop:sidecar` followed by `cargo test --locked --manifest-path src-tauri/Cargo.toml`, which CI runs on Linux, macOS, and Windows. Linux additionally needs the Tauri WebKitGTK development packages.
- Versions must stay synchronized in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. Use `bun run release --patch|--minor|--major` rather than editing them independently. The release command must preserve the protected `main` rules: it creates a release PR, enables squash auto-merge, waits for repository policy, and tags the resulting `main` commit instead of pushing a version commit directly. Running the current exact version resumes an interrupted post-merge release.
- Linux x64 releases include AppImage, DEB, and RPM. Linux ARM64 intentionally includes DEB and RPM only because its upstream AppImage packaging path is unreliable on the native runner.
