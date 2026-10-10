# Agent Instructions

Read and follow `CLAUDE.md` before working in this repository. It contains the shared architecture, security, toolchain, and validation requirements for every coding agent.

## Protect Installed App State

- Development, preview, screenshot, and test runs must use an explicit isolated `--state-dir`, such as `.blackbox/dev-state`, never the installed application's default cache. Start with `bun run dev --state-dir .blackbox/dev-state`.
- Read **Development State Isolation (Required)** in `CLAUDE.md` before launching any server, desktop wrapper, or compiled sidecar. If a launcher cannot isolate its state, do not run it against the user's cache; use the isolated browser workflow or ask first.
- Do not reset, migrate, rename, or delete installed-app state, or terminate an installed app, without explicit user authorization. Read-only source recordings do not make the derived index read-only.
