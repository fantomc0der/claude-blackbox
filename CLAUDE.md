# Repository Guidance

## Architecture That Must Stay Intact

- The Bun server is the application backend. `src-tauri` is only a desktop lifecycle wrapper that starts the compiled Bun sidecar and opens its loopback URL; do not reimplement recorder, HTTP, SQLite, or client behavior in Rust.
- Browser and desktop modes must share the same `src/server` code and security boundary. The desktop wrapper chooses a dynamic `127.0.0.1` port, restricts navigation to that exact origin, and kills the sidecar when the window closes.
- Production UI assets normally live in `dist/`. A compiled sidecar embeds that directory and resolves it through `Bun.isStandaloneExecutable`; changes to asset paths must work in both source and standalone modes.

## Security And Data Invariants

- The HTTP server must remain loopback-only and reject foreign hostnames, origins, cross-site requests, and unsafe mutation shapes. Do not weaken these checks to make desktop integration easier.
- Claude recording files are read-only source data. Bookmarks, groups, and search indexes belong only in the separate state directory, which must never resolve inside the Claude source directory.
- The derived SQLite index contains sensitive transcript content. Do not add telemetry, cloud synchronization, remote assets, or real transcript fixtures.
- Markdown and attachments are untrusted recorded content. Preserve sanitization, remote-image blocking, bounded rendering, and explicit attachment reveal behavior.

## Toolchain Traps

- Use Bun, not Node, for scripts, builds, and tests. The lockfile is `bun.lock`; do not introduce `package-lock.json`, `yarn.lock`, or the legacy binary `bun.lockb`.
- GitHub's current Dependabot Bun image cannot parse this repository's lockfile version 2. JavaScript updates are handled by the scheduled `Dependency Maintenance` workflow; Dependabot remains enabled for Cargo, Actions, and security alerts.
- Solid and `@solidjs/web` are pinned to the same Solid 2 prerelease, with a matching compiler plugin. Upgrade the runtime, renderer, and plugin together.
- Browser tests use Bun's test runner and an installed Microsoft Edge through Playwright. Do not replace them with Playwright's Node test runner without intentionally redesigning the harness.
- `src-tauri/binaries`, `src-tauri/gen`, `src-tauri/target`, and `dist` are generated. Only the `.gitkeep`, Tauri source/configuration, Cargo lockfile, and selected desktop icons belong in git.
- Tauri requires a target-suffixed sidecar name. `scripts/build-sidecar.ts` maps Rust target triples to Bun compile targets and embeds `dist`; update both sides together when adding a platform.

## Validation And Releases

- Run `bun run check` for type checking, unit tests, and the production web build. Run `bun run test:e2e` when UI behavior changes.
- Validate desktop changes with `bun run desktop:sidecar` followed by `cargo check --locked --manifest-path src-tauri/Cargo.toml`. Linux additionally needs the Tauri WebKitGTK development packages.
- Versions must stay synchronized in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. Use `bun run release --patch|--minor|--major` rather than editing them independently. The release command must preserve the protected `main` rules: it creates a release PR, enables squash auto-merge, waits for repository policy, and tags the resulting `main` commit instead of pushing a version commit directly. Running the current exact version resumes an interrupted post-merge release.
- Linux x64 releases include AppImage, DEB, and RPM. Linux ARM64 intentionally includes DEB and RPM only because its upstream AppImage packaging path is unreliable on the native runner.
