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

Discovery uses a single list on compact displays, a two-column grid on wide desktops, and three columns on ultrawide/4K displays. Replay keeps a bounded reading column; a metadata and event-outline rail appears when there is enough horizontal room. Height queries reduce chrome on short laptop displays. Mobile navigation is inert while hidden, with managed keyboard focus when open.

The client requests 50 recordings or 60 events at a time. Tool bodies and raw records mount on demand. Stable event identities preserve open disclosures across metadata refreshes, and request sequence guards prevent stale fetches from replacing a newer page.

## Implementation layers

1. Typed application foundation and pinned toolchain.
2. Lossless ingestion and searchable local index.
3. Loopback API, live invalidation, and reversible preferences.
4. Session discovery shell and structured replay.
5. Workspace grouping, focused search, and usability refinements.
6. Edge validation, regression coverage, and operating documentation.
