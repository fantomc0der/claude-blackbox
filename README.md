# claude-blackbox

The flight recorder for your Claude Code sessions. Replay every conversation in a clean web UI

A local-first session archive built with **Bun**, **Solid 2 RC**, and **SQLite FTS5**. Search the full record, bring related workspaces together, and return to the exact moment that matters.

## Start

Requires **Bun 1.4+** and a current browser. Microsoft Edge is used for browser verification.

```sh
bun install
bun run build
bun start
```

Open `http://127.0.0.1:12001`. The server reads `~/.claude/projects` by default, or the Claude directory specified by `CLAUDE_CONFIG_DIR`. Nothing needs to be imported, and `history.jsonl` is not required.

```sh
bun start --dir /path/to/.claude --port 12001
bun start --dir /path/to/.claude --state-dir /path/to/private-blackbox-index
bun start --help
```

On Windows, quote paths with spaces. Resume commands use PowerShell literal-path quoting for Windows working directories and POSIX shell quoting for Unix paths.

Optional local command registration: run `bun link` after building, then use `claude-blackbox`. Bun must remain installed; this is a Bun-native application, not a Node server.

### Desktop App (Optional)

The Tauri desktop app is an alternative wrapper around the same local application. It compiles the Bun server and `dist/` UI into a sidecar executable, starts that sidecar on a free loopback port, and opens the Tauri webview at that private `127.0.0.1` URL. The browser workflow above remains supported and unchanged.

Building the desktop app requires the platform prerequisites for **Tauri 2**, including Rust and the native webview dependencies for your operating system:

```sh
bun install
bun run desktop
```

`bun run desktop` builds the current-platform sidecar and launches Tauri in development mode. To produce installers or application bundles:

```sh
bun run desktop:build
```

Desktop bundles include the Bun runtime, so they are substantially larger than a typical Tauri application. The backend still listens on a dynamically selected loopback TCP port; the existing hostname, origin, request-shape, and cross-site checks remain active.

While the desktop app is running, claude-blackbox also lives in the system tray. Closing the window keeps the session archive available in the tray by default; left-click the tray icon to reopen it, or right-click for updates, release downloads, settings, and a full quit. Under **Settings**, clear **Keep running when window is closed** if the window close button should exit the app instead.

Install the first release that includes the tray updater manually. Earlier builds do not yet know how to check for updates; after that one-time upgrade, future signed releases can be installed from the tray menu.

## Explore

- **Full-record search:** prompts, assistant responses, reasoning, file paths, commands, tool inputs/results, and recorded metadata. Matching snippets link directly to their events.
- **Combine filters:** workspace group, original folder, any recorded model, recorded effort, branch, last-activity date, observed tool, file changes, errors, recent activity, bookmarks, main/subagent recordings, pricing coverage, and optional cost/token/record-count bounds.
- **Sort recordings:** recent or oldest activity, most records, highest/lowest estimated cost or tokens, most errors or tool calls, longest recorded span, or title. Ranking covers all matching recordings before pagination; unknown usage is not treated as zero.
- **Reversible workspace groups:** give worktrees or clones one shared history without moving files. Original working directories remain visible and filterable. Grouping is explicit—not guessed from similar folder names.
- **Workspace navigation:** sort the sidebar by most sessions (default), highest estimated cost, or folder name A–Z. Name sorting uses natural order (for example, `project-2` before `project-10`) and a group's display name. The choice stays in this browser. Use the sidebar search button to filter workspace names or any original folder path without changing session-search filters.
- **Usage and estimated cost:** see tokens and USD API-equivalent cost for each recording, source folder, or workspace group. Expand **Usage** for input/output/cache totals and a clickable folder breakdown. Totals cover every matching page and follow the existing filters.
- **Structured replay:** Markdown, tables, code, bounded line diffs, terminal output, file reads/writes, checklists, questions, delegated tasks, reasoning, and errors. Tool results are linked across event boundaries. Unknown records stay available under **All events** and **Raw event**.
- **Investigate long recordings:** combine literal search with focused prompts, responses, edits, thinking, tools, errors, or system views, plus observed tool/model/directory and UTC date filters. Scope survives reload and browser history. Reveal surrounding context at a finding or jump to the beginning/latest records without changing the original sequence.
- **Live updates:** the local index reconciles every 2.5 seconds. Reconnection refreshes the view. New events do not pull you away from older content; use **Jump to latest** when ready.
- **Return to your work:** bookmark a recording, copy its source path or safely quoted resume command, use an event permalink, or export the original parsed records as JSONL.

Search words combine with AND, including matches in different events of the same session. Quote phrases and prefix exclusions with a minus sign:

```text
authentication retry
"default limit" -timeout
src/auth.ts
```

Transcript search uses Unicode word/phrase tokenization, not regular expressions or fuzzy matching. Session titles and workspace metadata also support substring matches. Search within a recording uses literal substring matching. Calendar date bounds use UTC; displayed event times use your browser's local timezone.

All source recordings, including subagents, are included initially. The recording-type filter can select main sessions or subagents alone. **Conversation** hides internal metadata/context records; **All events** retains them. “Recently active” means a recording changed within two minutes, not that a Claude process has been independently verified as running.

### Investigation Scope

Library filters select **whole recordings**. A model filter matches historical model evidence, not just the last model displayed on a recording. A model/effort drill-down requires that pair on the same usage request. Tool filters match observed names exactly, with a separate MCP-tool family option. Last-activity presets replace custom date bounds; calendar dates use UTC. Recorded span is the time between first and last recorded timestamps, including pauses, not measured execution time.

Replay filters select **records inside one recording**, across every page. Mixed text/tool/thinking records remain discoverable in each relevant view. Tool filters include matching calls and their recorded results; an error constraint can narrow that to failures. Model and directory constraints use metadata actually present on each record, not inferred values. Missing timestamps cannot match date bounds. Matching counts distinguish a filtered view from the full transcript, and surrounding-context links restore original chronological evidence. Changing sessions clears the previous replay scope; library search and filters remain independent.

Cost bounds use only recordings with complete pricing coverage, so a partial estimate cannot silently qualify as a known final amount. Token bounds exclude recordings without usage. A recorded zero remains distinct from missing or entirely unpriced usage. Invalid numeric bounds are ignored by the API; reversed valid bounds match nothing. All filters and sorts are read-only and never modify source transcripts.

Resetting filters preserves your chosen recording order. Compact counts in the replay toolbar have exact totals in their tooltip and footer. Date-only API bounds use UTC; timestamp bounds must include `Z` or an explicit offset. Filter choices show up to 200 values per dimension and indicate when that list is limited. Malformed or oversized metadata stays available in raw records and full-record search rather than becoming misleading filter choices.

### Usage And Cost

The sidebar's **Highest cost (est.)** order covers every session and folder in each workspace, independently of the current date, search, bookmark, or other session filters. Copied requests count once within a workspace group; separate, ungrouped workspaces each show their own total. Missing or entirely unpriced usage sorts after known costs, including a recorded zero. Partial totals carry `+`; they rank by the known amount, not an assumed final cost.

Expand **Usage** and choose **Model & effort** to compare estimated expenses within the selected workspace group or filtered recordings. Each row shows a model/effort pair, unique request count, tokens, and estimated USD; the total reconciles with the group summary. Breakdowns can be ordered by cost, tokens, or name. Select a model/effort row to find recordings containing that pair; totals still include every request in those recordings. **Folders** returns to the original-folder breakdown. A single-folder selection shows the model matrix directly.

Model and effort are attributed per request, not from a recording's last model. Model aliases and dated IDs are normalized consistently with pricing. Effort is read only from explicit `effort` or `output_config.effort` fields on the assistant record or message. When absent, it is **Not recorded**—never inferred from model, token count, thinking blocks, or current Claude settings. This groups existing token costs; it does not apply an effort surcharge. Duplicate streaming updates retain recorded effort, and older indexes rebuild this metadata automatically.

Usage comes directly from assistant `message.usage` records in the indexed JSONL transcripts; no account, network request, or ccusage installation is required. Recorded nonnegative `costUSD` values take precedence. Otherwise, the bundled per-model [Anthropic API pricing](https://platform.claude.com/docs/en/about-claude/pricing) snapshot (September 23, 2026) estimates input, output, cache writes (5-minute and 1-hour), and cache reads. Recognized fast-mode and US-inference metadata are applied, along with legacy Sonnet 4/4.5 long-context rates. Unknown models or unsupported fast-mode rates remain unpriced; their tokens still count and the UI marks the cost incomplete. Costs are **API-equivalent estimates, not Claude Pro/Max subscription charges or a billing statement**. Historical prices, provider discounts, batch pricing and server-side tool fees may differ.

Repeated assistant messages are deduplicated by message/request identity, including across selected recordings. More complete streaming usage replaces earlier samples. Distinct subagent requests count once and follow the recording-type filter. Shared history is assigned to one source folder within an aggregate, so adding individual recording totals can exceed the deduplicated selection total. Records without stable IDs cannot reliably be deduplicated across files.

Folder attribution follows each recording's original working directory, consistent with workspace grouping; it does not split a recording when later events change directory. Date, model, search and other filters select **whole recordings**, not individual usage requests (date filters use the recording's last activity). Missing usage is not zero spend: the expanded summary shows how many matching recordings report usage. Partial-cent costs display as `<$0.01` rather than `$0.00`.

The derived index upgrades automatically and rebuilds usage from existing recordings on first launch after this update. Source transcripts, bookmarks and workspace groups are preserved. Pricing is offline and versioned with the application; changing bundled rates requires reindexing existing usage.

### Desktop And Responsive Layout

- Dark is the default theme. Choose **Dark** or **Light** in the sidebar footer; the muted, gray-scale light theme and text size preferences are saved in your browser. On mobile, open navigation to find these controls.
- Every display uses one sortable recording list, with compact archive totals and space-conscious headers. Searching or filtering puts results first and hides the global summary. Events inside a recording always retain their original sequence.
- Wide and ultrawide displays keep a bounded reading list rather than switching to a card grid; the replay workspace can still fill the available width.
- The replay workspace adapts pane widths, and replay prose fills the conversation pane by default. Set **Reading width** to **Comfortable** in the sidebar footer to hold prose to about 80 characters per line while code, diffs, and tables keep the full width; the choice is saved in your browser beside Theme and Text size. Large displays also show recording metadata and an event outline.
- Short displays get reduced vertical chrome rather than smaller conversation text.
- Tablet/mobile layouts prioritize one pane, with an accessible navigation drawer.
- Keyboard focus, reduced-motion preferences, and independently scrolling panes are supported.

Verified viewport sizes include **1280×720**, **1366×768**, **1920×1080**, **2560×1440**, **3440×1440**, **3840×2160**, and **390×844**. These are CSS viewport sizes; browser zoom and OS scaling naturally choose the appropriate layout.

### Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘ K` or `/` | Focus full-record search |
| Arrow keys | Move between focused recordings, including the desktop grid |
| `Enter` | Open the focused recording |
| `Esc` | Clear the focused search, dismiss navigation/help, or close the replay |
| `?` | Show shortcuts |

## Demo

```sh
bun run build
bun run demo
```

Open `http://127.0.0.1:12002`. The demo creates 15 explicitly synthetic recordings in `.blackbox/demo` and a separate index in `.blackbox/demo-state`. It never reads or modifies your Claude data. The generator only overwrites its own marked fixture files.

## Development And Verification

```sh
bun dev
bun run typecheck
bun run test
bun run test:e2e
bun run check
bun run desktop:sidecar
cargo check --manifest-path src-tauri/Cargo.toml
```

Development uses Vite on `127.0.0.1:12000` and the Bun API on `127.0.0.1:12001`. Stop any production server on that API port before starting development. For synthetic data, first run `bun scripts/demo.ts`, then `bun dev --dir .blackbox/demo --state-dir .blackbox/dev-state`.

Browser tests use **Bun's test runner with Playwright controlling installed Microsoft Edge**, not Playwright's Node-dependent test runner. They build the UI, preload the shared browser/server lifecycle across spec files, start an isolated fixture server on port `12003`, exercise real browser interactions, and audit accessibility with axe. Failed tests save screenshots and traces in ignored `test-results/`. No real transcripts are used by the test suite.

Solid and its web renderer are pinned to `2.0.0-rc.9`, with a matching pinned compiler plugin. The implementation uses Solid 2's split effects, renderer-owned JSX, `onSettled`, and keyed rendering. It is still prerelease software; update the runtime and compiler together, then rerun the complete checks.

## Releases

The release command requires a clean, synchronized `main` branch, authenticated `gh` CLI access, Bun, and Rust:

```sh
bun run release --patch
bun run release --minor
bun run release --major
```

The command uses SemVer to increment the current synchronized version. PowerShell-style aliases `-BumpPatch`, `-BumpMinor`, and `-BumpMajor` are also accepted. Use `bun run release 1.0.0` for an exact SemVer target, including prereleases such as `1.0.0-rc.1`, or add `--dry-run` to preview the selected version and release branch. Supplying the current exact version resumes an interrupted release after its version PR has already merged.

Run the command from a clean local `main` that exactly matches `origin/main`. It creates a `release/vX.Y.Z` branch, updates the package, Tauri, Cargo, and lockfile versions, runs the application and Rust checks, pushes the branch, and opens a release pull request. It enables squash auto-merge and waits without a fixed timeout for required checks, mergeability, and any approvals configured by repository policy. After GitHub merges the PR, the command synchronizes local `main` and only then creates and pushes the version tag. Finally it creates or reuses a draft GitHub release, dispatches or reuses `.github/workflows/desktop-release.yml`, waits for the signed Windows, Linux, and macOS bundles plus the verified `latest.json`, and publishes the release when the complete workflow succeeds.

If local validation fails before a PR exists, the command restores the version files and removes its generated branch automatically. If pull-request checks fail, the PR and remote release branch remain available for inspection and no tag or GitHub release is created. If anything fails after the version PR merges, rerun the current exact version—for example, `bun run release 0.5.0` while `main` is `0.5.0`—to resume from tagging, draft creation, workflow execution, or publication without creating another version PR. Versions containing a hyphen are published as prereleases. macOS CI builds use ad-hoc signing; configure normal platform signing credentials before presenting the artifacts as trusted production installers.

Updater signing depends on the repository Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep the matching private key backed up securely: changing or losing it prevents installed copies from trusting future updates.

The workflow's manual **Version tag** input is primarily a retry mechanism. Enter an existing tag such as `v0.4.0` only after a draft GitHub release for that tag already exists. The workflow builds and uploads assets but deliberately leaves the release as a draft; after every matrix job and updater-manifest verification succeeds, publish it with `gh release edit v0.4.0 --draft=false --latest`. Normal releases should use `bun run release`, which performs and watches these steps automatically.

Linux x64 releases include AppImage, DEB, and RPM packages. Linux ARM64 releases include DEB and RPM packages; ARM64 AppImage generation is omitted because its upstream `linuxdeploy` packaging path is not reliable on the native GitHub runner.

## Privacy And Storage

- Binds to **loopback only**. Foreign origins, unsafe mutation requests, and non-loopback hostnames are rejected. There is no permissive CORS mode, account, telemetry, or cloud service.
- Source transcripts are **read-only**. Workspace groups and bookmarks are stored only in the application index. Logged commands are never executed.
- Markdown is sanitized. Scripts, arbitrary styling, and remote images are blocked. Supported embedded bitmap attachments require an explicit reveal action.
- The derived SQLite index contains searchable transcript content and raw records. **It is sensitive, unencrypted local data**, not a redacted or encrypted vault. Protect it with the same care as your Claude directory. Windows permissions follow the parent directory's ACL; newly created Unix state directories request mode `0700`.
- Default state: `~/.cache/claude-blackbox/<source-directory-hash>/index.sqlite`. A custom state directory must be outside the Claude data directory, including through directory links.
- To reset, stop the server and remove only its chosen state directory. The next start rebuilds the index. This also removes its bookmarks and workspace groups; your source recordings remain untouched.

Large libraries use bounded result pages and on-demand tool bodies instead of mounting the entire archive. Files are tracked by source identity, size, modification time, and byte checkpoints; truncated/replaced files and interrupted indexing are reconciled. Malformed complete records are counted as warnings; incomplete trailing writes wait for completion. Export retains parsed record values but normalizes JSON whitespace and line endings.

See `docs/architecture.md` for the module boundaries and data flow.
