---
name: claude-blackbox
description: A dense, local-first session recorder with preserved charcoal-and-lime dark mode and a muted grayscale light mode.
colors:
  dark-bg: "#101214"
  dark-surface: "#171a1c"
  dark-raised: "#1d2123"
  dark-menu: "#1b1f21"
  dark-line: "#2a2e30"
  dark-text: "#e9eae5"
  dark-muted: "#929a9a"
  dark-accent: "#c7ee79"
  dark-danger: "#f4a59b"
  light-bg: "#efefed"
  light-surface: "#f6f6f4"
  light-raised: "#e4e4e1"
  light-line: "#d0d1cc"
  light-text: "#262825"
  light-muted: "#5c5f5a"
  light-accent: "#41453f"
  light-selected: "#daddd5"
  light-danger: "#944438"
typography:
  display:
    fontFamily: '"Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "clamp(24px, 2vw, 32px)"
    fontWeight: 530
    lineHeight: 1.25
    letterSpacing: "-.8px"
  body:
    fontFamily: '"Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: ".875rem"
    lineHeight: 1.5
  support:
    fontFamily: '"Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: ".8125rem"
  meta:
    fontFamily: '"Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: ".75rem"
  label:
    fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace'
    fontSize: ".6875rem"
  code:
    fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace'
    fontSize: ".875rem"
  replay-body:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: ".9375rem"
    lineHeight: 1.65
  replay-code:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: ".875rem"
    lineHeight: 1.55
rounded:
  control: "4px"
  field: "7px"
  brand: "8px"
  container: "10px"
  sheet: "14px"
spacing:
  control: "6px"
  compact: "8px"
  field: "10px 12px"
  sidebar: "27px 15px 0"
  sidebar-footer: "12px 5px 11px"
  topbar: "0 32px"
  library: "0 38px"
components:
  theme-option:
    backgroundColor: "{colors.dark-bg}"
    textColor: "{colors.dark-muted}"
    typography: "{typography.support}"
    rounded: "{rounded.control}"
    padding: "6px"
    height: "36px"
  theme-option-active-dark:
    backgroundColor: "#c7ee7910"
    textColor: "{colors.dark-accent}"
    rounded: "{rounded.control}"
  theme-option-active-light:
    backgroundColor: "{colors.light-accent}"
    textColor: "{colors.light-surface}"
    rounded: "{rounded.control}"
  sidebar-select:
    textColor: "{colors.dark-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "6px 9px"
  filter-menu:
    backgroundColor: "{colors.dark-menu}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.container}"
    padding: "20px"
    width: "min(300px, calc(100vw - 32px))"
  filter-menu-sheet:
    backgroundColor: "{colors.dark-menu}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.sheet}"
    padding: "16px 18px calc(20px + env(safe-area-inset-bottom))"
    width: "100%"
---

# Design System: claude-blackbox

## Overview

**Creative North Star: "The Local Flight Recorder"**

claude-blackbox is a dense, practical recorder UI: structured panes, quiet dividers, compact controls, and a single unmistakable dark accent make long session histories legible without turning the workspace into a dashboard spectacle. The default dark appearance is the incumbent system and remains unchanged.

The approved light mode is a durable alternate palette, not a redesign. It retains the same type, spacing, icon strokes, hierarchy, and responsive behavior while replacing the charcoal surfaces with muted off-white and gray; semantic green and red remain reserved for meaningful status and diff states.

Reading comfort is a settings concern rather than a layout concern. Theme, Text size, and Reading width sit together in one compact sidebar footer, each persists explicitly, and none of them moves a pane or alters the type ramp.

**Key Characteristics:**
- Compact, pane-based recorder layout.
- Charcoal-and-lime default with an explicit grayscale light alternate.
- System sans for UI, monospace for paths and code.
- Three persisted reading preferences in one sidebar footer.

## Colors

Dark mode is the default surface system; lime is its active accent. Light mode is intentionally mostly grayscale, using graphite for active controls rather than importing the dark lime into ordinary selection states.

### Primary
- **Recorder Lime:** Dark-mode links, selected controls, focus, and key status emphasis.
- **Graphite Active:** Light-mode selected controls and the theme switch's active light state.

### Secondary
- **Danger Rose:** Errors and removed diff content in both modes.

### Neutral
- **Charcoal Stack:** The dark canvas, panels, raised controls, dividers, primary text, muted metadata, and the slightly lifted charcoal shared by the anchored filter menu, the session-details menu, and the grouping dialog.
- **Off-White Stack:** The light canvas, panels, raised/inset surfaces, gray dividers, graphite text, and selected neutral fill.

### Named Rules
**The Preserved Dark Rule.** Dark mode is the baseline visual system; alternate-theme work must not alter its tokens or appearance.

**The Restrained Light Rule.** In light mode, ordinary navigation and controls stay grayscale; green and red communicate semantic status rather than decoration.

## Workspace Navigation Controls

Preserve the compact sidebar and its single Group action. A native select immediately above the workspace list offers Most sessions, Highest cost (est.), and Folder name (A–Z). Session count remains the default; the browser remembers the choice independently of recording filters. Name order is case-insensitive and natural, using the display name for groups.

A search-icon button reveals an inline name/path filter and moves focus into it. Match all member paths without splitting groups; Escape clears and closes the filter, returning focus to its trigger. No matches offers Clear filter rather than the new-user empty state. Sorting or filtering never changes the selected recording. Cost mode replaces row counts with all-time recorded/estimated USD, retaining session totals and full paths in tooltips. Unknown usage is never presented as free; partial totals retain the existing `+` convention.

Controls reuse theme tokens, native focus rings, and existing type sizes. Mobile controls have 44px minimum targets; the workspace list keeps its independent scroll area and the footer remains available on compact laptops.

## Typography

**Display Font:** Segoe UI Variable with Segoe UI and system-sans fallbacks.
**Body Font:** Segoe UI Variable with Segoe UI and system-sans fallbacks.
**Label/Mono Font:** Cascadia Code with SFMono-Regular and Consolas fallbacks.

Replay preserves its separate Inter/system-sans stack for transcript prose and platform monospace stack for tool output. These are font-family declarations, not bundled font assets.

Replay prose wraps across the full event width by default; a Reading width control offers an opt-in Comfortable measure of about 80 characters for paragraphs, lists, blockquotes, and headings, while code, diffs, tables, and tool cards keep the full width in both modes. Source soft newlines do not force visual breaks; paragraphs, intentional hard breaks, and code formatting remain intact.

**Character:** The interface uses a compact, high-legibility system sans with a modest hierarchy rather than a separate display face. Monospace is reserved for code, keyboard material, and technical content.

### Hierarchy
- **Display:** Variable weight 530, responsive 24–32px, 1.25 line-height, -.8px tracking; library headings. Phone headings use 25px and -.6px tracking.
- **Body:** 14px, 1.5 line-height; default controls and interface copy.
- **Support:** 13px; descriptions and compact option labels.
- **Meta:** 12px; timestamps, labels, and low-priority navigation metadata.
- **Label:** 11px monospace with .4–.8px tracking; the smallest text the interface permits, carrying the brand subtitle, the sidebar version line, and the demo badge.
- **Code:** 14px monospace; code and technical values.
- **Replay prose:** 15px, 1.65 line-height; transcript content, independently increased by the larger-text preference.

### Named Rules
**The Shared Scale Rule.** Theme choice changes color only; it never changes the established type ramp, the larger-text preference, or the reading-width measure.

**The Legible Floor Rule.** No interface text is set below 11px. When a label must take less room, reduce its tracking and padding rather than its size.

## Layout

The desktop shell is a 226px sidebar beside a fluid main pane, with a 68px top bar and 38px horizontal library padding; above 1600px the sidebar relaxes to a viewport-proportional 226–252px column, and on viewports 820px and shorter the top bar compresses to 57px. The sidebar narrows to 205px at 1250px and to 190px at 1050px; at 680px and below it becomes a 250px off-canvas drawer over a blurred scrim while the main shell stays full width. The workspace list holds a real minimum height of roughly a quarter of the viewport (140–360px) so it reads as a list rather than a sliver. Its section heading has one persistent, labeled Group action; there is no duplicate library-header action or grouping promotion below the list.

The sidebar footer stacks Theme, Text size, and Reading width so appearance and reading comfort stay together, above the privacy line and the version label. Both selectors consistently put an unwrapped label above a full-width control, with a 4px label gap and 8px gap after each setting.

The library prioritizes search and recordings over introductory content. Archive totals are a compact, unboxed definition list rather than metric tiles. Search, filters, and workspace selection remove the global summary and introduction; short screens also omit the introductory sentence. Recording rows stay in one chronological column at every viewport width, with the unsplit library capped at 1600px on wide displays. Replay still uses the full available workspace and preserves the resizable library and optional overview rail.

Recording rows share their column tracks across the loaded page rather than sizing metadata independently. Message and tool counts occupy separate aligned numeric tracks; timestamps align with the title line even when usage is absent. Long titles ellipsize on desktop and clamp to two lines on phones and in the replay list, without hiding bookmarks. Workspace, branch, and model labels truncate within their own bounds while full titles and provenance remain available on hover. Compact rows retain the model beneath the title/provenance and keep estimated cost beside the title; long cost and sort values wrap within the trailing column rather than squeezing the title away.

Transient menus are placed against the viewport, not against their container. The filter menu is positioned from its trigger's rectangle with a 9px gap below it, a 16px minimum inset from every viewport edge, and a 120px minimum height; it aligns to the trigger's opposite edge rather than overflowing. At 680px and below it becomes a full-width bottom sheet with a safe-area-aware bottom pad and its own close button.

**The Stable Frame Rule.** Theme changes recolor existing surfaces; they do not move navigation, library, replay, or top-bar structure.

**The In-Viewport Menu Rule.** A popover is anchored to its trigger but constrained by the viewport: 16px edge inset, 120px height floor, and a bottom sheet on phones. No menu may be positioned where it can open off-screen.

## Elevation & Depth

The system is primarily flat, using borders and tonal separation to establish panes. Dark mode uses restrained translucent black and lime glows for dialogs, toasts, and active brand details; light mode removes decorative brand shadowing and uses a soft neutral shadow only where overlay depth is required. Overlay shadows follow the direction of the lift: anchored menus and dialogs cast downward, and the phone bottom sheet casts upward from its top edge.

## Shapes

Controls are compact rounded rectangles: 4px inner button corners, 7px fields and segmented-control trays, 8px brand marks, and 10px container cards, including the anchored filter menu. The phone bottom sheet keeps 14px top corners and squares its bottom edge against the viewport. Thin one-pixel dividers articulate structure more often than shadows.

## Components

### Buttons
- **Shape:** Theme options use 4px corners; primary, secondary, and icon buttons retain their existing 6px corners and system type ramp.
- **Hover / Focus:** Hover changes foreground or raised surface; keyboard focus uses the active theme's accent with a 2px outline.
- **Disabled:** Reduced opacity communicates unavailable actions.
- **Touch:** Icon buttons are 36px at rest and 32px in their tiny variant; mobile navigation, grouping, filter-close, and replay icon controls have at least 44px hit areas.
- **Hierarchy:** Creating a group uses the filled primary style. Copy resume command is a visible, bordered secondary action rather than the brightest element above a transcript.

### Inputs / Fields
- **Style:** One-pixel divider stroke, field corner, and compact field padding.
- **Placeholder:** Placeholder text sits above the 4.5:1 contrast threshold against its own field surface in both themes, not at the muted-metadata level.
- **Focus:** Fields keep the global focus treatment with no separate visual language per theme.

### Navigation
- **Style:** Narrow sidebar, muted section metadata, and selected-item emphasis through the active palette.
- **Workspace list:** Scrolls inside a guaranteed minimum height, so a short list still occupies the rail and a long one never pushes the footer off-screen.
- **Mobile:** Navigation becomes the same 250px drawer at the mobile breakpoint; the three reading controls remain in its footer.

### Sidebar Footer
- **Style:** Theme first as a segmented fieldset, then Text size and Reading width with consistently stacked labels and full-width selectors.
- **Behavior:** Each preference persists independently and applies immediately; the version line closes the footer at the 11px label floor.

### Theme Control
- **Style:** A two-column Dark/Light segmented fieldset with a 3px inner gap and 36px minimum button height.
- **State:** `aria-pressed` marks the selected mode; dark selects lime-on-dim-lime and light selects off-white-on-graphite.
- **Persistence:** The explicit saved choice is applied before the app renders; a browser without a saved preference starts dark.

### Reading Width Control
- **Style:** A sidebar-footer select offering Full width and Comfortable, matching the Text size row exactly.
- **Persistence:** The choice is stored under `blackbox:reading-width` and applied to the document before first paint, the same way theme is, so the measure never changes after content appears.

### Filter Menu
- **Style:** A charcoal container-radius panel of about 300px, capped by the space between its trigger and the viewport floor, scrolling internally with contained overscroll.
- **Phone:** A full-width bottom sheet up to 80% of the viewport height, with a visible close button that exists only at that size.
- **Dismissal:** Escape or an outside pointer-down closes it and returns focus to the Filters trigger.

### Replay Event
- **Style:** A bordered transcript card with a monospace header carrying the role, a linked timestamp, and an error flag. The first known directory on each visible page is shown, followed by directory changes rather than repeated identical paths. Filtering or paging establishes the visible context again; exact per-event provenance remains in Raw event.
- **Raw records:** The disclosure stays keyboard accessible with muted metadata emphasis and a 44px minimum hit area on phones. Expanded records retain their original data and copy controls.
- **Role label:** Recorded roles are capitalized; a tool-result event reads "Tool result" in sentence case rather than being forced into the capitalized role pattern.
- **Counts:** The find row states shown-versus-total only when the two differ, and shows an em dash until a total is actually known.

### Named Rules
**The Single Dismissal Rule.** Every transient surface, including the filter menu, the session-details menu, the shortcuts popover, the mobile drawer, and the grouping dialog, closes on Escape and on an outside pointer-down, and returns focus to the control that opened it.

## Do's and Don'ts

### Do:
- **Do** preserve the dark token set when extending light mode or theme controls.
- **Do** use the grayscale light stack for standard light surfaces, borders, and selection.
- **Do** keep Theme, Text size, and Reading width together in the sidebar footer and retain them in the mobile drawer.
- **Do** apply saved explicit preferences before application rendering and update browser chrome to match.
- **Do** anchor popovers from their trigger's rectangle against the viewport, with a 16px edge inset and a 120px height floor, and use the bottom sheet below 681px.
- **Do** give every overlay the shared Escape and outside-dismissal behavior with focus return.
- **Do** keep interface text at or above 11px, trading tracking and padding for space instead of size.
- **Do** state an absent value plainly ("Model not recorded", an em dash for an unknown total), and carry the unit for assistive technology beside a bare number.

### Don't:
- **Don't** infer theme from system appearance; default to dark until the user explicitly selects Light.
- **Don't** use lime as general light-mode decoration or replace meaningful success/error colors with neutral styling.
- **Don't** change typography, spacing, or responsive structure merely to support a palette switch.
- **Don't** pin an overlay to its container's edge with ordinary absolute positioning; a menu that can open outside the viewport is a defect.
- **Don't** constrain the measure of code, diffs, tables, or tool cards; the reading-width setting applies to prose blocks only.
