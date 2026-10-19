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
  sidebar-footer: "8px 0 7px"
  topbar: "0 32px"
  library: "0 38px"
components:
  theme-option:
    backgroundColor: "{colors.dark-bg}"
    textColor: "{colors.dark-muted}"
    typography: "{typography.support}"
    rounded: "{rounded.control}"
    padding: "4px"
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
    typography: "{typography.support}"
    rounded: "{rounded.field}"
    padding: "4px 6px"
    height: "32px"
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
- **Caution Amber:** Tools a decision stopped, whether the user, a permission rule, a hook, or the auto mode classifier refused them or they were interrupted or cancelled: `#e0b86b` on charcoal, the light warning brown (`#785832`) in light mode. A decision, never a failure.

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

## Replay Activity Strip

When a replay's filtered set spans more than one 60-record page, a 61px strip sits between the replay controls and the transcript at every width: a 30px track of bars, a 4px gap, then a 12px axis of 11px monospace local times, inset 7px above and below so the labels never touch the divider. Transcript records scrolling beneath it fade out over a 14px edge instead of being cut off at the divider; at rest the fade covers only the transcript's top padding. Bars count matching records per time bin on an axis set by the whole recording, so tabs and filters change heights but never move activity sideways. While the set is narrowed, a faint ghost of every record sits behind the matches. The loaded page is an outlined window in the accent (lime in dark mode, graphite in light); bars inside it use the text color and bars outside it the muted color. Errors fill the top of each bar in Danger Rose in proportion to that bin's error share, with no minimum, so a steady background failure rate stays faint while clusters stand out; the errors-only view omits them. Bars outside the window keep 3:1 contrast against the canvas.

Time is linear inside active stretches. Up to six of the longest idle stretches collapse into fixed-width breaks drawn as a double slash with the duration above it (`95m`, `15h`), so a session resumed the next day stays readable; every stretch keeps at least three bins so short bursts stay clickable. The recording's end time is always labelled; stretch start times appear where they fit, with the date at the first label and at day changes.

The strip is one slider tab stop. Click or drag (committing on release) to start a page at a bin's first record; arrows step between bins, Page Up/Down by page, Home/End to the ends. Near the end the page clamps to a full last page and scrolls the chosen record into view. The pager leads the replay footer from the transcript's left gutter, with Previous and Next between Beginning and Jump to latest and the current record range set in text color so the position reads first; the read-only badge trails on the right and hides at the 1050px and phone breakpoints, where the footer is narrowest. `[` / `]` page from anywhere in the replay except while typing or with a menu, dialog, or drawer open.

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

The sidebar footer keeps Theme, Text size, and Reading width together and visible so appearance and reading comfort stay together, above the index status, the privacy line, and the version label. Each setting is a row with its label on the left and its control on the right, 6px apart, with 4px between settings. All three share the same label and control minimums, so the theme buttons and selectors have matching left and right edges and switch layouts together. When they do not fit beside their unwrapped labels, controls drop below at full width with a 3px gap. At standard text size they sit beside their labels from the 226px sidebar up and stack in the 205px and 190px sidebars. A quiet divider separates the index and privacy status from the appearance fields. Footer controls and status labels align with the workspace list edges.

On viewports 820px and shorter the sidebar tightens its vertical rhythm: 16px top padding, 8px below the brand, 36px primary navigation items, and 12px/4px around the Workspaces label. With these, a 1100×700 laptop shows the whole footer with no sidebar scroll while the workspace list keeps its minimum height.

The library prioritizes search and recordings over introductory content. The landing heading stands alone, with no introductory sentence beneath it. Archive totals are a compact, unboxed definition list rather than metric tiles, shown only beside the hero on tall, unfiltered landings. Search, filters, workspace selection, and an open replay remove the hero and the totals. Desktop screens 820px and shorter do too: the landing heading reads "Session library" there, and the totals are hidden, so the height goes to recording rows. Phones keep the hero and the totals. Recording rows stay in one chronological column at every viewport width, with the unsplit library capped at 1600px on wide displays. Replay still uses the full available workspace and preserves the resizable library and optional overview rail.

Recording rows share their column tracks across the loaded page rather than sizing metadata independently. Message and tool counts occupy separate aligned numeric tracks; timestamps align with the title line even when usage is absent. Long titles ellipsize on desktop and clamp to two lines on phones and in the replay list, without hiding bookmarks. Workspace, branch, and model labels truncate within their own bounds while full titles and provenance remain available on hover. A row in a workspace group names the group and then its own folder ("Orbit › orbit-auth", a drawn chevron between them, read as "Orbit, folder orbit-auth"), so worktrees stay distinguishable; the repeated group name gives up its width before the folder does. Search results keep the folder and branch line beneath the matching snippet rather than replacing it, at the cost of row height, in the full library, the replay list, and on phones. Compact rows retain the model beneath the title/provenance and keep estimated cost beside the title; long cost and sort values wrap within the trailing column rather than squeezing the title away.

The row symbol marks the recording's kind: a message for a conversation, a pencil for file changes, a branch for a subagent. A recording with errors tints the symbol and adds a 7px corner mark in the same tint, so the state never rests on hue alone. The symbol's tooltip names both, with the API errors among the errors and the tools a decision stopped, which never tint it ("File changes · 3 errors (1 API error) · 2 tools stopped"), and the row's accessible name carries the bookmark, file-change, and error-count facts after the title, since the icons themselves are decorative. The replay rail's error count and Session details' Errors row say the same.

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
- **Focus:** Fields keep the global focus treatment with no separate visual language per theme. The two fields with borderless inputs draw the same 2px accent outline at a -1px offset, so their perimeter matches every other control without shifting layout. The library search box carries it on the box, over its border. The replay's Find in this recording input carries it on the input itself rather than the whole find row with its stepping controls; its 6px inline padding is cancelled by an equal negative margin, so the text and its neighbors keep their place.

### Navigation
- **Style:** Narrow sidebar, muted section metadata, and selected-item emphasis through the active palette.
- **Workspace list:** Scrolls inside a guaranteed minimum height, so a short list still occupies the rail and a long one never pushes the footer off-screen.
- **Mobile:** Navigation becomes the same 250px drawer at the mobile breakpoint; the three reading controls remain in its footer.
- **Subagent visibility:** Not a sidebar control. The library's Show subagents switch owns it, and the sidebar's counts and workspace list follow that switch.

### Keyboard Wayfinding
- **Opening a replay:** Enter or Space on a recording moves focus to the replay heading once it loads, showing the 2px focus outline, so the next Tab continues into the replay (the bookmark toggle, then Close replay) instead of through the remaining rows. A pointer open leaves focus on the row. Escape or Close replay returns focus to the row either way.
- **Skip links:** Skip to recordings is always available. While a replay is open, Skip to transcript comes first and focuses the transcript, so Page Up and Page Down scroll it at once.
- **Document title:** The browser tab names the view: "<recording title> · claude-blackbox" in a replay, "Search: <term> · claude-blackbox" for a search, the workspace name or "Bookmarked" for those views, and the landing title otherwise. Closing a replay restores the title of the view beneath it.

### Sidebar Footer
- **Style:** Theme first as a segmented fieldset, then Text size and Reading width, all sharing 32px control heights and the 13px support size on fine-pointer desktops. Labels sit on the left and never wrap; controls that do not fit stack beneath their labels at full width, and all three settings share one layout.
- **Behavior:** Each preference persists independently and applies immediately; the version line closes the footer at the 11px label floor.
- **Index status:** A divider separates the status area from preferences. Every state is one left-aligned line that sits vertically centered in the row, and its detail wraps beneath the label only when it must, which a long reconnecting or error detail, or larger text in the narrowest sidebar, can require. While files are checked the count reads `115 / 195` in tabular numerals; when the fraction would push the count onto a second line the whole percentage takes its place (`58%`, or `<1%` once the first files are checked), and when the fraction fits the count is a quiet button under a dotted underline that switches between the two and persists the choice as `blackbox:index-count`. The tooltip and progress accessibility text always carry the full fraction. Long idle counts ellipsize independently so the following activity/error dot stays visible, with the full value in the tooltip. Fine-pointer desktops use a 36px minimum row that reserves two lines at the selected text size to prevent scan-state height shifts, with a 36px Rescan button; touch pointers and the mobile drawer keep the 44px minimum row and button.
- **Touch:** In the mobile drawer the selects and each theme button keep 44px minimum targets.

### Theme Control
- **Style:** A two-column Dark/Light segmented fieldset with a 3px inner gap, 2px button padding, and 24px minimum button height inside a 32px control. Its label and control share the selectors' columns and responsive wrapping. Coarse pointers and the mobile drawer enlarge each theme button to at least 44px.
- **State:** `aria-pressed` marks the selected mode; dark selects lime-on-dim-lime and light selects off-white-on-graphite.
- **Persistence:** The explicit saved choice is applied before the app renders; a browser without a saved preference starts dark.

### Reading Width Control
- **Style:** A sidebar-footer select offering Full width and Comfortable, matching the Text size row exactly.
- **Persistence:** The choice is stored under `blackbox:reading-width` and applied to the document before first paint, the same way theme is, so the measure never changes after content appears.

### Filter Menu
- **Style:** A charcoal container-radius panel of about 300px, capped by the space between its trigger and the viewport floor, scrolling internally with contained overscroll.
- **Phone:** A full-width bottom sheet up to 80% of the viewport height, with a visible close button that exists only at that size.
- **Dismissal:** Escape or an outside pointer-down closes it and returns focus to the Filters trigger.
- **Subagents:** A single Subagents only checkbox is the menu's only subagent choice; plain visibility belongs to the Show subagents switch beside the trigger, and the Including subagents chip reports it.
- **Replay count:** The replay Filters badge counts only narrowing the active tab does not already show. Conversation, Tools, Errors, and All events are views and never light it; Focused replay view choices outside those tabs, search, and the remaining constraints do.

### Usage Bar and Breakdown
- **Bar:** The last line of the list header, under the Recordings caption and directly above the rows, so the breakdown opens where its toggle is: Usage, tokens, estimated cost, and a Breakdown toggle at the right. The whole bar is one button named "Usage and estimated cost" whose `aria-expanded` carries the state; the chevron turns over when open. A small dot beside the label breathes while a refresh is in flight and holds its space when idle, so the line never moves.
- **Breakdown placement:** The expanded breakdown is the recording list's first item, spanning every column and 12px under the bar's rule, so it opens directly beneath its toggle and scrolls away with the rows instead of shrinking the list or scrolling on its own. Opening it returns the list to the top where it appears. It sits on the surface tone inside a one-pixel divider at the 10px container radius, with 16px/18px padding (14px/12px in the split library, 14px on phones).
- **Content:** Scope sentence, the Folders / Model & effort switch, the breakdown sort, token categories, the folder table or model matrix, and the cost caveats. Table headers are never clipped, because nothing scrolls within the breakdown. It stays mounted while collapsed, so its view, sort, focus, and the list's scroll position survive toggles and background refreshes.

### Replay Header
- **Title:** At most two lines; the full title is in Session details. A subagent's title follows its Subagent label.
- **Bookmark:** A persistent icon toggle directly after the title text, outside its two-line clamp, in the same place at every pane width. Its name stays "Bookmark this recording" while `aria-pressed` carries the state; pressed fills the bookmark in the accent on the dim accent surface (graphite on the selected neutral in light mode). It is 36px at rest and 44px on phones, follows the title in the Tab order, shows the new state at once, and sends that explicit state so repeated presses settle on the last one. Neither the actions row nor the Session actions menu carries a Bookmark entry, so it never moves between a button and a menu.
- **Provenance strip:** One 12px line under the title in split and full modes: folder leaf, branch, first to last recorded span, and model, separated by muted dots. Folder and branch use the monospace face with their row icons. The span is a time range within one day ("Oct 12, 2026, 3:02 – 3:42 PM") and a date range across days ("Oct 10 – 12, 2026"). Values truncate in place: the folder first, then the branch, each keeping a few characters, then the span and model. A replay pane under 560px drops the times and the model. Hovering shows the full path, branch, model, and both timestamps; Session details keeps the full values. The overview rail does not repeat the workspace or start date.
- **Usage:** Tokens and estimated cost share the strip's line when they fit and wrap below it otherwise. They are hidden below 900px wide, below 650px tall, and on screens 820px and shorter when the replay pane is 900px or narrower, where they would add a third header line; Session details always carries them.
- **Secondary actions:** Export recording is a bordered button beside Copy resume command when the replay pane is at least 64rem wide, and the first item of the Session actions menu otherwise.

### Replay Event
- **Style:** A bordered transcript card with a monospace header carrying the role, a linked timestamp, and an error flag, or a decision flag ("Permission denied", "Stopped by hook", "Blocked by auto mode", "Not reviewed by auto mode", "Interrupted", "Cancelled") when a decision stopped a tool: the user, a permission rule, a hook, or the auto mode classifier refused it, or it was interrupted or cancelled. Decisions use the caution tone (an amber `#e0b86b` on the charcoal, the light warning brown in light mode) on the flag, the card border, and the outline dot, so a stopped tool never reads as a failure in Danger Rose. The first known directory on each visible page is shown, followed by directory changes rather than repeated identical paths. Filtering or paging establishes the visible context again; exact per-event provenance remains in Raw event.
- **Raw records:** The disclosure stays keyboard accessible with muted metadata emphasis and a 44px minimum hit area on phones. Expanded records retain their original data and copy controls.
- **JSON payloads:** Complete JSON objects and arrays in raw records, type records, and pretty-printed tool input are syntax highlighted with six muted token colors per theme (key, string, number, boolean, null, punctuation), each at or above 4.5:1 against the code panel. Incomplete or invalid JSON stays plain, and search marks keep their background behind token colors.
- **Terminal output:** Recorded text keeps the escape sequences the terminal received. Monospace panels (tool output, read files, reasoning, raw records) render SGR styling as bold, dim, italic, underline, strikethrough, inverse video, and foreground or background color, with the 16 named colors drawn from a muted per-theme palette that keeps at least 4.5:1 against the code panel and 256-color and 24-bit colors shown as recorded; every other sequence and control character is dropped rather than drawn as a box, and Copy yields the clean text. Prose, titles, and search snippets drop the styling altogether; Raw event keeps the original codes as escaped JSON.
- **Tool summaries:** A call's command, path, or query runs the full width of its summary row and ellipsizes only where the row actually ends, so wider windows reveal more of it; the complete preview is on hover, while the button's accessible name keeps a short version of it. Paths give up their directory before their file name, keeping one ellipsis character to show the directory is shortened. Between the preview and the disclosure glyph, every row whose call has a command, path, query, or pattern carries a 32px tiny icon button named for what it copies ("Copy path") and described by the full preview. It copies the recorded value whole and clean, with escape sequences dropped and the ends trimmed, without opening the call; for 2.4 seconds afterwards the icon turns to a check in the accent, or an alert in Danger Rose when the clipboard refused, and a polite status says "Path copied" or "Copy failed" while the button keeps its name. A press anywhere on the row outside its buttons, the glyph included, still opens the call. On coarse pointers and phones the row is at least 44px tall and the button's hit area grows to 44px while the icon keeps its size.
- **Role label:** Recorded roles are capitalized; a tool-result event reads "Tool result" in sentence case rather than being forced into the capitalized role pattern.
- **Tool results:** Conversation and Tools fold a tool result into its call's card when both are on the page and Only matching is off, so each tool appears once with its output inside. A result shown on its own, as in Errors or when its call is on another page, carries its call's summary row (status, tool name, and command, path, or query, built exactly like the call card's but not a button, with the same copy button) above the recorded output, so a failure reads with the command that failed. The status glyph is "✓" for a result, "!" in Danger Rose for a failure, "→" while a result is pending, and "⊘" in the caution tone for a tool that was stopped, with the accessible name saying which ("Tool denied", "Tool blocked", "Tool denied by auto mode", "Tool not reviewed by auto mode", "Tool interrupted", "Tool cancelled"); the result panel is then headed by the decision rather than "Tool error".
- **Counts:** With no find term, the find row states one record count in the same records as the footer's range: "15 records" for the whole recording, "12 of 15 records" when the active view or filters narrow it. A tool result folded into its call still counts as a record, and the count's accessible name and tooltip say so when cards and records differ. It shows an em dash until a total is actually known.
- **Find stepping:** A find term highlights without narrowing. While a term is present, the record count gives way to a match status ("4 matches", then "2 of 4" once stepping starts, "No matches" when none, "Matches unavailable" when the list cannot be fetched, which the next step retries while highlighting carries on) counted in records, not occurrences, across the whole recording under the active view and filters, in tabular numerals and as a polite status for screen readers. Enter and Shift+Enter, or the up and down arrow buttons, step to the next and previous matching record and wrap at the ends. The first step starts from the card at the top of the transcript, so the reader keeps their place. Each step seats the matching card's header under the replay tabs, turning pages when needed, and marks it with the selected-card outline. In Conversation and Tools a match in a tool's output selects the call's card that shows it, and a step skips matches on the card already selected unless no other card holds one; then the selection stays and the position still advances. Focus stays in the find box. **Only matching** is an explicit checkbox after the arrows, separated by a one-pixel divider; it narrows the replay as a filter, counts toward the Filters badge, and persists as `replayOnly=1`. When the row runs short of room, only that checkbox drops to a second line, sharing its bottom edge with Filters while the tabs keep their underline on the divider. Phones give the arrows and checkbox 44px targets.

### Overview Rail
- **Reach:** The rail beside the transcript appears when the replay pane is at least 1100px wide and Hide overview is off; narrower panes and phones go without it, and its summaries are only fetched while it shows.
- **Views:** At a glance and its three whole-recording counts stay fixed. Below the divider, a full-width native select (32px, support size, 44px on coarse pointers) chooses what follows: **Event outline · N**, the outline of the loaded page and the default, **Prompts · N**, **Files changed · N**, or **Commands run · N**. The outline count is the number of entries shown, at most 24; the other counts cover prompts, distinct files, or distinct commands across the recording. The choice persists as `blackbox:overview-view`, retaining `page` for Event outline.
- **Page scope:** Event outline uses the same muted scope line as the whole-recording summaries: "Current page · records 61–120", matching the loaded record range in the footer under the active replay filters. A record range stays accurate when find, timeline, or summary jumps start a page between regular page boundaries. A single record reads "Current page · record 1" and an empty page reads "Current page · 0 records"; before the first page loads, omit the count and show only "Current page". Paging and filtering update the range and entry count together without changing the whole-recording statistics above.
- **Prompts:** What was typed across the whole recording, in order, one row per prompt: a muted meta line with the ordinal in tabular numerals, the clock time (the day joins it, "Jan 6 · 9:12 AM", when a prompt falls on a later day than the one before), then the first 180 characters of the prompt clamped to three lines in the support size. Slash commands read as `/name args` and `!` shell commands as `! command`, both in the monospace face. Attached IDE context and system reminders are removed from a prompt's own words; a tool result, a local command's or shell command's output, a hook's output, an interruption marker, or attached context alone is not a prompt. Failures and stopped tools recorded after a prompt and before the next one count on its meta line as "1 error" in Danger Rose and "1 stopped" in the caution tone, the same words Files changed uses. A row opens its record as a file change does, marks itself selected while that record is, and names its kind and ordinal to assistive technology ("Shell command 4, Jan 5, 9:14 AM: ! bun test. Show it."). Very long recordings list the first 500 prompts and say so; a closing note states the coverage.
- **Files changed:** Files changed by Edit, Write, MultiEdit, and NotebookEdit calls across the whole recording, grouped under the folders it worked in: each working directory its records name, and each directory a recorded `/add-dir` output says was **Added**. Outcomes such as "already added" or "inside the current working directory" never become folders. Folders run in recording order with a monospace leaf name, full path on hover, and a provenance line of quiet buttons ("Working directory", "Added with /add-dir · 1:26 AM") that open the record behind them. A file joins the deepest folder holding it and shows its relative path, file name first in monospace with the directory muted beneath, the change count in tabular numerals, and errored changes as "1 error" in Danger Rose, with changes a decision stopped, whether refused, interrupted, or cancelled, counted apart as "1 stopped" in the caution tone; each listed change names its decision ("permission denied", "cancelled"). Files outside every folder sit under Other locations with their full paths. A folder without changes says "No changes here"; a recording without any says "No file changes recorded." and still names its folders.
- **Opening changes:** A file opens its first change; files with several changes add a chevron disclosure named for the file ("Changes to app.ts") listing each one by tool and time. Opening works like find stepping: in place on the current page, otherwise on the page that holds the record, seated under the tabs with the selected-card outline, and the rail marks the selected row until a record is opened another way. A record the active view or filters hide opens in All events with its context, which every entry's name and tooltip say beforehand, provenance buttons included.
- **Reads, coverage, and limits:** Files read but never changed sit in a closed "Read, not changed · N" disclosure after the folders. A closing note states the coverage: shell commands and subagent recordings are not included. Very long recordings shorten the lists (50 folders, 500 files each, 100 listed changes per file) and say so, while each file's count and errors still cover every change. Folders that share a last segment add parent segments until their names differ.
- **Commands run:** The Bash and PowerShell sibling of Files changed. Shell commands are deduplicated by their recorded text whichever shell ran them. Only an unambiguous single program gets a program group; executable paths and Windows executable suffixes normalize to its name. Inline Bash environment assignments can precede that program, but assignment-only calls, chains (including `cd … && …`), pipelines, multiline scripts, interpreter wrappers, substitutions, and ambiguous input go into **Other commands**. Quoted literal operators and ordinary redirects do not create chains. Programs beyond the group limit also join Other, and its explanatory copy covers both reasons. The classifier never executes or expands recorded content. A scope line reads "Whole recording · 41 runs of 18 commands".
- **Command categories and previews:** Common single-program groups remain visible. **Language & build tools**, **Network**, **Other commands**, and **Searches** start collapsed, with call counts and errors/stops visible beneath their labels. Within each category, programs run most sit first, each with the terminal icon, the program in monospace, and a tally line ("12 runs · 2 errors · 1 stopped"); within a group the command run latest sits first. A row preserves the original first non-empty line, capped at 200 characters, with its run count and a muted "+2 lines" for additional non-empty lines. No prefix is moved beneath a guessed executable. The original command, capped at 1000 characters, is on hover; opening a run reveals the recorded call. Rows retain full-input identities even when their previews match after truncation. The 21px gutter carries the last run's glyph from the transcript's set, aria-hidden: "✓" muted, "!" in Danger Rose, "⊘" in the caution tone, and "→" muted for a pending result or background start. Errors and stopped runs are counted as in Files changed.
- **Opening runs:** A row opens the command's last run, since the final attempt answers whether it worked, and its name says the outcome ("bun test, 2 runs, 1 error. Last run succeeded. Show the last run."; "The run was stopped: permission denied."; "The run has no result."; "The run started in the background."). A command run more than once adds a chevron disclosure ("Runs of bun test") listing its latest runs by time with "error", the decision ("permission denied"), "background", or "no result" after a dot, and nothing after a plain success. Opening, selection, and hidden records work as for file changes.
- **Searches:** Grep, Glob, and WebSearch calls sit in a closed **Searches** disclosure after the command categories, with a second-line tally distinguishing unique searches from calls ("2 distinct · 3 calls · 1 error · 1 stopped"). These calls do not affect the shell-command option count. Each tool has a search icon, a tally in calls, and rows showing the pattern or query with the path and glob muted beneath ("src · *.ts"); a search is the same search only when its tool, text, and scope all match.
- **Network:** Recognized HTTP clients keep program groups under Network, alongside WebFetch calls grouped by tool. Fetch rows show the URL with the prompt beneath and deduplicate by URL and prompt. The category distinguishes shell runs from fetch calls; fetches do not inflate the shell-command counts. Outcomes, repeated calls, and replay navigation behave like other command rows.
- **Coverage and limits:** A recording without commands says "No shell commands recorded." The closing note names the tools and the limits of the evidence: a recorded error means the call failed, a successful call is not proof the command succeeded, such as output piped elsewhere or a background run, and subagents' commands are not listed. Very long recordings keep 30 program groups plus Other, 500 commands, 500 searches, 500 fetch entries, and the latest 100 calls per entry. Whole-recording totals count every entry and call. Group tallies count all calls to their listed entries; when the entry cap omits commands, searches, or fetches, the affected tallies are prefixed **Listed:** and an explanation names the omitted scope. A shortened Searches disclosure also states its whole-recording distinct/call totals when opened. A run-list cap or program overflow alone does not make group counts partial.
- **Loading and failure:** Loading shows skeleton rows announced as a status. A refresh that fails keeps the last list beneath "Couldn’t refresh the files for this view." and Retry; a file chosen then opens in All events, since its position under the new view is unknown. Prompts and Commands run load and fail the same way, with "prompts" or "commands" in place of "files". Event outline fetches the summary once for the other options' counts; its own count and scope come from the loaded replay page. Prompts, Files changed, and Commands run refresh with the filters and live updates.

### Toast
- **Style:** One notice at a time, centered 25px above the viewport floor and sized to its message up to 90% of the viewport width, so a short message never wraps on a phone. Dark mode uses the lime-tinted green surface and light mode the off-white surface with the strong divider. A failure uses Danger Rose tones and the alert icon instead of the check.
- **Action:** A notice can carry one action button after its message: bordered, accent text at the support size, 28px tall and 44px on phones, absorbed into the toast's padding so the toast keeps its height.
- **Timing:** A plain notice stays 4.2 seconds; a notice with an action, or a failure in Danger Rose, stays 10 seconds. Hovering it, or keyboard focus inside it, holds it open, and the full time starts again once both leave. A newer notice replaces the current one, including its action.
- **Announcement:** A polite status region beside the toast announces each new notice and names its action ("Ungrouped Orbit. Undo is available."). It stays quiet when the toast moves between hosts.
- **Modal hosting:** While the grouping dialog is open the toast renders inside it, because a modal dialog makes the rest of the page inert. On phones the dialog adds bottom padding while a toast shows, so its footer can scroll clear of it. The toast is not a transient surface under the Single Dismissal Rule; it takes no Escape and leaves on its own.
- **Ungroup and Undo:** Ungroup acts at once and shows "Ungrouped Orbit" with Undo. Focus moves to Undo because the Ungroup button leaves with its row; Undo never takes focus from a control that still exists. Groups ungrouped while that notice shows join it ("Ungrouped Orbit and Atlas", then "Ungrouped 3 groups"), so a second click on the row that slid under the pointer is undone with the first. Undo re-creates each group with its original id, name, and folders through the dialog's own save request, restores the workspace selection the ungroup cleared unless another has been chosen since, reports "Restored Orbit", and returns focus to the restored group's Ungroup button, or to the Group action once the dialog has closed. A group that cannot be restored, because a folder has joined another group meanwhile, is named in an error notice with the reason. A group ungrouped while an Undo is still restoring starts its own notice instead of joining that one, and the finished restore leaves the newer notice and its Undo in place without reporting over it.

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
