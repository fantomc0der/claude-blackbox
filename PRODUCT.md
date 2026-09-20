# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary audience is any software engineer who uses Claude Code, not just the original author's personal workflow. This audience was explicitly confirmed by the product owner.

Engineers should be able to recover useful context from their own sessions across projects, clones, and worktrees without needing prior knowledge of this application's internals. The product should make its benefits apparent through useful everyday tasks rather than assume a specialized session-analysis workflow.

## Product Purpose

Make Claude Code conversation history easy to find, understand, and return to in a clean web interface.

Core jobs:

- Find a previous conversation, decision, command, file change, or tool result.
- Understand what happened in a session through faithful, readable replay.
- View related project folders together without losing their original working directories.
- Follow newly recorded activity without interrupting a review of older material.
- Return to work by copying the appropriate resume command, bookmarking a session, or exporting its records.

Success means recovering the relevant context quickly while retaining access to the underlying evidence.

## Positioning

A local flight recorder for existing Claude Code sessions: discovery, replay, and provenance in one interface. It is not a replacement chat client or an interface for executing recorded commands.

The current product combines full-record search, reversible workspace grouping, and structured transcript rendering. Do not replace these concrete capabilities with unsupported claims about being the fastest, most comprehensive, or most widely used tool.

## Operating Context

- Engineers use a browser to inspect Claude Code transcripts stored on their own machine.
- Desktop use is a primary requirement, including compact laptops, wide monitors, ultrawide monitors, different window sizes, and display scaling. Smaller-screen access must remain usable.
- Projects may have multiple clones or worktrees. A logical workspace group is separate from the original filesystem path.
- Claude Code and the terminal remain the places where sessions run or resume. This application copies commands; it does not run them.
- Recordings can be large, actively changing, partially written, or contain unfamiliar event types.
- Transcript content is potentially sensitive: source code, prompts, commands, tool output, paths, and credentials may appear in it.
- Microsoft Edge on Windows is the established browser-validation environment. This does not imply that other platforms are unsupported or already verified.

## Capabilities and Constraints

- Read transcripts directly without requiring a separate history-file entry for every recording.
- Search transcript content and relevant metadata, with combined filters and matching context.
- Group worktrees or clones reversibly. Preserve source paths and allow filtering by original folder.
- Render text, Markdown, code, file edits, terminal output, reasoning, tasks, questions, errors, and other recorded content appropriately. Keep raw records available rather than silently discarding unfamiliar content.
- Preserve event order and associate tool results with their recorded tool calls where possible.
- Keep navigation, search, replay, and updates responsive as the archive grows. Do not mount the whole archive merely to browse it.
- Preserve the current read-only boundary around Claude's source data. Bookmarks, grouping, and the derived index belong to application state, not source transcripts.
- The current product is local-only: a loopback server, no account, no telemetry, and no cloud dependency for browsing recordings.
- The derived index contains unencrypted transcript data. Do not imply that local-first storage provides encryption, redaction, or a security certification.
- Sanitize transcript markup, block automatic remote image loading, and never execute commands embedded in recordings.
- Distinguish recorded evidence from inference. Recent file activity does not independently prove that a Claude process is running.
- Bun and SolidJS are the owner's technology choices. Package versions and prerelease pins are maintained in the package manifest and lockfile; dependency changes require validation.

## Brand Commitments

- Product and tool name: **claude-blackbox**.
- Repository description: **The flight recorder for your Claude Code sessions. Replay every conversation in a clean web UI**.
- Flight-recorder terminology may add character, but it must not obscure familiar concepts such as sessions, workspaces, source folders, search, and replay.
- The owner wants a modern, impressive, fast, clean interface without sacrificing usability or functionality.
- Initialization does not authorize a redesign. The accepted interface remains the reference for scoped refinements unless the owner requests a different direction.

## Evidence on Hand

- `README.md`: current installation, capabilities, privacy boundaries, and operating instructions.
- `docs/architecture.md`: implementation boundaries, ingestion, live updates, and responsive workspace behavior.
- `src/client/` and `src/server/`: the implemented application, rather than a speculative feature list.
- `scripts/demo.ts` and `tests/fixtures.ts`: explicitly synthetic demonstration recordings. They are not customer evidence.
- `tests/` and `e2e/`: regression coverage, Edge interactions, responsive viewport checks, and automated accessibility checks.

No customer endorsements, adoption statistics, commercial claims, or representative performance benchmarks have been provided. Do not invent them. Real local transcripts and screenshots are private operational data, not publishable proof assets by default.

## Product Principles

1. **Useful to Claude Code engineers broadly.** Avoid assumptions that only fit one person's projects, folder conventions, or habits.
2. **Fidelity before interpretation.** Make records easier to understand without changing their meaning or hiding access to the original evidence.
3. **Discovery with provenance.** Organize related work together while keeping its origin visible.
4. **Local control and non-destructive operation.** Keep the boundary between viewing history and modifying or executing work explicit.
5. **Craft in service of use.** Performance, clear interactions, and adaptable layouts take precedence over decorative complexity.

## Accessibility & Inclusion

Preserve the implemented keyboard navigation, labeled controls, visible focus, focus management, reduced-motion handling, and usable empty/error states. Responsive behavior must support different desktop monitor sizes, not only a single presentation viewport.

Automated accessibility tests are validation evidence, not a claim of comprehensive conformance. A formal accessibility standard or certification target has not been specified.

## Open Product Decisions

- Public distribution, release channels, pricing, and licensing have not been established by this product brief. A broad audience is not itself a publishing or commercial plan.
- A formal supported-browser and operating-system matrix remains to be defined beyond the existing validation evidence.
- Future capabilities beyond the current local recorder are undecided. Do not infer plans for cloud synchronization, accounts, collaboration, or remote execution.
