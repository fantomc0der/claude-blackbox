# Development

Coding agents must read `AGENTS.md` and `CLAUDE.md`, including the required state-isolation and cleanup rules, before starting local servers or desktop previews.

## Commands

```sh
bun run dev --state-dir .blackbox/dev-state
bun run typecheck
bun run test
bun run test:e2e
bun run check
bun run desktop:sidecar
cargo check --manifest-path src-tauri/Cargo.toml
```

## Isolated state

Development uses Vite on `127.0.0.1:12000` and the Bun API on `127.0.0.1:12001`. Always give development and review servers their own `--state-dir`; the example uses ignored checkout-local state instead of the installed app's shared cache. Changing the port does not isolate the index. Use a fresh task-specific state directory when switching between incompatible schema versions.

For synthetic data, first run `bun scripts/demo.ts`, then:

```sh
bun run dev --dir .blackbox/demo --state-dir .blackbox/demo-dev-state
```

If either development port is occupied, do not stop an installed app or unrelated server to free it. A built browser preview can use an available port and separate state instead:

```sh
bun run build
bun start --state-dir .blackbox/review-state --port 12004
```

Open `http://127.0.0.1:12004` after checking that port is free. Desktop launchers do not isolate their state; see the [desktop cache warning](desktop.md#development-cache-warning).

## Browser tests

Browser tests use **Bun's test runner with Playwright controlling installed Microsoft Edge**, not Playwright's Node-dependent test runner. They build the UI, preload the shared browser/server lifecycle across spec files, start an isolated fixture server on port `12003`, exercise real browser interactions, and audit accessibility with axe. Failed tests save screenshots and traces in ignored `test-results/`. No real transcripts are used by the test suite.

## Inspecting recording formats

To see which record types, keys, usage fields, models, and Claude Code versions a Claude data directory holds, run `bun scripts/inspect-format.ts` with an optional `--dir <path>` or `--json`. It reads the recordings read-only and prints only key names, short identifiers, and counts, never transcript content, paths, or ids, so its output can be shared when a Claude Code release changes the recording format.

## Solid prerelease

Solid and its web renderer are pinned to `2.0.0-rc.9`, with a matching pinned compiler plugin. The implementation uses Solid 2's split effects, renderer-owned JSX, `onSettled`, and keyed rendering. It is still prerelease software; update the runtime and compiler together, then rerun the complete checks.
