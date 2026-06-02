---
name: component-state-extraction
description: Extract interactive component states (hover, focus, active, disabled, checked, open/closed) from live web pages using Claude in Chrome (/chrome). Provides a two-phase baseline-then-delta workflow, MCP-optimized style diff scripts, data-attribute state enumeration, and component-type state matrices. Use when documenting competitor UI interaction patterns, auditing component accessibility states, reverse-engineering hover/focus visual treatments, or creating interaction design reference docs.
---

# Component State Extraction via /chrome

Structured workflow for capturing the visual appearance of interactive components across all their states (hover, focus, active, disabled, etc.) from live authenticated pages. Optimized to avoid MCP output truncation and handle the constraint that CSS `:hover` cannot be triggered from JavaScript alone.

## When to Use

- Documenting hover, focus, and active visual treatments of a competitor's UI
- Auditing ARIA and data-attribute state patterns across a page
- Capturing computed style deltas between component states (default vs. hover vs. focus)
- Creating a component interaction reference for replication
- Recording state transition GIFs for design handoff

## Key Constraints

### MCP Output Truncation
The `/chrome` JavaScript tool truncates at ~1500 characters. All extraction scripts return compact JSON and limit output to 15-20 properties per call.

### Hover Cannot Be Triggered from JavaScript
`dispatchEvent(new MouseEvent('mouseenter'))` triggers JS event handlers but does **NOT** activate the CSS `:hover` pseudo-class. Only actual mouse movement (MCP `hover` action) activates CSS `:hover`. This forces a two-phase pattern:

1. **Phase A (JS call):** Store baseline styles in `window.__stateCapture`
2. **Phase B (MCP hover action):** Move cursor to element
3. **Phase C (JS call):** Read current styles, compute delta against stored baseline

### State Side Effects
Some state triggers (`.click()`) may navigate or submit forms. Use the **safe trigger** column in the State Matrix to avoid destructive side effects.

---

## Phase 1: Setup & Component Discovery

### Step 1: Navigate and Screenshot

```
mcp__claude-in-chrome__tabs_context_mcp (createIfEmpty: true)
mcp__claude-in-chrome__navigate (url: "<target>", tabId: <id>)
mcp__claude-in-chrome__computer (action: "wait", duration: 3, tabId: <id>)
mcp__claude-in-chrome__computer (action: "screenshot", tabId: <id>)
```

### Step 2: Discover Interactive Elements

```javascript
// Find all interactive elements with testids, aria-labels, or roles
const els = document.querySelectorAll(
  'button, a, input, select, textarea, [role="button"], [role="tab"], ' +
  '[role="menuitem"], [role="checkbox"], [role="switch"], [role="option"], ' +
  '[data-testid], [aria-expanded], [aria-pressed], [aria-checked]'
);
const r = [];
for (let i = 0; i < Math.min(els.length, 25); i++) {
  const el = els[i];
  const t = el.tagName.toLowerCase();
  const ti = el.getAttribute('data-testid') || '';
  const al = el.getAttribute('aria-label') || '';
  const rl = el.getAttribute('role') || '';
  const dis = el.disabled || el.getAttribute('aria-disabled') === 'true';
  r.push(`${t}${ti ? ' [testid="'+ti+'"]' : ''}${rl ? ' [role="'+rl+'"]' : ''}${al ? ' "'+al.substring(0,25)+'"' : ''}${dis ? ' DISABLED' : ''}`);
}
r.join('\n');
```

### Step 3: Enumerate Data-Attribute States

```javascript
// Find all data-state, data-open, data-checked, etc. attributes in use
const attrs = ['data-state','data-open','data-closed','data-active',
  'data-hover','data-focus','data-checked','data-disabled',
  'data-selected','data-highlighted','data-pressed','data-expanded',
  'data-popup-open','data-orientation','data-side','data-motion'];
const r = {};
for (const a of attrs) {
  const els = document.querySelectorAll('['+a+']');
  if (els.length > 0) {
    const vals = new Set();
    els.forEach(el => vals.add(el.getAttribute(a) || '(present)'));
    r[a] = { count: els.length, values: [...vals].slice(0,5) };
  }
}
JSON.stringify(r, null, 2);
```

### Step 4: Classify Components

Group discovered elements by type using this matrix to plan which states to capture:

| Component Type | States to Capture | Safe Triggers |
|---------------|-------------------|---------------|
| Button | default, hover, focus-visible, active, disabled | hover: MCP, focus: `.focus()`, disabled: `.disabled=true` |
| Text input | empty, focused, filled, invalid, disabled | focus: `.focus()`, fill: `.value='x'`, invalid: clear required |
| Checkbox/toggle | unchecked, checked, indeterminate, disabled | checked: `.checked=true`, indeterminate: `.indeterminate=true` |
| Link | default, hover, focus | hover: MCP, focus: `.focus()` |
| Menu item | default, highlighted, selected, disabled | highlight: MCP hover, select: not safe (navigates) |
| Tab | default, selected, hover, focus | hover: MCP, focus: `.focus()` |
| Tooltip trigger | default, tooltip-visible | hover: MCP + wait 300ms |
| Dropdown trigger | closed, open | click: MCP click (may need re-close) |
| Accordion | collapsed, expanded | click: MCP click header |
| Sidebar item | default, hover, selected | hover: MCP |

---

## Phase 2: Baseline State Capture

### Inject Animation Freeze (Required Before All Captures)

```javascript
// Disable all transitions/animations for clean style snapshots
const style = document.createElement('style');
style.id = '__state-capture-freeze';
style.textContent = '*, *::before, *::after { transition-duration: 0s !important; transition-delay: 0s !important; animation-duration: 0s !important; animation-delay: 0s !important; }';
document.head.appendChild(style);
'freeze injected';
```

> **Remove after all captures:** `document.getElementById('__state-capture-freeze')?.remove();`

### Batch A: Baseline Visual Properties (Core)

```javascript
// Store baseline for target element — run BEFORE any state triggers
const el = document.querySelector('<selector>');
if (!el) { 'Element not found'; } else {
  const p = ['background-color','color','border-color','box-shadow',
    'outline','outline-color','outline-width','outline-offset',
    'opacity','cursor','transform','scale'];
  const cs = getComputedStyle(el);
  window.__sc = window.__sc || {};
  const b = {};
  p.forEach(k => b[k] = cs.getPropertyValue(k));
  window.__sc.baseline = b;
  window.__sc.selector = '<selector>';
  JSON.stringify(b);
}
```

### Batch B: Baseline Secondary Properties

```javascript
// Secondary visual properties — less likely to change but worth capturing
const el = document.querySelector(window.__sc?.selector || '<selector>');
if (!el) { 'not found'; } else {
  const p = ['text-decoration','text-decoration-color','font-weight',
    'border-width','border-radius','padding','filter',
    'backdrop-filter','pointer-events','z-index','visibility'];
  const cs = getComputedStyle(el);
  window.__sc.baseline2 = {};
  p.forEach(k => window.__sc.baseline2[k] = cs.getPropertyValue(k));
  JSON.stringify(window.__sc.baseline2);
}
```

### Batch C: Baseline Custom Properties (Tailwind/Framework)

```javascript
// Capture framework-specific custom properties
const el = document.querySelector(window.__sc?.selector || '<selector>');
if (!el) { 'not found'; } else {
  const p = ['--tw-ring-color','--tw-ring-opacity','--tw-shadow',
    '--tw-shadow-color','--tw-bg-opacity','--tw-text-opacity',
    '--tw-border-opacity','--tw-translate-x','--tw-translate-y',
    '--tw-scale-x','--tw-scale-y','--tw-rotate'];
  const cs = getComputedStyle(el);
  const r = {};
  p.forEach(k => { const v = cs.getPropertyValue(k).trim(); if (v) r[k] = v; });
  window.__sc.baselineVars = r;
  JSON.stringify(r);
}
```

---

## Phase 3: State-by-State Delta Capture

### The Delta Reader (use after every state trigger)

```javascript
// Read current styles and compute delta against stored baseline
const el = document.querySelector(window.__sc?.selector || '<selector>');
if (!el || !window.__sc?.baseline) { 'no baseline stored'; } else {
  const cs = getComputedStyle(el);
  const delta = {};
  for (const [k, v] of Object.entries(window.__sc.baseline)) {
    const now = cs.getPropertyValue(k);
    if (now !== v) delta[k] = { from: v, to: now };
  }
  // Also check secondary props
  if (window.__sc.baseline2) {
    for (const [k, v] of Object.entries(window.__sc.baseline2)) {
      const now = cs.getPropertyValue(k);
      if (now !== v) delta[k] = { from: v, to: now };
    }
  }
  Object.keys(delta).length === 0 ? 'no changes' : JSON.stringify(delta);
}
```

### State Trigger Workflows

**Hover State** (3-step: baseline already stored in Phase 2)
```
1. mcp__claude-in-chrome__computer (action: "hover", coordinate: [x, y], tabId: <id>)
2. mcp__claude-in-chrome__javascript_tool → [Delta Reader script above]
3. mcp__claude-in-chrome__computer (action: "hover", coordinate: [0, 0], tabId: <id>)  // move cursor away to reset
```

**Focus State** (in-JS — no MCP action needed)
```javascript
const el = document.querySelector(window.__sc?.selector || '<selector>');
if (!el || !window.__sc?.baseline) { 'no baseline'; } else {
  // Simulate keyboard modality for :focus-visible
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  el.focus();
  const cs = getComputedStyle(el);
  const delta = {};
  for (const [k, v] of Object.entries(window.__sc.baseline)) {
    const now = cs.getPropertyValue(k);
    if (now !== v) delta[k] = { from: v, to: now };
  }
  el.blur();
  Object.keys(delta).length === 0 ? 'no changes' : JSON.stringify(delta);
}
```

**Disabled State** (in-JS)
```javascript
const el = document.querySelector(window.__sc?.selector || '<selector>');
if (!el || !window.__sc?.baseline) { 'no baseline'; } else {
  const wasDis = el.disabled;
  el.disabled = true;
  el.setAttribute('aria-disabled', 'true');
  const cs = getComputedStyle(el);
  const delta = {};
  for (const [k, v] of Object.entries(window.__sc.baseline)) {
    const now = cs.getPropertyValue(k);
    if (now !== v) delta[k] = { from: v, to: now };
  }
  el.disabled = wasDis; // restore
  if (!wasDis) el.removeAttribute('aria-disabled');
  Object.keys(delta).length === 0 ? 'no changes' : JSON.stringify(delta);
}
```

**Checked State** (in-JS — for checkboxes, toggles, switches)
```javascript
const el = document.querySelector(window.__sc?.selector || '<selector>');
if (!el || !window.__sc?.baseline) { 'no baseline'; } else {
  const wasChecked = el.checked;
  el.checked = !wasChecked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  const cs = getComputedStyle(el);
  const delta = {};
  for (const [k, v] of Object.entries(window.__sc.baseline)) {
    const now = cs.getPropertyValue(k);
    if (now !== v) delta[k] = { from: v, to: now };
  }
  el.checked = wasChecked; // restore
  el.dispatchEvent(new Event('change', { bubbles: true }));
  Object.keys(delta).length === 0 ? 'no changes' : JSON.stringify(delta);
}
```

**Open/Expanded State** (for dropdowns, accordions — use MCP click)
```
1. mcp__claude-in-chrome__computer (action: "screenshot", tabId: <id>)  // before
2. mcp__claude-in-chrome__computer (action: "left_click", coordinate: [x, y], tabId: <id>)
3. mcp__claude-in-chrome__computer (action: "wait", duration: 0.5, tabId: <id>)
4. mcp__claude-in-chrome__computer (action: "screenshot", tabId: <id>)  // after
5. mcp__claude-in-chrome__javascript_tool → [Delta Reader script]
```

### Extraction Order (Parallelization Plan)

| Round | Calls | What |
|-------|-------|------|
| 1 | Screenshot + discover interactive elements + enumerate data-attributes | Discovery |
| 2 | Inject freeze + Batch A baseline + Batch B baseline | Baseline capture |
| 3 | Hover delta (MCP hover + JS read) + Focus delta (JS) + Disabled delta (JS) | Core states |
| 4 | Checked delta + Open/Expanded screenshots + Batch C custom props | Secondary states |
| 5 | Remove freeze + GIF recording of key transitions + compile markdown | Polish & output |

**Target: 5-6 round trips** for a full component audit (vs. 15+ without the skill).

---

## Phase 4: Screenshot & GIF Capture

### Static State Screenshots

For each state, capture a zoomed screenshot of the component:

```
// Before state trigger — capture default
mcp__claude-in-chrome__computer (action: "zoom", region: [x0, y0, x1, y1], tabId: <id>)

// Trigger state, then capture
mcp__claude-in-chrome__computer (action: "hover", coordinate: [cx, cy], tabId: <id>)
mcp__claude-in-chrome__computer (action: "zoom", region: [x0, y0, x1, y1], tabId: <id>)
```

Use `element.getBoundingClientRect()` via JS to find the zoom region:
```javascript
const el = document.querySelector('<selector>');
if (!el) { 'not found'; } else {
  const r = el.getBoundingClientRect();
  const pad = 16;
  JSON.stringify({ x0: Math.max(0,r.left-pad)|0, y0: Math.max(0,r.top-pad)|0, x1: (r.right+pad)|0, y1: (r.bottom+pad)|0, cx: (r.left+r.width/2)|0, cy: (r.top+r.height/2)|0 });
}
```

### GIF Recording for State Transitions

```
mcp__claude-in-chrome__gif_creator (action: "start_recording", tabId: <id>)
mcp__claude-in-chrome__computer (action: "screenshot", tabId: <id>)

// Hover sequence
mcp__claude-in-chrome__computer (action: "hover", coordinate: [cx, cy], tabId: <id>)
mcp__claude-in-chrome__computer (action: "wait", duration: 0.5, tabId: <id>)
mcp__claude-in-chrome__computer (action: "screenshot", tabId: <id>)

// Click sequence
mcp__claude-in-chrome__computer (action: "left_click", coordinate: [cx, cy], tabId: <id>)
mcp__claude-in-chrome__computer (action: "wait", duration: 0.5, tabId: <id>)
mcp__claude-in-chrome__computer (action: "screenshot", tabId: <id>)

mcp__claude-in-chrome__gif_creator (action: "stop_recording", tabId: <id>)
mcp__claude-in-chrome__gif_creator (action: "export", download: true, filename: "<component>-states.gif", tabId: <id>)
```

---

## Phase 5: Compile Markdown

### Output Template

```markdown
# [Site Name] [Component/Page] — Interaction State Reference

Extracted from [description].
URL pattern: `site.com/path`

> **Extracted:** YYYY-MM-DD via Claude in Chrome
> **Page state:** [authenticated/anonymous], [dark/light mode]

---

## Component Inventory

| # | Component | Selector | Type | States Captured |
|---|-----------|----------|------|-----------------|
| 1 | Send button | `button[data-testid="send-button"]` | Button | default, hover, focus, disabled |
| 2 | Sidebar item | `.nav-item` | Nav link | default, hover, selected |

## State Deltas

### [Component 1 — e.g., Send Button]

| State | Property | From (default) | To (state) |
|-------|----------|----------------|------------|
| hover | background-color | #fff | #f5f5f5 |
| hover | cursor | default | pointer |
| focus-visible | outline | none | 2px solid #3b82f6 |
| focus-visible | outline-offset | 0 | 2px |
| disabled | opacity | 1 | 0.5 |
| disabled | cursor | pointer | not-allowed |

### [Component 2 — e.g., Sidebar Item]

(same table format)

## Data Attribute States

| Attribute | Values Found | Count | Example Elements |
|-----------|-------------|-------|------------------|
| data-state | open, closed | 12 | button.menu-trigger, div.dropdown |
| data-highlighted | (present) | 3 | div.menu-item |

## Tailwind State Variants in Use

| Variant | Count | Example Classes |
|---------|-------|-----------------|
| hover: | 45 | hover:bg-gray-100, hover:text-blue-500 |
| focus: | 12 | focus:outline-none, focus:ring-2 |
| disabled: | 8 | disabled:opacity-50, disabled:cursor-not-allowed |

## Key Findings

- [Notable pattern 1]
- [Notable pattern 2]
```

### Naming Convention

Save extraction artifacts outside this public repo, preferably in the private reference/research repository, unless the user explicitly asks for a repo-local file.

Examples:
- `[site]-composer-state-reference.md`
- `[site]-sidebar-state-reference.md`
- `[site]-chat-button-state-reference.md`

---

## Content Safety Reference

### Always Safe
- Tag names, attributes, computed CSS property values
- Color values (hex, rgb, hsl)
- Numeric values (px, %, em)
- Class names and data-attribute values

### Potentially Blocked
- `<input>` `.value` contents (may contain user data)
- `textContent` of elements with user-generated content
- `<a>` href values

### Safe Approach
All scripts in this skill read `getComputedStyle` properties, which return pure CSS values (colors, lengths, keywords) — never user content. The extraction scripts are inherently safe.

---

## Troubleshooting

### Hover delta returns "no changes"
The cursor may not be over the correct element. Use `getBoundingClientRect()` to verify coordinates. Some elements only respond to hover on a child — check if the hover target is the element itself or an inner wrapper.

### Focus does not trigger :focus-visible styles
The browser uses an input-modality heuristic. Add the keyboard event dispatch before `.focus()`:
```javascript
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
element.focus();
```

### Element navigates away on click
Use hover + screenshot instead of click for elements that trigger navigation. For dropdowns that need click, use `event.preventDefault()`:
```javascript
el.addEventListener('click', e => e.preventDefault(), { once: true });
el.click();
```

### Baseline is stale after page interaction
Re-run Batch A baseline capture after any page interaction that changes the DOM (opening menus, scrolling, etc.). Baselines are stored in `window.__sc` and persist until overwritten.

### Data-attribute states don't have visual changes
Some `data-*` attributes are used for JS logic, not CSS styling. Check if any CSS rules target the attribute:
```javascript
const attr = 'data-state';
const hasCSS = [...document.styleSheets].some(s => {
  try { return [...s.cssRules].some(r => r.selectorText?.includes('['+attr)); }
  catch(e) { return false; }
});
hasCSS ? 'CSS targets this attribute' : 'No CSS rules found for this attribute';
```

---

## Relationship to Other Skills

| Skill | Purpose | Overlap |
|-------|---------|---------|
| `design-token-extraction` | CSS custom properties and computed style values at rest | Complementary — tokens give the default values; this skill captures how they change per state |
| `html-structure-extraction` | DOM tree, element hierarchy, class names | Complementary — structure shows WHAT exists; this skill shows HOW it behaves |
| `animation-transition-extraction` | Keyframes, transition timing, spring easings | Complementary — animations happen DURING state transitions; use together |
| `chrome-devtools-mcp` | Performance profiling, network throttling | Different tool — use for measuring animation performance |

Use `component-state-extraction` after `html-structure-extraction` (to know what elements exist) and alongside `design-token-extraction` (to get the token values that change per state).
