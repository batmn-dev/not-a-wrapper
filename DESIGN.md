---
version: alpha
name: Not a Wrapper
description: A minimal visual reference for the not-a-wrapper project.

colors:
  background: "var(--background)"
  foreground: "var(--foreground)"
  muted: "var(--muted-foreground)"
  border: "var(--border)"
  surface: "var(--muted)"
  accent: "var(--accent)"
  primary: "var(--primary)"
  error: "var(--destructive)"

typography:
  heading:
    fontFamily: "Geist, var(--font-geist-sans), system-ui, sans-serif"
    fontSize: 30px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -0.025em
  body:
    fontFamily: "Geist, var(--font-geist-sans), system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, var(--font-geist-sans), system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
  mono:
    fontFamily: "Geist Mono, var(--font-geist-mono), monospace"

spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px

rounded:
  sm: "var(--radius-sm)"
  md: "var(--radius-md)"
  lg: "var(--radius-lg)"
  xl: "var(--radius-xl)"
  full: 9999px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "var(--primary-foreground)"
    rounded: "{rounded.full}"
    height: 36px
    padding: 8px 12px
  card:
    backgroundColor: "var(--card)"
    textColor: "var(--card-foreground)"
    shadow: "var(--shadow-border-md)"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  input:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
    shadow: "var(--shadow-border)"
    rounded: "{rounded.md}"
    padding: 10px 12px
  composer:
    backgroundColor: "var(--composer-bg)"
    shadow: "shadow-composer"
    rounded: 24px
  popover:
    backgroundColor: "var(--popover)"
    textColor: "var(--popover-foreground)"
    shadow: "var(--shadow-border-md)"
    rounded: "{rounded.xl}"
---

# DESIGN.md

## Overview

Minimal, direct, neutral, and focused.

Prioritize readable chat workflows, compact controls, and existing primitives over decoration or novelty.

## Foundations

- Next.js, Tailwind CSS v4, and CSS variables in `app/globals.css`.
- Shared primitives live in `components/ui` and are adapted around Base UI.
- Theme tokens use OKLCH CSS variables through `next-themes`.
- Remix Icons are primary. Prefer `components/ui/icon.tsx` with `slotSize`.
- Reuse `cn()` and local UI primitives before adding new patterns.

## Colors

Use a restrained neutral palette.

- **Background:** Main app and page background.
- **Foreground:** Primary text and high-emphasis UI.
- **Muted:** Secondary text, helper text, and metadata.
- **Border:** Dividers, outlines, and edges.
- **Surface:** Muted, card, popover, sidebar, and accent surfaces.
- **Accent:** Hover, active, and selected UI states.
- **Primary:** Main actions.
- **Error:** Destructive actions, validation errors, and warnings.

Avoid new colors unless the existing tokens cannot express the required state.

## Typography

Use Geist Sans for UI and Geist Mono for code.

- **Heading:** Page titles, section headers, and major chat moments.
- **Body:** Reading text and interface copy, usually `text-sm` or `text-base`.
- **Label:** Buttons, form labels, nav items, and metadata.

Avoid using more than two font weights in a single view.

## Layout

Use a compact Tailwind spacing rhythm. The app shell uses `h-svh`, `--spacing-app-header`, `ScrollRoot`, and a flex chat layout. Chat content centers around `40rem`, expanding to `48rem` on larger containers.

Default rhythm:

- Small gaps: `4px-8px`
- Standard gaps: `16px`
- Section gaps: `24px-40px`

Prefer stacks, compact grids, constrained widths, and clear sections.

## Elevation & Depth

Keep depth minimal. Prefer borders, spacing, background contrast, and `shadow-border-*` over heavy shadows. Use stronger shadows mainly for floating UI.

## Shapes

Use subtle rounded corners.

- Inputs and utility controls generally use medium radius.
- Cards, popovers, dialogs, and larger surfaces can use larger radius.
- Buttons, icon actions, composer controls, and pills may use full radius.
- The chat composer is a rounded 24px surface using `--composer-bg` and `shadow-composer`.

Do not mix sharp, highly rounded, and ornamental shapes in one view.

## Components

### Buttons

Use `Button` from `components/ui/button`. Primary buttons are for main actions. Secondary actions are quieter: `outline`, `ghost`, text, or icon buttons.

Button labels should be short, specific, and action-oriented.

### Icons

Use Remix icons through `Icon` with `slotSize`. Line icons are the default; filled icons are mainly for active states.

### Navigation

Use the sticky header plus collapsible sidebar pattern. Sidebar rows are compact, rounded, truncated, and use `bg-accent` for hover/active states.

### Cards

Cards should group related content. Use existing card primitives and `shadow-border-*` surfaces. Avoid nested cards unless the hierarchy is clear.

### Inputs

Use existing `Input`, `Textarea`, `Select`, `Field`, and `Label` patterns. Focus uses `focus-visible:ring-*`; invalid states use destructive tokens.

### Chat

User messages are right-aligned accent bubbles. Assistant messages are transparent prose surfaces with hover actions.

### Overlays

Use existing Base UI wrappers for dialogs, drawers, popovers, dropdowns, and tooltips.

### States

Empty states are simple centered copy with muted text. Loading states use `Skeleton`, `Spinner`, `Loader`, `ThinkingBar`, or streaming indicators.

## Do's and Don'ts

Do:

- Reuse existing primitives before creating new components.
- Follow the nearest feature area first.
- Keep UI plain, legible, compact, and intentional.
- Maintain strong contrast for text and interactive elements.
- Update this file only when a stable pattern emerges in code.

Don't:

- Add gradients, decorative shadows, ornamental effects, or new icon systems by default.
- Invent new colors, fonts, shadows, radii, or spacing scales casually.
- Overstyle empty states, loading states, or error states.
- Treat dense tables, illustration, and marketing pages as not established.

## Not Established Yet

- Formal brand or marketing-page visual language.
- Dense data-table/product analytics patterns.
- Complex form validation beyond existing field/input invalid states.
- Illustration usage.
- Broad animation rules beyond existing motion primitives and chat/sidebar transitions.
