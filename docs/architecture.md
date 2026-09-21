# Architecture

claude-blackbox is a read-only, local-first browser for Claude Code transcripts.

## Boundaries

- `src/server`: Bun HTTP, incremental JSONL ingestion, SQLite FTS5 index, and local workspace preferences.
- `src/shared`: application data contracts, with no runtime or framework dependencies.
- `src/client`: Solid 2 components, URL-backed discovery state, and transcript presentation.
- `scripts`: Bun development runner and entirely synthetic demo recordings.
- `tests`: ingestion, search, API security, rendering helpers, and safe command quoting.
- `e2e`: Bun-run Playwright/Edge workflows, desktop viewport checks, and axe accessibility audits.

The server binds only to loopback. No transcript commands run, remote images load, telemetry is sent, or source files are changed. The derived index contains sensitive transcript data; keep its directory private. Workspace groups are reversible view preferences, not filesystem operations.

## Data flow

Discover JSONL files directly, including agent recordings. Index complete records using byte offsets and retain incomplete trailing writes for the next scan. Store provenance and raw records alongside searchable content. Reconcile changes and deletions, then notify clients with a single server-sent invalidation stream. Clients refetch bounded pages, not a guessed stream cursor. Reconnection always refreshes the current view.

Full-text queries are parameterized. Indexing is independent of `history.jsonl`; session identity includes its source file so duplicate IDs across copied directories do not collide. Unknown event types remain available through the activity filter and raw record disclosure.

The index tracks filesystem identity and prefix/tail checkpoints, maintains a separate tool-result lookup, and repairs interrupted imports at startup. Schema versioning invalidates derived records when normalization changes. Both the source and state paths are resolved through existing directory links before enforcing their separation.

## UI runtime

Solid `2.0.0-rc.9` and `@solidjs/web` are pinned together. The official Solid 2 migration and DOM documentation in the `solidjs/solid` repository defines the implementation: split compute/apply effects, `onSettled`, renderer-owned JSX types, and keyed list reconciliation. The matching `@solidjs/vite-plugin` is pinned. Vite performs the Solid compiler transform; Bun runs development, production, scripts, and tests. No Solid 1 compatibility UI packages are needed.

## Responsive workspace

Discovery uses one chronological list at every viewport, bounded to 1600px on wide displays. Archive totals are a compact definition list, hidden with the introductory copy while searching, filtering, or viewing a workspace. Workspace grouping has one persistent entry in the sidebar section heading. Replay fills the available workspace, and prose wraps to the full conversation width unless the reader opts into a measure: the sidebar's Reading width selector holds paragraphs, lists, blockquotes, and headings inside `.md-content` to about 80 characters per line in Comfortable mode, while code fences, tables, tool cards, and diffs keep the full width in both modes. Single source newlines in Markdown prose render as whitespace; paragraphs, explicit Markdown hard breaks, and code formatting remain intact. Code, diffs, tables, and tool output retain their existing width and overflow behavior. The session library can be hidden or resized by dragging its divider or using arrow keys, Home, and End; double-clicking restores its responsive default. Global search reveals a hidden library. A separately collapsible metadata and event-outline rail appears when the replay container has enough horizontal room. Height queries reduce chrome on short laptop displays. Mobile navigation is inert while hidden, with managed keyboard focus when open. The discovery filter menu is anchored to its control rather than the document flow: it stays inside the viewport horizontally, is capped to the space below its summary and flips above it when that space runs short, so its reset action stays reachable by internal scrolling, and becomes a bottom sheet with an explicit close control on phone widths.

Typography uses shared, rem-based roles: 14px controls and code, 12px metadata, 13px supporting text, and the existing 15px/1.65 conversation rhythm at the browser's default font size. Compact layouts retain the same role sizes rather than shrinking utility text. The sidebar's Text size selector offers a larger scale across discovery and replay, and the Reading width selector below it chooses between the full pane and a roughly 80-character measure that scales with the chosen text size. Both are saved locally in the browser, with an in-memory fallback when storage is unavailable; the saved reading width is applied to the document element before the application bundle runs and follows changes made in another tab, and an invalid or missing value falls back to the full width. Browser font preferences and zoom remain independent of these settings.

The replay header prioritizes the session title and close navigation, with copy-resume retained as a quieter secondary action. Event headers establish the first known working directory on each visible page and show subsequent changes; repeated identical paths are omitted from the header but remain in each raw event. Filtering and paging re-establish the visible source context. Raw event disclosures use muted metadata styling while preserving keyboard access and 44px phone hit areas. A keyboard-accessible Details disclosure holds the full title, original workspace, branch, model, activity counts, provenance, bookmark, and export actions without reducing the transcript viewport when open. Long titles take at most two header lines; their full text remains available in Details. Tabs and in-recording search share a row when the replay pane is wide enough, and stack on compact panes without reducing text size.

The client requests 50 recordings or 60 events at a time. Tool bodies and raw records mount on demand. Stable event identities preserve open disclosures across metadata refreshes, and request sequence guards prevent stale fetches from replacing a newer page.

## Implementation layers

1. Typed application foundation and pinned toolchain.
2. Lossless ingestion and searchable local index.
3. Loopback API, live invalidation, and reversible preferences.
4. Session discovery shell and structured replay.
5. Workspace grouping, focused search, and usability refinements.
6. Edge validation, regression coverage, and operating documentation.
