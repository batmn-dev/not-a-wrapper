---
name: browser-css-extraction
description: Extract computed CSS styles, Tailwind utility class definitions, and box-shadow/border values from live web pages using Claude in Chrome. Covers viewport/DPI calibration, mode-aware extraction with proper repaint timing, recursive stylesheet traversal for Tailwind utility definitions, and focus/pseudo-element inspection. Use when extracting specific computed styles from a component, finding how a Tailwind utility class is defined, comparing light/dark mode visual treatments, or debugging shadow/border/outline rendering.
---

# Browser CSS Extraction via /chrome

Structured workflow for extracting **computed CSS styles and Tailwind utility class definitions** from specific elements on live pages. Complements `design-token-extraction` (which focuses on CSS custom properties from `:root`) by targeting **element-level computed styles** and **framework utility classes**.

## When to Use

- Extracting `box-shadow`, `border`, `outline`, `background` from a specific UI component
- Finding how a Tailwind utility class (e.g., `shadow-short`, `shadow-lg`) is defined in the stylesheet
- Comparing computed styles between light and dark modes for a specific element
- Inspecting focus, hover, or `:focus-within` state visual changes
- Checking if an element uses pseudo-elements (`::before`, `::after`) for visual effects
- Verifying whether a perceived "border" is actually a CSS border or a box-shadow trick

## Relationship to Other Skills

| Skill | Focus | When to Use Instead |
|-------|-------|-------------------|
| `design-token-extraction` | CSS custom properties from `:root` (batched, 180+ tokens) | Bulk extraction of a site's token system |
| `component-state-extraction` | Style deltas across interactive states (hover, focus, disabled) | Capturing how styles *change* on interaction |
| `animation-transition-extraction` | Keyframes, springs, transition rules | Motion design system |
| **This skill** | **Computed styles from specific elements + Tailwind utility definitions** | **Targeted inspection of one component's visual treatment** |

---

## Phase 0: Viewport Calibration (Required First Step)

The Chrome MCP tools use **CSS pixel coordinates** for click/hover/zoom, but the browser may be on a Retina display where `window.innerWidth` differs from the physical pixel count. **Always calibrate first.**

```javascript
// Run this FIRST in every extraction session
JSON.stringify({
  cssWidth: window.innerWidth,
  cssHeight: window.innerHeight,
  dpr: window.devicePixelRatio,
  // Zoom tool accepts coordinates in CSS pixels up to (cssWidth, cssHeight)
  maxZoomRegion: [0, 0, window.innerWidth, window.innerHeight],
});
```

### Zoom Coordinates

The `zoom` action's `region` parameter takes `[x0, y0, x1, y1]` in **CSS pixels** bounded by `innerWidth x innerHeight`. To zoom into an element:

```javascript
const el = document.querySelector('<selector>');
const r = el.getBoundingClientRect();
const pad = 20;
JSON.stringify({
  zoomRegion: [
    Math.max(0, Math.floor(r.left - pad)),
    Math.max(0, Math.floor(r.top - pad)),
    Math.min(window.innerWidth, Math.ceil(r.right + pad)),
    Math.min(window.innerHeight, Math.ceil(r.bottom + pad)),
  ],
});
```

### Resize Tool

`resize_window` takes **physical pixels**. To target a specific CSS viewport width:

```
Target CSS width = desired / devicePixelRatio is NOT correct.
The resize tool sets the window's outer size. The actual CSS viewport
depends on browser chrome, scrollbars, and DPI settings.

Recommended: resize, then re-read window.innerWidth to confirm.
```

---

## Phase 1: Comprehensive Element Style Extraction

### Template: Full Computed Style Snapshot

Copy-paste ready. Extracts all properties commonly relevant to border/shadow/surface analysis.

```javascript
const el = document.querySelector('<SELECTOR>');
if (!el) { 'Element not found'; } else {
  const cs = window.getComputedStyle(el);
  JSON.stringify({
    // Surface
    backgroundColor: cs.backgroundColor,
    backgroundClip: cs.backgroundClip,
    backdropFilter: cs.backdropFilter,

    // Border
    border: cs.border,
    borderWidth: cs.borderWidth,
    borderStyle: cs.borderStyle,
    borderColor: cs.borderColor,
    borderRadius: cs.borderRadius,

    // Shadow
    boxShadow: cs.boxShadow,

    // Outline
    outline: cs.outline,
    outlineWidth: cs.outlineWidth,
    outlineStyle: cs.outlineStyle,
    outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset,

    // Transitions
    transitionProperty: cs.transitionProperty,
    transitionDuration: cs.transitionDuration,
    transitionTimingFunction: cs.transitionTimingFunction,
  }, null, 2);
}
```

### Template: Pseudo-Element Check

```javascript
const el = document.querySelector('<SELECTOR>');
if (!el) { 'not found'; } else {
  const before = window.getComputedStyle(el, '::before');
  const after = window.getComputedStyle(el, '::after');
  JSON.stringify({
    before: {
      content: before.content,
      display: before.display,
      position: before.position,
      boxShadow: before.boxShadow,
      border: before.border,
      background: before.backgroundColor,
    },
    after: {
      content: after.content,
      display: after.display,
      position: after.position,
      boxShadow: after.boxShadow,
      border: after.border,
      background: after.backgroundColor,
    },
  }, null, 2);
}
```

### Template: Focus State Comparison

Tests whether shadow/border/outline change when the element (or a child) receives focus.

```javascript
const el = document.querySelector('<SELECTOR>');
const focusTarget = el.querySelector('textarea, input, [contenteditable]') || el;
const read = () => {
  const cs = window.getComputedStyle(el);
  return {
    boxShadow: cs.boxShadow,
    border: cs.border,
    outline: cs.outline,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
  };
};

const before = read();
focusTarget.focus();
const after = read();
focusTarget.blur();

// Diff
const delta = {};
for (const [k, v] of Object.entries(before)) {
  if (after[k] !== v) delta[k] = { from: v, to: after[k] };
}
Object.keys(delta).length === 0
  ? '"No focus state changes"'
  : JSON.stringify(delta, null, 2);
```

### Template: Parent/Container Shadow Check

Sometimes shadows come from parent or container elements, not the target itself.

```javascript
const el = document.querySelector('<SELECTOR>');
if (!el) { 'not found'; } else {
  const chain = [];
  let node = el;
  for (let i = 0; i < 5 && node; i++) {
    const cs = window.getComputedStyle(node);
    const shadow = cs.boxShadow;
    if (shadow && shadow !== 'none') {
      chain.push({
        tag: node.tagName + (node.id ? '#' + node.id : ''),
        boxShadow: shadow,
      });
    }
    node = node.parentElement;
  }
  chain.length === 0
    ? '"No shadows in ancestor chain"'
    : JSON.stringify(chain, null, 2);
}
```

---

## Phase 2: Tailwind Utility Class Definition Lookup

When an element uses a class like `shadow-short` or `shadow-lg`, you need to find how it's defined in the compiled CSS. Tailwind 4 nests utility definitions inside `@layer utilities { ... }`, so a flat `cssRules` iteration misses them. **Always use recursive traversal.**

### Template: Find Utility Class Definition

```javascript
// Replace 'shadow-short' with the target class name
const TARGET = 'shadow-short';
const results = [];
const findRules = (ruleList) => {
  for (const rule of ruleList) {
    if (rule.cssRules) findRules(rule.cssRules); // recurse into @layer, @media, etc.
    if (rule.selectorText && rule.selectorText.includes(TARGET)) {
      results.push({
        selector: rule.selectorText,
        css: rule.cssText.substring(0, 400),
      });
    }
  }
};
for (const sheet of document.styleSheets) {
  try { findRules(sheet.cssRules); } catch (e) { /* cross-origin */ }
}
results.length === 0
  ? '"Class not found in any stylesheet"'
  : JSON.stringify(results, null, 2);
```

### Why Recursive Traversal Is Required

Tailwind 4 compiles utilities inside `@layer` blocks:

```css
@layer utilities {
  .shadow-short { --tw-shadow: ...; box-shadow: ...; }
  .shadow-short:where(.dark, .dark *) { --tw-shadow: ...; }
}
```

A `CSSLayerBlockRule` has `.cssRules` containing the actual utility definitions. A flat iteration only sees the `@layer` envelope, not its children. The recursive `findRules` pattern handles:

- `@layer utilities { ... }` — Tailwind 4 utility layer
- `@layer base { ... }` — base styles
- `@media (min-width: ...) { ... }` — responsive variants
- `@container (...) { ... }` — container queries
- `@supports (...) { ... }` — feature queries

### Extracting Mode-Aware Variants

Tailwind 4 dark mode variants use `:where(.dark, .dark *)` selectors:

```css
.shadow-short { /* light mode values */ }
.shadow-short:where(.dark, .dark *):not(:where(.dark .light, .dark .light *)) { /* dark mode values */ }
```

Both rules will be found by the recursive search. Filter results by checking whether `selector` includes `dark`:

```javascript
const lightRules = results.filter(r => !r.selector.includes('dark'));
const darkRules = results.filter(r => r.selector.includes('dark'));
```

---

## Phase 3: Light/Dark Mode Extraction

### Critical Gotcha: Toggle Timing

When switching modes via class manipulation, **CSS custom properties and computed styles need a repaint cycle to update**. If you toggle and read in the same JS execution, you may get stale values.

**Wrong** (reads stale values):
```javascript
// DO NOT DO THIS
document.documentElement.classList.remove('dark');
document.documentElement.classList.add('light');
const cs = getComputedStyle(el); // MAY RETURN DARK MODE VALUES
```

**Right** (separate tool calls):
```
// Call 1: Switch to light mode
mcp__claude-in-chrome__javascript_tool:
  document.documentElement.classList.remove('dark');
  document.documentElement.classList.add('light');
  'Switched to light mode';

// Call 2: Extract (separate MCP call = guaranteed repaint)
mcp__claude-in-chrome__javascript_tool:
  const el = document.querySelector('<SELECTOR>');
  const cs = getComputedStyle(el);
  JSON.stringify({ backgroundColor: cs.backgroundColor, boxShadow: cs.boxShadow });
```

Each MCP tool call is a separate browser round-trip, which forces a style recalculation between calls. **Never toggle mode and extract in the same JS call.**

### Recommended Workflow

1. **Detect current mode** (1 call)
2. **Extract current mode values** (1 call)
3. **Toggle to other mode** (1 call — toggle only, no extraction)
4. **Extract other mode values** (1 call)
5. **Restore original mode** (1 call)

Total: 5 calls for both modes. Resist the temptation to combine steps 3+4.

### Mode Toggle Methods

```javascript
// Class-based theme toggle
document.documentElement.classList.toggle('dark');
document.documentElement.classList.toggle('light');

// Generic (check which applies)
// Method A: class-based
document.documentElement.classList.add('dark');

// Method B: attribute-based
document.documentElement.setAttribute('data-theme', 'dark');

// Method C: media query (can't toggle from JS — use chrome emulate tool)
// mcp__claude-in-chrome__ doesn't have emulate; use chrome-devtools-mcp instead
```

---

## Phase 4: Viewport Responsiveness Check

Test whether styles change at different viewport widths.

### Quick Check (No Resize Needed)

If the element uses standard `@media` breakpoints, check which breakpoint classes are active:

```javascript
JSON.stringify({
  viewport: window.innerWidth + 'x' + window.innerHeight,
  sm: window.matchMedia('(min-width: 640px)').matches,
  md: window.matchMedia('(min-width: 768px)').matches,
  lg: window.matchMedia('(min-width: 1024px)').matches,
  xl: window.matchMedia('(min-width: 1280px)').matches,
});
```

### Resize and Re-Extract

```
// Step 1: Resize (physical pixels — divide target by DPR for Retina)
mcp__claude-in-chrome__resize_window (width: 768, height: 1024, tabId: <id>)

// Step 2: Verify actual CSS viewport
mcp__claude-in-chrome__javascript_tool:
  window.innerWidth + 'x' + window.innerHeight

// Step 3: Extract styles at this width
// (use Phase 1 template)

// Step 4: Restore original size
mcp__claude-in-chrome__resize_window (width: <original>, height: <original>, tabId: <id>)
```

### Check for Container Queries Affecting Styles

```javascript
// Search for @container rules that target the element or its ancestors
const TARGET_PROPS = ['shadow', 'border', 'background'];
const results = [];
const findRules = (ruleList) => {
  for (const rule of ruleList) {
    if (rule instanceof CSSContainerRule) {
      for (const inner of rule.cssRules) {
        const text = inner.cssText || '';
        if (TARGET_PROPS.some(p => text.includes(p))) {
          results.push({
            container: rule.conditionText,
            rule: text.substring(0, 300),
          });
        }
      }
    }
    if (rule.cssRules) findRules(rule.cssRules);
  }
};
for (const s of document.styleSheets) {
  try { findRules(s.cssRules); } catch (e) {}
}
results.length === 0
  ? '"No container queries affect target properties"'
  : JSON.stringify(results, null, 2);
```

---

## Troubleshooting

### Box-shadow has transparent layers prepended

Tailwind 4 compiles box-shadow as a stack of CSS variable layers:

```css
box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow),
            var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
```

When no ring/inset shadows are set, these resolve to `rgba(0,0,0,0) 0px 0px 0px 0px`. The actual shadow is the **last** value in the computed list. Filter out transparent layers:

```javascript
const raw = cs.boxShadow;
// Split on commas that are NOT inside rgba() or inset values
const layers = raw.split(/,\s*(?=(?:inset\s+)?rgba)/).filter(
  l => !l.includes('rgba(0, 0, 0, 0)')
);
JSON.stringify(layers);
```

### CSS class definition not found

Possible causes:
1. **Class is in a cross-origin stylesheet** (CDN-hosted). The try/catch skips it silently. Check network tab for external CSS files.
2. **Class uses a different naming convention** (responsive prefix: `sm:shadow-short`, state prefix: `hover:shadow-lg`). Search for the base name without prefixes.
3. **Class is generated at runtime** (CSS-in-JS). Check `<style>` tags in `<head>` specifically.

### Computed border-color is set but border-width is 0px

This is common with Tailwind's base reset (`* { border-color: ... }`). The element has no visible border — the `border-color` is just a default. Check `borderWidth` to confirm.

### Mode toggle doesn't change computed styles

The site may use:
1. **Server-side rendering** for theme — class toggle on client won't update CSS variables defined in SSR-generated `<style>` blocks
2. **Media query dark mode** (not class-based) — use the chrome-devtools-mcp `emulate` tool instead
3. **JS-managed state** — the theme toggle may require calling a JS function, not just toggling a class

Check how dark mode is implemented:
```javascript
JSON.stringify({
  hasClassDark: document.documentElement.classList.contains('dark'),
  hasDataTheme: document.documentElement.getAttribute('data-theme'),
  mediaPrefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
  colorScheme: getComputedStyle(document.documentElement).colorScheme,
});
```

### Zoom region exceeds viewport boundaries

The `zoom` tool expects coordinates within `[0, 0, innerWidth, innerHeight]` in CSS pixels. Common mistakes:
1. Using device pixels (multiply by DPR) instead of CSS pixels
2. Using `getBoundingClientRect()` values from a scrolled page where the element is below the visible fold (rect values include scroll offset from viewport top)
3. Element is partially off-screen — clamp coordinates to viewport bounds

Always run Phase 0 calibration first.

---

## Quick Reference: Extraction Checklist

When tasked with extracting border/shadow/surface treatment of a component:

- [ ] **Phase 0**: Calibrate viewport (`innerWidth`, `innerHeight`, `devicePixelRatio`)
- [ ] **Phase 1a**: Extract computed styles (surface template)
- [ ] **Phase 1b**: Check pseudo-elements
- [ ] **Phase 1c**: Check focus state
- [ ] **Phase 1d**: Check parent/container shadow chain
- [ ] **Phase 2**: Find Tailwind utility class definitions (recursive traversal)
- [ ] **Phase 3a**: Extract current mode values
- [ ] **Phase 3b**: Toggle mode (separate call)
- [ ] **Phase 3c**: Extract other mode values (separate call)
- [ ] **Phase 3d**: Restore original mode
- [ ] **Phase 4a**: Check responsive breakpoints
- [ ] **Phase 4b**: Check container queries
- [ ] Compile findings into comparison table
