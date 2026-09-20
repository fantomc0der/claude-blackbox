# Architecture

claude-blackbox is a read-only, local-first browser for Claude Code transcripts.

## Boundaries

- `src/server`: Bun HTTP, incremental JSONL ingestion, SQLite FTS5 index, and local workspace preferences.
- `src/shared`: application data contracts, with no runtime or framework dependencies.
- `src/client`: Solid 2 components, URL-backed discovery state, and transcript presentation.
- `scripts`: Bun development runner and entirely synthetic demo recordings.
- `tests`: ingestion, search, API security, and browser regression coverage.

The server binds only to loopback. No transcript commands run, remote images load, telemetry is sent, or source files are changed. The derived index contains sensitive transcript data; keep its directory private. Workspace groups are reversible view preferences, not filesystem operations.

## Data flow

Discover JSONL files directly, including agent recordings. Index complete records using byte offsets and retain incomplete trailing writes for the next scan. Store provenance and raw records alongside searchable content. Reconcile changes and deletions, then notify clients with a single server-sent invalidation stream. Clients refetch bounded pages, not a guessed stream cursor. Reconnection always refreshes the current view.

Full-text queries are parameterized. Indexing is independent of `history.jsonl`; session identity includes its source file so duplicate IDs across copied directories do not collide. Unknown event types remain available through the activity filter and raw record disclosure.

## UI runtime

Solid `2.0.0-rc.9` and `@solidjs/web` are pinned together. The official Solid 2 migration and DOM documentation in the `solidjs/solid` repository defines the implementation: split compute/apply effects, `onSettled`, renderer-owned JSX types, and keyed list reconciliation. The matching `@solidjs/vite-plugin` is pinned. Vite performs the Solid compiler transform; Bun runs development, production, scripts, and tests. No Solid 1 compatibility UI packages are needed.

## Delivery sequence

1. Typed application foundation and pinned toolchain.
2. Lossless ingestion and searchable local index.
3. Loopback API, live invalidation, and reversible preferences.
4. Session discovery shell and structured replay.
5. Workspace grouping, focused search, and usability refinements.
6. Edge validation, regression coverage, and operating documentation.
