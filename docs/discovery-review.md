# Sorting and filtering review

This is the requested critique and review process record; user-facing behavior is documented in README.

Reviewed September 23, 2026. Target: `src/client`, in Operate mode. Independent design assessment and detector assessment, followed by implementation and browser verification.

## Baseline

The existing compact library, source-folder provenance, reversible workspace groups, and careful usage caveats suit a local investigation tool. Discovery has not caught up with the available recording data. Preserve the visual identity and original replay sequence rather than introducing a new dashboard or ranking recorded events by inferred importance.

| Usability heuristic | Score |
| --- | --- |
| Visibility of current scope | 2/4 |
| Match to investigation tasks | 2/4 |
| Control and recovery | 2/4 |
| Consistency | 3/4 |
| Error prevention | 3/4 |
| Recognition over recall | 2/4 |
| Efficiency | 2/4 |
| Restraint and hierarchy | 3/4 |
| Empty-state recovery | 3/4 |
| Help and explanations | 3/4 |
| **Total** | **25/40** |

## Priority changes

1. **P1: Rank whole sessions by the investigation.** Existing recent/activity ordering cannot answer which sessions cost most, consumed most tokens, or recorded the most errors. Add cost, tokens, errors, tool calls, recorded span, and title ordering before pagination. Keep missing prices after known prices, including a recorded zero. Suggested command: `$impeccable craft`.
2. **P1: Make pricing coverage and workload selectable.** Offer complete, partial, entirely unpriced, and missing-usage states. Add optional estimated-cost, token, and record-count bounds in progressive disclosure. Cost bounds require complete pricing; partial lower bounds must not pass as final totals. Suggested command: `$impeccable clarify`.
3. **P1: Filter actual recorded evidence.** Historical models must remain discoverable after a model switch. Populate tool choices from observed names rather than a static list, retain the MCP family, and distinguish main sessions from subagents. Date presets replace custom ranges and clearly select last activity in UTC. Suggested command: `$impeccable harden`.
4. **P1: Add focused long-session views.** Prompts, responses, file edits, reasoning, tools, errors, and system records serve different investigation jobs. Use progressive controls for recorded tool, model, directory, and date constraints. Match mixed-content records by their blocks, not an exclusive category alone. Preserve original sequence. Suggested command: `$impeccable shape`.
5. **P1: Recover surrounding context.** Persist replay scope in the URL, show matching and whole-recording counts, and provide full reset and surrounding-context actions. Beginning/latest navigation changes the page, not the evidence order. Keep tool-call/result pairing and the existing page outline. Suggested command: `$impeccable harden`.
6. **P2: Make usage comparisons actionable.** Sort breakdowns by cost, tokens, or name and drill into model/effort evidence. Explain that these select whole recordings: all models and requests in those recordings remain in the total. Correct stale-filter and keyboard navigation inconsistencies. Suggested command: `$impeccable clarify`.

## User perspectives

- **Cost-conscious engineer:** find expensive/token-heavy recordings, distinguish unknown costs, and inspect the models and tools involved. Avoid false confidence from partial estimates or double-counted streaming usage.
- **Returning engineer:** recover a previous prompt, decision, command, or file edit without reading hundreds of unrelated records. Keep search terms and scope through reload and browser history.
- **Debugging reviewer:** isolate recorded failures and changes, then reveal the instructions and recovery on either side. Never imply filtered results are the complete transcript.
- **Keyboard and screen-reader user:** labelled native controls, announced result counts, visible focus, removable scope, and one-step recovery from no matches. No click-only filtering or keyboard traps.
- **Mobile user:** advanced controls scroll within the viewport without displacing the entire transcript. Keep essential navigation reachable and preserve state after interruption.

## Deliberate limits

Workspace search and session/cost/name ordering already serve their purpose. Do not duplicate them with speculative workspace metrics. Do not infer task quality, task categories, productivity, execution duration, or subscription charges. A recording's timestamp span includes pauses. Keep replay chronological; sort sessions and aggregate breakdowns instead. Preserve all existing export, resume, bookmark, source, raw-record, and usage details.

## Detector evidence

The baseline scan reported 114 findings: 79 palette advisories, 17 radius advisories, 16 type-size advisories, one overused-font warning, and one side-tab warning. There were 93 in `src/client/styles/app.css` and 21 in `src/client/styles/replay.css`. Established tonal/status colors and compact controls account for much of the token-documentation drift; this is not a mandate for an unrelated redesign.

Questions skipped: the product owner explicitly requested autonomous implementation, review, pull request handling, merge, and a minor release.

## Implementation review

The requested independent Sol review found three in-scope issues, all resolved and re-reviewed:

- The top Errors view now selects errors across all event kinds; the advanced errors checkbox still combines with a focused view.
- A live-update notification explicitly opens the latest unfiltered records instead of leaving new activity hidden behind the current filter.
- Library model-filter results identify the matched model; assistant event headers expose the actual recorded model.

The review also discussed pre-existing bundled pricing modifiers. This feature does not change those rates or eligibility rules: it extracts the existing model normalizer and preserves the pricing snapshot. Pricing-policy changes need a separate, sourced update.

Claude PR feedback also led to restored default-conversation copy, incrementally indexed/cached and bounded filter choices, unambiguous missing-effort filtering, offset-explicit timestamp bounds, and isolated live-update fixtures. Raw metadata remains available even when it is unsuitable for a filter choice.

Validation: `bun run check` passes with 62 unit tests; `bun run test:e2e` passes with 91 browser tests. Remote Edge confirmation covers desktop and mobile, dark and light themes, library/replay filters, and surrounding-context navigation with no page errors or horizontal overflow. Existing export, bookmark, grouping, origin-security, live-update, keyboard, and accessibility regressions remain covered.
