---
name: design-token-extraction
description: Extract design tokens and computed styles from live web pages using Claude in Chrome (/chrome). Provides batched extraction scripts that avoid MCP output truncation, structured diff workflows against existing reference files, and mode-aware (light/dark) extraction. Use when inspecting competitor UIs, updating style reference files, or auditing design token changes on authenticated pages.
---

# Design Token Extraction via /chrome

Structured workflow for extracting CSS custom properties and computed styles from live authenticated pages using Claude in Chrome. Optimized to avoid MCP tool output truncation and produce reference-file-ready output.

## When to Use

- Updating an existing styles reference file
- Extracting design tokens from a competitor's authenticated UI
- Auditing design token changes after a site update
- Comparing light/dark mode token values

## Key Constraint: MCP Output Truncation

The `/chrome` JavaScript tool truncates output at ~1500 characters. **All extraction scripts in this skill are sized to stay under that limit** (~15-20 properties per batch). Never request more than 20 CSS custom properties in a single JS call.

---

## Phase 1: Setup & Discovery

### Step 1: Get Tab Context

```
mcp__claude-in-chrome__tabs_context_mcp (createIfEmpty: true)
```

### Step 2: Navigate to Target Page

```
mcp__claude-in-chrome__navigate (url: "https://target-site.com", tabId: <id>)
mcp__claude-in-chrome__computer (action: "wait", duration: 3, tabId: <id>)
```

### Step 3: Detect Current Color Mode

```javascript
// Run via mcp__claude-in-chrome__javascript_tool
JSON.stringify({
  colorScheme: getComputedStyle(document.documentElement).colorScheme,
  darkClass: document.documentElement.classList.contains('dark'),
  dataTheme: document.documentElement.getAttribute('data-theme'),
  prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
});
```

### Step 4: Discover Key Elements

Adapt selectors to the target site. Example for a composer-style interface:

```javascript
// Discover composer elements and their selectors
const elements = {
  threadBottom: !!document.querySelector('#thread-bottom-container'),
  composerSurface: !!document.querySelector('[data-composer-surface="true"]'),
  textarea: !!document.querySelector('#prompt-textarea'),
  submitButton: !!document.querySelector('[data-testid="send-button"]'),
};
// Also get the composer surface's full className for utility class analysis
const cs = document.querySelector('[data-composer-surface="true"]');
elements.composerClass = cs ? cs.className : 'not found';
JSON.stringify(elements, null, 2);
```

---

## Phase 2: Batched Token Extraction

### Strategy

Extract CSS custom properties in **category-sized batches of 15-20 properties**. Each batch returns a flat JSON object. Run batches in **parallel** when they have no dependencies.

### Batch Templates

Below are copy-paste-ready extraction scripts. Each stays under the truncation limit.

#### Batch A: Surface & Background Tokens

```javascript
const cs = getComputedStyle(document.documentElement);
const p = [
  '--main-surface-background', '--main-surface-primary', '--main-surface-primary-inverse',
  '--main-surface-secondary', '--main-surface-secondary-selected', '--main-surface-tertiary',
  '--bg-primary', '--bg-primary-inverted', '--bg-secondary', '--bg-tertiary',
  '--bg-scrim', '--bg-elevated-primary', '--bg-elevated-secondary', '--bg-accent-static',
];
const r = {}; p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
JSON.stringify(r, null, 2);
```

#### Batch B: Border & Edge Tokens

```javascript
const cs = getComputedStyle(document.documentElement);
const p = [
  '--border-default', '--border-heavy', '--border-light', '--border-xlight',
  '--border-medium', '--border-xheavy', '--border-sharp',
  '--surface-hover', '--scrollbar-color', '--scrollbar-color-hover',
  '--link', '--link-hover',
];
const r = {}; p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
JSON.stringify(r, null, 2);
```

#### Batch C: Text & Icon Tokens

```javascript
const cs = getComputedStyle(document.documentElement);
const p = [
  '--text-primary', '--text-secondary', '--text-tertiary', '--text-inverted',
  '--text-inverted-static', '--text-primary-inverse', '--text-accent',
  '--text-placeholder', '--text-quaternary',
  '--icon-primary', '--icon-secondary', '--icon-tertiary', '--icon-inverted',
  '--icon-inverted-static', '--icon-accent',
];
const r = {}; p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
JSON.stringify(r, null, 2);
```

#### Batch D: Composer & Chat Tokens

```javascript
const cs = getComputedStyle(document.documentElement);
const p = [
  '--message-surface', '--composer-surface', '--composer-surface-primary',
  '--composer-blue-bg', '--composer-blue-hover', '--composer-blue-hover-tint',
  '--dot-color', '--icon-surface', '--content-primary', '--content-secondary',
  '--text-error', '--text-danger', '--surface-error',
  '--tag-blue', '--hint-text', '--hint-bg', '--selection',
];
const r = {}; p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
JSON.stringify(r, null, 2);
```

#### Batch E: Sidebar Tokens

```javascript
const cs = getComputedStyle(document.documentElement);
const p = [
  '--sidebar-surface-primary', '--sidebar-surface-secondary', '--sidebar-surface-tertiary',
  '--sidebar-title-primary', '--sidebar-surface', '--sidebar-body-primary', '--sidebar-icon',
  '--sidebar-surface-floating-lightness', '--sidebar-surface-floating-alpha',
  '--sidebar-surface-pinned-lightness', '--sidebar-surface-pinned-alpha',
  '--sidebar-width', '--sidebar-rail-width',
];
const r = {}; p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
JSON.stringify(r, null, 2);
```

#### Batch F: Interactive BG Primitives

```javascript
const cs = getComputedStyle(document.documentElement);
const p = [
  '--interactive-bg-primary-default', '--interactive-bg-primary-hover',
  '--interactive-bg-primary-press', '--interactive-bg-primary-inactive',
  '--interactive-bg-secondary-default', '--interactive-bg-secondary-hover',
  '--interactive-bg-secondary-press', '--interactive-bg-secondary-inactive',
  '--interactive-bg-secondary-selected',
  '--interactive-bg-tertiary-default', '--interactive-bg-tertiary-hover',
  '--interactive-bg-tertiary-press', '--interactive-bg-tertiary-inactive',
  '--interactive-bg-accent-default', '--interactive-bg-accent-hover',
  '--interactive-bg-accent-press', '--interactive-bg-accent-inactive',
];
const r = {}; p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
JSON.stringify(r, null, 2);
```

#### Batch G: Interactive Border + Accent Muted

```javascript
const cs = getComputedStyle(document.documentElement);
const p = [
  '--interactive-bg-accent-muted-hover', '--interactive-bg-accent-muted-context',
  '--interactive-bg-accent-muted-press',
  '--interactive-bg-danger-primary-default', '--interactive-bg-danger-primary-hover',
  '--interactive-bg-danger-primary-press', '--interactive-bg-danger-primary-inactive',
  '--interactive-border-focus',
  '--interactive-border-secondary-default', '--interactive-border-secondary-hover',
  '--interactive-border-secondary-press', '--interactive-border-secondary-inactive',
  '--interactive-border-tertiary-default', '--interactive-border-tertiary-hover',
  '--interactive-border-tertiary-press', '--interactive-border-tertiary-inactive',
];
const r = {}; p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
JSON.stringify(r, null, 2);
```

#### Batch H: Interactive Labels

```javascript
const cs = getComputedStyle(document.documentElement);
const p = [
  '--interactive-label-primary-default', '--interactive-label-primary-hover',
  '--interactive-label-primary-press', '--interactive-label-primary-inactive',
  '--interactive-label-secondary-default', '--interactive-label-secondary-hover',
  '--interactive-label-secondary-press', '--interactive-label-secondary-inactive',
  '--interactive-label-secondary-selected',
  '--interactive-label-tertiary-default', '--interactive-label-tertiary-hover',
  '--interactive-label-tertiary-press', '--interactive-label-tertiary-inactive',
  '--interactive-label-accent-default', '--interactive-label-accent-hover',
  '--interactive-label-accent-press', '--interactive-label-accent-selected',
];
const r = {}; p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
JSON.stringify(r, null, 2);
```

#### Batch I: Interactive Icons

```javascript
const cs = getComputedStyle(document.documentElement);
const p = [
  '--interactive-icon-primary-default', '--interactive-icon-primary-hover',
  '--interactive-icon-primary-press', '--interactive-icon-primary-inactive',
  '--interactive-icon-secondary-default', '--interactive-icon-secondary-hover',
  '--interactive-icon-secondary-press', '--interactive-icon-secondary-inactive',
  '--interactive-icon-secondary-selected',
  '--interactive-icon-tertiary-default', '--interactive-icon-tertiary-hover',
  '--interactive-icon-tertiary-press', '--interactive-icon-tertiary-inactive',
  '--interactive-icon-accent-default', '--interactive-icon-accent-hover',
  '--interactive-icon-accent-press', '--interactive-icon-accent-selected',
];
const r = {}; p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
JSON.stringify(r, null, 2);
```

#### Batch J: Default + Blue + Green Theme Tokens

```javascript
const cs = getComputedStyle(document.documentElement);
const p = [
  '--default-theme-user-msg-bg', '--default-theme-user-msg-text',
  '--default-theme-submit-btn-bg', '--default-theme-submit-btn-text',
  '--default-theme-secondary-btn-bg', '--default-theme-secondary-btn-text',
  '--default-theme-user-selection-bg', '--default-theme-attribution-highlight-bg',
  '--default-theme-entity-accent', '--formatted-text-highlight-bg',
  '--blue-theme-user-msg-bg', '--blue-theme-submit-btn-bg',
  '--blue-theme-secondary-btn-bg', '--blue-theme-entity-accent',
  '--green-theme-user-msg-bg', '--green-theme-submit-btn-bg',
  '--green-theme-secondary-btn-bg', '--green-theme-entity-accent',
];
const r = {}; p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
JSON.stringify(r, null, 2);
```

#### Batch K: Yellow + Purple + Pink + Orange + Black Theme Tokens

```javascript
const cs = getComputedStyle(document.documentElement);
const p = [
  '--yellow-theme-user-msg-bg', '--yellow-theme-submit-btn-bg',
  '--yellow-theme-secondary-btn-bg', '--yellow-theme-entity-accent',
  '--purple-theme-user-msg-bg', '--purple-theme-submit-btn-bg',
  '--purple-theme-secondary-btn-bg', '--purple-theme-entity-accent',
  '--pink-theme-user-msg-bg', '--pink-theme-submit-btn-bg',
  '--pink-theme-secondary-btn-bg', '--pink-theme-entity-accent',
  '--orange-theme-user-msg-bg', '--orange-theme-submit-btn-bg',
  '--orange-theme-secondary-btn-bg', '--orange-theme-entity-accent',
  '--black-theme-user-msg-bg', '--black-theme-submit-btn-bg',
  '--black-theme-entity-accent',
];
const r = {}; p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
JSON.stringify(r, null, 2);
```

### Parallelization Guide

Run these groups in parallel (each group is one round trip):

| Round | Batches | Properties |
|-------|---------|------------|
| 1 | A + B + C | Surface, borders, text/icons |
| 2 | D + E | Composer, sidebar |
| 3 | F + G | Interactive BG, borders |
| 4 | H + I | Interactive labels, icons |
| 5 | J + K | Theme tokens |

**Total: 5 round trips for ~180 CSS custom properties** (vs. 12+ ad-hoc calls without batching).

---

## Phase 3: Computed Element Styles

Extract computed styles from specific elements. These are separate from CSS custom properties because they're resolved to final pixel/color values.

### Composer Surface Computed Styles

```javascript
const el = document.querySelector('[data-composer-surface="true"]');
if (!el) { 'Composer surface not found'; } else {
  const cs = getComputedStyle(el);
  JSON.stringify({
    backgroundColor: cs.backgroundColor,
    borderRadius: cs.borderRadius,
    borderTopColor: cs.borderTopColor,
    borderTopWidth: cs.borderTopWidth,
    boxShadow: cs.boxShadow,
    padding: cs.padding,
    backgroundClip: cs.backgroundClip,
    display: cs.display,
    gridTemplateColumns: cs.gridTemplateColumns,
    overflow: cs.overflow,
    contain: cs.contain,
    cursor: cs.cursor,
    transitionDuration: cs.transitionDuration,
    transitionTimingFunction: cs.transitionTimingFunction,
  });
}
```

### Textarea Computed Styles

```javascript
const el = document.querySelector('#prompt-textarea');
if (!el) { 'Textarea not found'; } else {
  const cs = getComputedStyle(el);
  JSON.stringify({
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    fontWeight: cs.fontWeight,
    letterSpacing: cs.letterSpacing,
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    padding: cs.padding,
  });
}
```

### Shadow Class Computed Values

```javascript
const el = document.querySelector('.shadow-short');
if (!el) { 'No .shadow-short element found'; } else {
  JSON.stringify({ boxShadow: getComputedStyle(el).boxShadow });
}
```

---

## Phase 4: Mode Toggle & Re-Extract

To extract both light and dark mode values:

### Option A: Toggle via DOM Class

```javascript
// Toggle dark mode
document.documentElement.classList.toggle('dark');
// Verify
getComputedStyle(document.documentElement).colorScheme;
```

After toggling, re-run Phase 2 and Phase 3 batches.

### Option B: Use System Preference Override

```javascript
// Force light mode via media query override (does not work on all sites)
// Some sites read class-based dark mode, not media query
window.matchMedia('(prefers-color-scheme: dark)').matches;
```

### Option C: Manual Toggle via UI

If the site has a theme toggle in the UI, use `/chrome` click tools to toggle it, then re-extract.

### Recommended Workflow

1. Extract current mode (whatever the user has active)
2. Toggle to the other mode
3. Re-extract using the same batches
4. Toggle back to restore the user's preference
5. Diff the two result sets to identify mode-specific values

---

## Phase 5: Diff Against Reference File

When updating an existing reference file, follow this workflow:

### Step 1: Read the Existing Reference

```
Read the reference file from the private reference/research repository, or from a user-provided path.
```

### Step 2: Identify Sections to Update

Scan for:
- `TBD`, `TODO`, `???` markers
- Sections labeled `(LIGHT SNAPSHOT)` without a corresponding `(DARK SNAPSHOT)`
- `var()` references that should be resolved to computed hex values (for dark mode sections)
- Stale dates (compare against current extraction date)

### Step 3: Apply Updates

For each section with new data:

1. **Resolved TBDs** -- Replace placeholder comments with confirmed values
2. **New dark mode sections** -- Add `(DARK SNAPSHOT)` sections after existing `(LIGHT SNAPSHOT)` sections
3. **Computed element styles** -- Update with fresh confirmed values
4. **Add extraction date** -- Mark sections with `Confirmed via Chrome DevTools, YYYY-MM-DD`

### Step 4: Mark Unchanged Values

When a dark mode value is identical to light mode, annotate with `/* unchanged */` to signal intentional same-value:

```css
--text-error: #f93a37;                                /* unchanged */
```

---

## Reference File Format

When creating a new reference file, use this section structure:

```
# [Site] [Component] - Styles Reference

## Sections (in order):
1. FOUNDATIONS              — spacing, breakpoints, containers
2. TYPOGRAPHY SCALE         — font sizes, weights, tracking, leading
3. SHAPE, SHADOWS, MOTION   — radii, shadows, easing, blur, transitions
4. DEFAULT FONTS            — font stacks
5. SEMANTIC TYPOGRAPHY      — heading/body/caption token families
6. INTERACTIVE STATE ALIASES — convenience mappings
7. TOUCH & FOCUS            — tap targets, focus outlines
8. COLOR PALETTES (ABRIDGED) — raw palette values (mode-independent)
9. GLOBAL DOCUMENT STYLES   — html/body base styles
10. COMPOSER & CHAT TOKENS (LIGHT) — component-specific semantic tokens
11. COMPOSER & CHAT TOKENS (DARK)
12. CHAT THEME TOKENS (LIGHT)      — per-color-theme token sets
13. CHAT THEME TOKENS (DARK)
14. LAYOUT DIRECTION + DIMENSIONS  — sidebar, header, chat width
15. SURFACE/BG/BORDER/TEXT/ICON (LIGHT)
16. SURFACE/BG/BORDER/TEXT/ICON (DARK)
17. INTERACTIVE STATE PRIMITIVES (LIGHT)
18. INTERACTIVE STATE PRIMITIVES (DARK)
19. PROMPT LAYOUT + STICKY METRICS — container queries, masks
20. SPRING / EASING SYSTEM         — spring linear() approximations
21. UTILITY & MISC
22. COMPUTED ELEMENT STYLES         — per-element resolved values
```

Mark prompt-input-critical sections with `★` in comment headers.

---

## Troubleshooting

### Output Truncated Mid-JSON

The MCP tool cut off the response. Split the batch in half and re-run as two separate calls. The batch templates above are pre-sized to avoid this, but custom queries may exceed the limit.

### CSS Custom Property Returns Empty String

The property either:
- Doesn't exist on this site
- Is set on a descendant element, not `:root`
- Is behind a media query or container query

Try extracting from the specific element instead:
```javascript
const el = document.querySelector('.target-element');
getComputedStyle(el).getPropertyValue('--custom-prop').trim();
```

### `var()` References in Dark Mode

Dark mode sections should contain **resolved hex values**, not `var()` references. The `getComputedStyle().getPropertyValue()` method resolves `var()` automatically, so extracted values should already be resolved. If you see `var()` in extracted output, the property is being read from the stylesheet, not computed styles.

### Page Layout Changed After Toggle

Some sites re-render or navigate when toggling dark mode. If elements disappear after toggle, wait 2-3 seconds and re-discover elements (Phase 1, Step 4).

### Site Uses CSS-in-JS / No Custom Properties

If the site doesn't use CSS custom properties, fall back to extracting computed styles directly from elements (Phase 3 approach). Create the reference file using element-based sections instead of token-based sections.

---

## Relationship to chrome-devtools-mcp Skill

This skill focuses specifically on **structured token extraction and reference file maintenance** using `/chrome` (Claude in Chrome). The `chrome-devtools-mcp` skill covers the broader set of browser inspection capabilities including performance profiling, network throttling, and multi-tab management.

| Capability | This Skill | chrome-devtools-mcp |
|------------|:---:|:---:|
| Batched CSS token extraction | **Yes** | Generic scripts only |
| Reference file diffing workflow | **Yes** | No |
| MCP truncation-safe batches | **Yes** | No |
| Light/dark mode toggle workflow | **Yes** | Via `emulate()` |
| Signed-in page access | **Yes** | No (OAuth blocked) |
| Performance profiling | No | **Yes** |
| Network throttling | No | **Yes** |
