---
version: 1
slug: "src-client-components-sidebar-tsx"
primary_target: "src/client/components/sidebar.tsx"
related_targets: ["src/client/styles/light.css","src/client/components/theme-control.tsx"]
---

# Appearance controls

Mode: Operate. Scope: sidebar theme control and the alternate light palette.

## Direction contract

THESIS: Let engineers choose a comfortable reading environment without changing the familiar recorder layout. Appearance belongs with text size, not the search and replay actions.

OWN-WORLD: Preserve the current charcoal-and-lime dark theme exactly. Light mode uses off-white canvas and panels, soft gray dividers, graphite type and selected controls. Muted green/red remain only for meaningful success, errors, and code diffs. Existing fonts, spacing, and icon strokes stay intact.

STORY: Find Theme above Text size, choose the explicitly labeled Dark or Light control, and return to the same recording. The preference survives reloads; a new browser always starts dark regardless of system appearance.

FIRST VIEWPORT: Keep the navigation, library, and top bar in place. A compact two-option control sits in the sidebar footer and remains available inside mobile navigation. Both choices support keyboard focus and announce their selected state.

FORM: Narrow extension of the existing surface; no concept seed or replacement identity. Apply the saved theme before the application renders, including browser chrome.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Evidence and finish

- **Disposition:** SHIP. The finish reviewer reached the review ceiling with no material fixes; dark remains visually preserved and the approved light palette stays muted, off-white, and mostly grayscale.
- **Responsive evidence:** Reviewed desktop (1440×1000), compact (1280×720), wide, replay, tools (1920×1080), mobile, and both dark/light mobile drawer captures. The existing compact, wide, and mobile-drawer adaptations hold, including the sidebar footer control.
- **Visual detector:** `.impeccable/review/theme-detector.json` returned `[]`.
- **Verification:** `bun run check` passed typecheck, 22 unit tests, and the production build. `bun run test:e2e` passed 31 browser tests with zero failures, including 7 theme tests; the shared harness is preloaded through `package.json` so its lifecycle covers both spec files.
- **Provenance:** Review evidence is retained in `.playwright/theme-before.png` and `.impeccable/review/theme-*.png`. No new bitmap asset ships with this change.
