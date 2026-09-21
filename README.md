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

## Explore

- **Full-record search:** prompts, assistant responses, reasoning, file paths, commands, tool inputs/results, and recorded metadata. Matching snippets link directly to their events.
- **Combine filters:** workspace group, original folder, model, branch, date, tool, file changes, errors, recent activity, bookmarks, and subagent inclusion.
- **Reversible workspace groups:** give worktrees or clones one shared history without moving files. Original working directories remain visible and filterable. Grouping is explicit—not guessed from similar folder names.
- **Structured replay:** Markdown, tables, code, bounded line diffs, terminal output, file reads/writes, checklists, questions, delegated tasks, reasoning, and errors. Tool results are linked across event boundaries. Unknown records stay available under **All events** and **Raw event**.
- **Live updates:** the local index reconciles every 2.5 seconds. Reconnection refreshes the view. New events do not pull you away from older content; use **Jump to latest** when ready.
- **Return to your work:** bookmark a recording, copy its source path or safely quoted resume command, use an event permalink, or export the original parsed records as JSONL.

Search words combine with AND, including matches in different events of the same session. Quote phrases and prefix exclusions with a minus sign:

```text
authentication retry
"default limit" -timeout
src/auth.ts
```

Transcript search uses Unicode word/phrase tokenization, not regular expressions or fuzzy matching. Session titles and workspace metadata also support substring matches. Search within a recording uses literal substring matching. Calendar date bounds use UTC; displayed event times use your browser's local timezone.

All source recordings, including subagents, are included initially. Uncheck **Include subagent recordings** to focus on main sessions. **Conversation** hides internal metadata/context records; **All events** retains them. “Recently active” means a recording changed within two minutes, not that a Claude process has been independently verified as running.

### Desktop And Responsive Layout

- Dark is the default theme. Choose **Dark** or **Light** in the sidebar footer; the muted, gray-scale light theme and text size preferences are saved in your browser. On mobile, open navigation to find these controls.
- Compact laptop displays use a single recording list and space-conscious headers.
- Wide desktops use two recording columns; ultrawide and 4K displays use three.
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
```

Development uses Vite on `127.0.0.1:12000` and the Bun API on `127.0.0.1:12001`. Stop any production server on that API port before starting development. For synthetic data, first run `bun scripts/demo.ts`, then `bun dev --dir .blackbox/demo --state-dir .blackbox/dev-state`.

Browser tests use **Bun's test runner with Playwright controlling installed Microsoft Edge**, not Playwright's Node-dependent test runner. They build the UI, preload the shared browser/server lifecycle across spec files, start an isolated fixture server on port `12003`, exercise real browser interactions, and audit accessibility with axe. Failed tests save screenshots and traces in ignored `test-results/`. No real transcripts are used by the test suite.

Solid and its web renderer are pinned to `2.0.0-rc.9`, with a matching pinned compiler plugin. The implementation uses Solid 2's split effects, renderer-owned JSX, `onSettled`, and keyed rendering. It is still prerelease software; update the runtime and compiler together, then rerun the complete checks.

## Privacy And Storage

- Binds to **loopback only**. Foreign origins, unsafe mutation requests, and non-loopback hostnames are rejected. There is no permissive CORS mode, account, telemetry, or cloud service.
- Source transcripts are **read-only**. Workspace groups and bookmarks are stored only in the application index. Logged commands are never executed.
- Markdown is sanitized. Scripts, arbitrary styling, and remote images are blocked. Supported embedded bitmap attachments require an explicit reveal action.
- The derived SQLite index contains searchable transcript content and raw records. **It is sensitive, unencrypted local data**, not a redacted or encrypted vault. Protect it with the same care as your Claude directory. Windows permissions follow the parent directory's ACL; newly created Unix state directories request mode `0700`.
- Default state: `~/.cache/claude-blackbox/<source-directory-hash>/index.sqlite`. A custom state directory must be outside the Claude data directory, including through directory links.
- To reset, stop the server and remove only its chosen state directory. The next start rebuilds the index. This also removes its bookmarks and workspace groups; your source recordings remain untouched.

Large libraries use bounded result pages and on-demand tool bodies instead of mounting the entire archive. Files are tracked by source identity, size, modification time, and byte checkpoints; truncated/replaced files and interrupted indexing are reconciled. Malformed complete records are counted as warnings; incomplete trailing writes wait for completion. Export retains parsed record values but normalizes JSON whitespace and line endings.

See `docs/architecture.md` for the module boundaries and data flow.
