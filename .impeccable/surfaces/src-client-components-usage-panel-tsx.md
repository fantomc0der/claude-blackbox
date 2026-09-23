---
version: 1
slug: "src-client-components-usage-panel-tsx"
primary_target: "src/client/components/usage-panel.tsx"
related_targets: ["src/client/components/library.tsx", "src/client/components/replay-panel.tsx", "src/client/styles/usage.css"]
---

# Recording usage

Mode: Operate. Scope: usage and estimated API cost in the existing library and replay.

## Direction contract

THESIS: Make the cost of a folder or workspace group as easy to inspect as its recordings, without introducing a separate dashboard or billing claims.

OWN-WORLD: Extend the incumbent charcoal-and-lime dark theme and muted grayscale light theme. Reuse system typography, semantic color tokens, outlined icons, quiet dividers and compact chronological rows. No new assets or replacement identity.

STORY: Select a folder or workspace group, read its token and cost total, expand Usage to compare original folders, and drill into a folder or recording. Preserve existing search, grouping, filters and replay behavior.

FIRST VIEWPORT: A compact Usage disclosure shows tokens and estimated USD for all matching recordings, not just the current page. Row estimates remain secondary to titles. Expanded details provide token categories, source-folder drilldown, reporting coverage and cost caveats. Compact replay keeps usage in Session actions/details to preserve reading space.

FORM: Ordinary extension of an established product surface. Costs use tabular numerals. Native disclosure behavior provides keyboard access. Missing usage is not zero spend; unknown pricing is explicitly incomplete. Desktop and mobile remain operable in both themes.

QUALITY BAR: Retain a useful recording list on compact displays; avoid page overflow at 320px; preserve replay reading height; keep menus within the viewport; make grouping and folder drilldown reflect server totals. Do not imply that API-equivalent estimates equal subscription billing.

FINISH: Validate the data path and browser interactions, review fresh desktop/mobile captures, and compare the extension with the incumbent design system without repairing unrelated drift.

## Model and effort extension

The expanded Usage view offers a Folders / Model & effort toggle for multi-folder selections. The latter is a quiet expense matrix, ordered by estimated cost, with model, recorded effort, unique request count, tokens and estimated USD; a total row reconciles with the existing selection summary. Single-folder selections show the matrix directly. The collapsed first viewport stays unchanged.

Model and effort belong to individual requests, not the recording's last model. Missing effort stays Not recorded, and unpriced costs remain unavailable or explicitly partial. No effort level or surcharge is inferred. Existing folder drilldown, filters, pagination and unknown-usage states stay intact.

Extension quality bar: use the incumbent typography, semantic colors and native buttons; keep the toggle keyboard-operable and the matrix readable at 320px and in both themes; preserve list/replay reading space; require matrix totals to reconcile after de-duplication and filtering.

### Matrix follow-up evidence and finish

- **Disposition:** Fresh reviewer SHIP; ceiling reached, no material fixes. The original usage finish record below remains historical (37 unit tests / 64 browser tests).
- **Captures checked:** `.impeccable/review/effort-desktop.png` and `effort-light-desktop.png` (1440x1000), `effort-mobile.png` and `effort-light-mobile.png` (390x844), `effort-small-mobile.png` (320x640), and `effort-split.png` (1920x1080). The captured matrix fits narrow widths and the split-library pane; expanded content scrolls within the bounded usage area rather than expanding the replay header.
- **Implementation comparison:** `usage-panel.tsx` and `usage.css` retain the native Usage disclosure and reuse the incumbent segmented-control geometry (7px tray, 4px buttons, 36px minimum height / 44px on mobile), native buttons with `aria-pressed`, semantic table headers, support/meta type tokens, quiet dividers and tabular numbers. Charcoal/lime dark and grayscale light treatments preserve the Preserved Dark, Restrained Light, Shared Scale and Stable Frame rules in `DESIGN.md` and its sidecar.
- **Data presentation:** Request-level model/effort groups show request counts, tokens and estimated USD; missing effort is explicitly Not recorded, with no inferred level or surcharge. Partial-price warnings remain explicit. The matrix footer and collapsed summary consume the same selection aggregate; supplied validation confirms deduplicated group/folder consistency.
- **Validation supplied, not rerun:** `bun run check` passed TypeScript, 42 unit tests and production build; the full browser suite passed all 67 tests, including matrix keyboard operation, group/folder consistency, missing prices, narrow overflow in both themes and axe checks. The inspected `.impeccable/review/effort-detector.json` is `[]`. No browser or tests were launched for this documentation pass.
- **Preservation and drift:** `DESIGN.md` and `.impeccable/design.json` remain unchanged. The existing sidecar Replay Event Card preview unconditionally caps prose at 80ch, unlike the documented full-width default with opt-in Comfortable measure; this unrelated preview discrepancy is noted, not repaired or adopted as a matrix rule. All current working-tree edits, including demo effort examples, belong to this feature and are not classified as unrelated drift.

## Evidence and finish record

- **Disposition:** Ship. The finished extension meets the supplied review ceiling; no material visual fixes are indicated.
- **Captures checked:** dark desktop and expanded (`1440x1000`), dark mobile and expanded (`390x844`), light desktop/mobile, compact (`1280x720`), grouped desktop/mobile, replay, and session-details (`1920x1080`).
- **Behavior evidenced:** all-matching-recording aggregate, original-folder drilldown, workspace-group totals, compact row estimates, and replay/session-details usage remain legible without displacing the recording list or replay reading surface.
- **Validation record:** `bun run check` passed TypeScript, 37 unit tests, and production build; the 64-browser-test e2e run passed; remote Edge preview reported zero console errors or warnings. `usage-detector.json` is `[]`.
- **Assets:** no bitmap assets ship; the PNGs are review evidence only.

## Incumbent comparison

- The extension preserves the documented charcoal-and-lime dark theme, muted grayscale light theme, system typography, quiet dividers, compact rows, and native disclosure pattern. Token/cost figures use the established restrained secondary treatment and tabular-number styling.
- `DESIGN.md` and `.impeccable/design.json` remain unchanged. The in-scope `scripts/demo.ts` update supplies synthetic token usage for preview and regression coverage.
