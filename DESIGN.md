---
name: claude-blackbox
description: A dense, local-first session recorder with preserved charcoal-and-lime dark mode and a muted grayscale light mode.
colors:
  dark-bg: "#101214"
  dark-surface: "#171a1c"
  dark-raised: "#1d2123"
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
    fontSize: "clamp(28px, 2.8vw, 40px)"
    fontWeight: 530
    lineHeight: 1.2
    letterSpacing: "-1.5px"
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
spacing:
  control: "6px"
  compact: "8px"
  field: "10px 12px"
  sidebar: "27px 15px 0"
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
---

# Design System: claude-blackbox

## Overview

**Creative North Star: "The Local Flight Recorder"**

claude-blackbox is a dense, practical recorder UI: structured panes, quiet dividers, compact controls, and a single unmistakable dark accent make long session histories legible without turning the workspace into a dashboard spectacle. The default dark appearance is the incumbent system and remains unchanged.

The approved light mode is a durable alternate palette, not a redesign. It retains the same type, spacing, icon strokes, hierarchy, and responsive behavior while replacing the charcoal surfaces with muted off-white and gray; semantic green and red remain reserved for meaningful status and diff states.

**Key Characteristics:**
- Compact, pane-based recorder layout.
- Charcoal-and-lime default with an explicit grayscale light alternate.
- System sans for UI, monospace for paths and code.

## Colors

Dark mode is the default surface system; lime is its active accent. Light mode is intentionally mostly grayscale, using graphite for active controls rather than importing the dark lime into ordinary selection states.

### Primary
- **Recorder Lime:** Dark-mode links, selected controls, focus, and key status emphasis.
- **Graphite Active:** Light-mode selected controls and the theme switch's active light state.

### Secondary
- **Danger Rose:** Errors and removed diff content in both modes.

### Neutral
- **Charcoal Stack:** The dark canvas, panels, raised controls, dividers, primary text, and muted metadata.
- **Off-White Stack:** The light canvas, panels, raised/inset surfaces, gray dividers, graphite text, and selected neutral fill.

### Named Rules
**The Preserved Dark Rule.** Dark mode is the baseline visual system; alternate-theme work must not alter its tokens or appearance.

**The Restrained Light Rule.** In light mode, ordinary navigation and controls stay grayscale; green and red communicate semantic status rather than decoration.

## Typography

**Display Font:** Segoe UI Variable with Segoe UI and system-sans fallbacks.
**Body Font:** Segoe UI Variable with Segoe UI and system-sans fallbacks.
**Label/Mono Font:** Cascadia Code with SFMono-Regular and Consolas fallbacks.

Replay preserves its separate Inter/system-sans stack for transcript prose and platform monospace stack for tool output. These are font-family declarations, not bundled font assets.

Replay prose wraps across the full event width by default; a Reading width control offers an opt-in Comfortable measure of about 80 characters for paragraphs, lists, blockquotes, and headings, while code, diffs, tables, and tool cards keep the full width in both modes. Source soft newlines do not force visual breaks; paragraphs, intentional hard breaks, and code formatting remain intact.

**Character:** The interface uses a compact, high-legibility system sans with a modest hierarchy rather than a separate display face. Monospace is reserved for code, keyboard material, and technical content.

### Hierarchy
- **Display:** Variable weight 530, responsive 28–40px, 1.2 line-height, tight tracking; library headings.
- **Body:** 14px, 1.5 line-height; default controls and interface copy.
- **Support:** 13px; descriptions and compact option labels.
- **Meta:** 12px; timestamps, labels, and low-priority navigation metadata.
- **Code:** 14px monospace; code and technical values.
- **Replay prose:** 15px, 1.65 line-height; transcript content, independently increased by the larger-text preference.

### Named Rules
**The Shared Scale Rule.** Theme choice changes color only; it never changes the established type ramp or the larger-text preference.

## Layout

The desktop shell is a 226px sidebar beside a fluid main pane, with a 68px top bar and 38px horizontal library padding. At widths up to 1050px the sidebar narrows to 190px; at 680px and below it becomes a 250px off-canvas drawer while the main shell stays full width. The footer stacks Theme, Text size, and Reading width so appearance and reading comfort remain together; the two selectors put their label beside the control, and move it above the control below 1051px so the selected value stays readable in the narrow rail.

**The Stable Frame Rule.** Theme changes recolor existing surfaces; they do not move navigation, library, replay, or top-bar structure.

## Elevation & Depth

The system is primarily flat, using borders and tonal separation to establish panes. Dark mode uses restrained translucent black and lime glows for dialogs, toasts, and active brand details; light mode removes decorative brand shadowing and uses a soft neutral shadow only where overlay depth is required.

## Shapes

Controls are compact rounded rectangles: 4px inner button corners, 7px fields and segmented-control trays, 8px brand marks, and 10px container cards. Thin one-pixel dividers articulate structure more often than shadows.

## Components

### Buttons
- **Shape:** Theme options use 4px corners; primary, secondary, and icon buttons retain their existing 6px corners and system type ramp.
- **Hover / Focus:** Hover changes foreground or raised surface; keyboard focus uses the active theme's accent with a 2px outline.
- **Disabled:** Reduced opacity communicates unavailable actions.

### Inputs / Fields
- **Style:** One-pixel divider stroke, field corner, and compact field padding.
- **Focus:** Fields keep the global focus treatment with no separate visual language per theme.

### Navigation
- **Style:** Narrow sidebar, muted section metadata, and selected-item emphasis through the active palette.
- **Mobile:** Navigation becomes the same 250px drawer at the mobile breakpoint; Theme remains in its footer.

### Theme Control
- **Style:** A two-column Dark/Light segmented fieldset with a 3px inner gap and 36px minimum button height.
- **State:** `aria-pressed` marks the selected mode; dark selects lime-on-dim-lime and light selects off-white-on-graphite.
- **Persistence:** The explicit saved choice is applied before the app renders; a browser without a saved preference starts dark.

## Do's and Don'ts

### Do:
- **Do** preserve the dark token set when extending light mode or theme controls.
- **Do** use the grayscale light stack for standard light surfaces, borders, and selection.
- **Do** keep Theme with the sidebar's reading controls and retain it in the mobile drawer.
- **Do** apply the saved explicit preference before application rendering and update browser chrome to match.

### Don't:
- **Don't** infer theme from system appearance; default to dark until the user explicitly selects Light.
- **Don't** use lime as general light-mode decoration or replace meaningful success/error colors with neutral styling.
- **Don't** change typography, spacing, or responsive structure merely to support a palette switch.
