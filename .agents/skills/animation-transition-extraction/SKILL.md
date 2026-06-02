---
name: animation-transition-extraction
description: Extract CSS animations, transitions, @keyframes, spring easings, and motion design tokens from live web pages using Claude in Chrome (/chrome). Provides batched extraction scripts for keyframe inventories, transition rule discovery, Web Animations API inspection, and linear()/cubic-bezier() parsing sized for MCP output limits. Use when documenting competitor motion design systems, reverse-engineering animation patterns, auditing transition performance, or creating motion token reference docs.
---

# Animation & Transition Extraction via /chrome

Structured workflow for extracting the complete motion design system from live authenticated pages — keyframe definitions, transition rules, spring easing curves, and active animations. Optimized to avoid MCP output truncation and handle cross-origin stylesheet restrictions.

## When to Use

- Documenting a competitor's animation patterns (shimmer, slide, fade, spring)
- Reverse-engineering CSS `linear()` spring approximations and timing functions
- Creating a motion design token reference for replication
- Auditing which properties are animated and their performance characteristics
- Extracting `@keyframes` definitions from a live page

## Key Constraints

### MCP Output Truncation
The `/chrome` JavaScript tool truncates at ~1500 characters. Keyframe definitions with 40+ stops (common for spring `linear()` functions) will truncate. All scripts use compact JSON (`JSON.stringify(r)` — no pretty-print) and batch by category.

### Cross-Origin Stylesheet Restriction
`document.styleSheets[n].cssRules` throws `SecurityError` on cross-origin (CDN-hosted) stylesheets. **Every stylesheet iteration script must wrap access in try/catch.** This is non-negotiable boilerplate:

```javascript
for (const s of document.styleSheets) {
  try {
    for (const r of s.cssRules) { /* ... */ }
  } catch (e) { /* cross-origin, skip */ }
}
```

### Timing Sensitivity
`element.getAnimations()` only returns **currently running** animations. Animations that have finished or haven't started return nothing. For one-shot animations (page load fades, enter transitions), you must trigger and capture in the same JS execution or use `document.getAnimations()` immediately after trigger.

### Content Safety
Animation extraction is inherently safe — keyframe definitions, timing values, and easing curves contain no user content, URLs, or sensitive data. No special content-safety mode is needed.

---

## Phase 1: Setup & Animation Discovery

### Step 1: Navigate and Screenshot

```
mcp__claude-in-chrome__tabs_context_mcp (createIfEmpty: true)
mcp__claude-in-chrome__navigate (url: "<target>", tabId: <id>)
mcp__claude-in-chrome__computer (action: "wait", duration: 3, tabId: <id>)
mcp__claude-in-chrome__computer (action: "screenshot", tabId: <id>)
```

### Step 2: Animation Overview

Get a page-wide count of active animations by type:

```javascript
// Page animation summary
const all = document.getAnimations();
const r = {
  total: all.length,
  cssAnim: all.filter(a => a.animationName).length,
  cssTrans: all.filter(a => a.transitionProperty).length,
  waapi: all.filter(a => !a.animationName && !a.transitionProperty).length,
  running: all.filter(a => a.playState === 'running').length,
  paused: all.filter(a => a.playState === 'paused').length,
};
JSON.stringify(r);
```

### Step 3: Discover Animated Elements

```javascript
// Find elements with animation or transition in computed styles
const animated = [];
document.querySelectorAll('*').forEach(el => {
  const cs = getComputedStyle(el);
  const an = cs.animationName;
  const tr = cs.transitionProperty;
  const wc = cs.willChange;
  if ((an && an !== 'none') || (tr && tr !== 'all' && tr !== 'none') || (wc && wc !== 'auto')) {
    const t = el.tagName.toLowerCase();
    const id = el.id ? '#'+el.id : '';
    const cls = el.className ? '.'+String(el.className).split(' ')[0] : '';
    animated.push(`${t}${id}${cls} anim:${an !== 'none' ? an : '-'} trans:${tr !== 'all' ? tr.substring(0,40) : '-'} wc:${wc !== 'auto' ? wc : '-'}`);
  }
});
animated.slice(0, 20).join('\n');
```

---

## Phase 2: Keyframe & Animation Extraction

### Batch A: Keyframe Names Inventory

Get all `@keyframes` names and their stop counts to plan targeted extraction:

```javascript
// Keyframe inventory — names + stop counts
const r = {};
for (const s of document.styleSheets) {
  try {
    for (const ru of s.cssRules) {
      if (ru instanceof CSSKeyframesRule)
        r[ru.name] = ru.cssRules.length;
    }
  } catch(e) {}
}
JSON.stringify(r);
```

### Batch B: Keyframe Definition (per name)

Extract the full definition for a specific `@keyframes` rule. Run once per keyframe name from Batch A:

```javascript
// Extract specific keyframe — replace TARGET_NAME
const name = 'TARGET_NAME';
for (const s of document.styleSheets) {
  try {
    for (const r of s.cssRules) {
      if (r instanceof CSSKeyframesRule && r.name === name) {
        const f = [];
        for (let i = 0; i < r.cssRules.length; i++) {
          const k = r.cssRules[i], p = {};
          for (let j = 0; j < k.style.length; j++)
            p[k.style[j]] = k.style.getPropertyValue(k.style[j]);
          f.push({ o: k.keyText, p });
        }
        JSON.stringify(f);
      }
    }
  } catch(e) {}
}
```

> **If a keyframe has 40+ stops** (spring `linear()` approximations encoded as keyframes), it will truncate. Split extraction into two calls using array slicing: stops 0-20, then stops 20+.

### Batch C: Active Animations Summary

Capture all currently running/paused animations with their timing data:

```javascript
// Active animations — compact summary
JSON.stringify(document.getAnimations().map(a => {
  const t = a.effect?.getComputedTiming();
  return {
    type: a.animationName ? 'A' : a.transitionProperty ? 'T' : 'W',
    name: a.animationName || a.transitionProperty || '',
    state: a.playState,
    dur: t?.duration,
    ease: t?.easing?.substring(0, 60),
    iter: t?.iterations,
    el: (a.effect?.target?.tagName || '') + (a.effect?.target?.id ? '#'+a.effect.target.id : ''),
  };
}));
```

### Batch D: Element-Specific Animation Deep Dive

For a specific element, get full keyframe data from running animations:

```javascript
// Deep inspection of element's animations — replace SELECTOR
const el = document.querySelector('SELECTOR');
if (!el) { 'not found'; } else {
  const anims = el.getAnimations();
  if (anims.length === 0) { 'no active animations'; } else {
    JSON.stringify(anims.map(a => ({
      type: a.animationName ? 'A' : a.transitionProperty ? 'T' : 'W',
      name: a.animationName || a.transitionProperty || '',
      timing: a.effect?.getComputedTiming(),
      keyframes: a.effect?.getKeyframes()?.map(kf => {
        const r = { offset: kf.offset, easing: kf.easing };
        for (const [k,v] of Object.entries(kf)) {
          if (!['offset','easing','composite','computedOffset'].includes(k)) r[k] = v;
        }
        return r;
      }),
    })));
  }
}
```

---

## Phase 3: Transition Rule Extraction

### Batch E: Computed Transitions on Animated Elements

Extract transition properties from elements identified in Phase 1, Step 3:

```javascript
// Computed transitions for specific selectors
const sels = ['SELECTOR_1', 'SELECTOR_2', 'SELECTOR_3', 'SELECTOR_4', 'SELECTOR_5'];
const r = {};
for (const sel of sels) {
  const el = document.querySelector(sel);
  if (!el) { r[sel] = 'not found'; continue; }
  const cs = getComputedStyle(el);
  r[sel] = {
    prop: cs.transitionProperty,
    dur: cs.transitionDuration,
    ease: cs.transitionTimingFunction?.substring(0, 80),
    delay: cs.transitionDelay,
  };
}
JSON.stringify(r);
```

### Batch F: All Transition Rules from Stylesheets

Walk all stylesheets to find every `transition` declaration:

```javascript
// All transition rules — selectors + values
const t = [];
for (const s of document.styleSheets) {
  try {
    for (const r of s.cssRules) {
      if (r instanceof CSSStyleRule && (r.style.transition || r.style.transitionProperty)) {
        t.push({
          sel: r.selectorText?.substring(0, 60),
          dur: r.style.transitionDuration || '',
          ease: r.style.transitionTimingFunction?.substring(0, 40) || '',
          prop: r.style.transitionProperty?.substring(0, 40) || '',
        });
      }
    }
  } catch(e) {}
}
JSON.stringify(t.slice(0, 20));
```

> If there are more than 20 transition rules, run a second call with `.slice(20, 40)`.

### Batch G: Pseudo-State Transition Rules

Find transitions specifically tied to hover/focus/active states:

```javascript
// Transitions declared on pseudo-class selectors
const pseudo = /:(hover|focus|focus-within|focus-visible|active|checked|disabled)/;
const r = [];
for (const s of document.styleSheets) {
  try {
    for (const ru of s.cssRules) {
      if (ru instanceof CSSStyleRule && pseudo.test(ru.selectorText) &&
          (ru.style.transition || ru.style.transitionProperty || ru.style.animation)) {
        r.push({
          sel: ru.selectorText?.substring(0, 60),
          pseudo: ru.selectorText.match(pseudo)?.[1],
          tr: ru.style.transition?.substring(0, 50) || '',
          anim: ru.style.animation?.substring(0, 50) || '',
        });
      }
    }
  } catch(e) {}
}
JSON.stringify(r.slice(0, 15));
```

---

## Phase 4: Motion Token & Easing Extraction

### Batch H: CSS Custom Property Motion Tokens

Extract all duration, easing, and spring-related custom properties:

```javascript
// Motion-related CSS custom properties from :root/html
const tokens = {};
for (const s of document.styleSheets) {
  try {
    for (const r of s.cssRules) {
      if (r.selectorText === ':root' || r.selectorText === 'html' || r.selectorText === ':host') {
        for (let i = 0; i < r.style.length; i++) {
          const p = r.style[i];
          if (!p.startsWith('--')) continue;
          const v = r.style.getPropertyValue(p).trim();
          if (/duration|delay|ease|spring|motion|anim|timing|transition/i.test(p) ||
              /^\d+m?s$/.test(v) || /cubic-bezier|linear\(|ease|steps/.test(v)) {
            tokens[p] = v.substring(0, 80);
          }
        }
      }
    }
  } catch(e) {}
}
JSON.stringify(tokens);
```

### Batch I: Spring Easing Values (Full Resolution)

Spring `linear()` functions typically have 40-50+ stops and WILL truncate in a single call. Extract them by name:

```javascript
// Extract a single spring/easing custom property at full resolution
const name = '--spring-fast'; // replace with target token name
const root = getComputedStyle(document.documentElement);
const val = root.getPropertyValue(name).trim();
if (!val) { 'token not found'; } else {
  // Check if it's a linear() function
  if (val.startsWith('linear(')) {
    const stops = val.replace('linear(', '').replace(')', '').split(',');
    JSON.stringify({ name, type: 'linear()', stopCount: stops.length, first10: stops.slice(0,10).map(s => s.trim()), last5: stops.slice(-5).map(s => s.trim()) });
  } else {
    JSON.stringify({ name, value: val });
  }
}
```

> For full spring curves, split into two calls: stops 0-25 and stops 25+.

### Batch J: Shimmer & Loading Animation Detection

Identify shimmer, pulse, and loading keyframe patterns:

```javascript
// Detect shimmer/pulse/loading keyframes by property analysis
const r = {};
for (const s of document.styleSheets) {
  try {
    for (const ru of s.cssRules) {
      if (ru instanceof CSSKeyframesRule) {
        const props = new Set();
        for (let i = 0; i < ru.cssRules.length; i++) {
          const k = ru.cssRules[i];
          for (let j = 0; j < k.style.length; j++) props.add(k.style[j]);
        }
        const allProps = [...props];
        const isShimmer = allProps.some(p => p.includes('background-position'));
        const isPulse = allProps.includes('opacity') && ru.cssRules.length <= 3;
        const isSpin = allProps.some(p => p === 'transform') && ru.cssRules.length <= 2;
        if (isShimmer || isPulse || isSpin) {
          r[ru.name] = {
            type: isShimmer ? 'shimmer' : isPulse ? 'pulse' : 'spin',
            stops: ru.cssRules.length,
            props: allProps,
          };
        }
      }
    }
  } catch(e) {}
}
JSON.stringify(r);
```

### Batch K: Prefers-Reduced-Motion Rules

Check for reduced-motion alternatives:

```javascript
// Find @media (prefers-reduced-motion) rules
const r = [];
for (const s of document.styleSheets) {
  try {
    for (const ru of s.cssRules) {
      if (ru instanceof CSSMediaRule && ru.conditionText?.includes('prefers-reduced-motion')) {
        const inner = [];
        for (const ir of ru.cssRules) {
          inner.push(ir.selectorText?.substring(0, 50) + ' { ' + ir.cssText?.substring(ir.cssText.indexOf('{')+1, ir.cssText.indexOf('{')+80));
        }
        r.push({ condition: ru.conditionText, rules: inner.slice(0, 8) });
      }
    }
  } catch(e) {}
}
r.length === 0 ? 'no reduced-motion rules found' : JSON.stringify(r);
```

### Extraction Order (Parallelization Plan)

| Round | Calls | What |
|-------|-------|------|
| 1 | Screenshot + animation overview + discover animated elements | Discovery |
| 2 | Batch A (keyframe names) + Batch E (computed transitions) + Batch H (motion tokens) | Inventory pass |
| 3 | Batch B (keyframe defs, 1-3 calls) + Batch F (transition rules) + Batch G (pseudo-state rules) | Rule extraction |
| 4 | Batch C (active anims) + Batch I (spring full resolution) + Batch J (shimmer detection) | Runtime + special |
| 5 | Batch D (element deep dives) + Batch K (reduced-motion) + compile markdown | Detail + output |

**Target: 5-6 round trips** for a complete motion audit (vs. 15+ without the skill).

---

## Phase 5: Compile Markdown

### Output Template

```markdown
# [Site Name] — Motion Design Reference

Extracted from [description].
URL pattern: `site.com/path`

> **Extracted:** YYYY-MM-DD via Claude in Chrome
> **Page state:** [authenticated/anonymous], [dark/light mode]

---

## Animation Overview

| Metric | Value |
|--------|-------|
| Total active animations | N |
| CSS Animations | N |
| CSS Transitions | N |
| WAAPI Animations | N |
| @keyframes defined | N |
| Transition rules | N |

## @keyframes Definitions

### [keyframe-name] (type: shimmer | pulse | spring | custom)

```css
@keyframes [name] {
  [stops with properties]
}
```

Used by: `[selector]`

### [next keyframe]
...

## Transition Rules

| Selector | Properties | Duration | Easing | Delay |
|----------|-----------|----------|--------|-------|
| `.btn` | background-color, color | 150ms | ease | 0s |
| `[data-state]` | opacity, transform | 200ms | cubic-bezier(0.4, 0, 0.2, 1) | 0s |

## Pseudo-State Transitions

| Selector | Pseudo | Transition |
|----------|--------|------------|
| `.btn:hover` | hover | background-color 150ms ease |
| `input:focus` | focus | border-color 200ms, box-shadow 200ms |

## Motion Tokens (CSS Custom Properties)

### Duration Scale

| Token | Value | Usage |
|-------|-------|-------|
| --duration-fast | 150ms | Hover transitions |
| --duration-default | 200ms | Standard transitions |

### Easing Tokens

| Token | Value | Type |
|-------|-------|------|
| --ease-default | cubic-bezier(0.2, 0, 0, 1) | Standard |
| --spring-fast | linear(0, 0.009, ...) | Spring (N stops) |

### Spring Easing Detail

| Token | Stops | Has Overshoot | Approx Duration |
|-------|-------|---------------|-----------------|
| --spring-fast | 42 | Yes (max 1.111) | 400ms |
| --spring-bounce | 45 | Yes (max 1.139) | 500ms |

## Shimmer & Loading Animations

| Name | Type | Duration | Properties Animated |
|------|------|----------|-------------------|
| shimmer | gradient-slide | 1.5s | background-position |
| pulse | opacity-cycle | 2s | opacity |

## Animated Elements Inventory

| Element | Animation | Transition | will-change |
|---------|-----------|------------|-------------|
| .sidebar | - | transform 300ms var(--spring-fast) | transform |
| .message | fadeIn 200ms | - | opacity |

## Reduced Motion Alternatives

| Original | Reduced Motion Override |
|----------|----------------------|
| animation: shimmer 1.5s infinite | animation: none |
| transition: transform 300ms | transition: opacity 200ms |

## Performance Notes

| Property | GPU Accelerated | Elements Using |
|----------|:-:|------|
| transform | Yes | sidebar, dropdown |
| opacity | Yes | tooltips, messages |
| background-position | No | shimmer elements |
```

### Naming Convention

Save extraction artifacts outside this public repo, preferably in the private reference/research repository, unless the user explicitly asks for a repo-local file.

Examples:
- `[site]-conversation-motion-reference.md`
- `[site]-home-motion-reference.md`
- `[site]-chat-motion-reference.md`

---

## Troubleshooting

### getAnimations() returns empty array
The animation has already finished. For one-shot animations (page load, enter transitions):
```javascript
// Re-trigger by removing and re-adding the animation
const el = document.querySelector('<selector>');
const anim = getComputedStyle(el).animation;
el.style.animation = 'none';
el.offsetHeight; // force reflow
el.style.animation = '';
// Now immediately call getAnimations()
el.getAnimations();
```

### Stylesheet access throws SecurityError
This is expected for cross-origin (CDN) stylesheets. The try/catch guard in every batch script handles this. To check which sheets were skipped:
```javascript
const skipped = [];
for (const s of document.styleSheets) {
  try { s.cssRules; } catch(e) { skipped.push(s.href); }
}
JSON.stringify(skipped);
```
For skipped sheets, fall back to `getComputedStyle()` on elements — it always works regardless of stylesheet origin.

### Timing function shows cubic-bezier instead of keyword
Browsers normalize named easings to their `cubic-bezier()` equivalents in computed styles. Reference:
- `ease` = `cubic-bezier(0.25, 0.1, 0.25, 1)`
- `ease-in` = `cubic-bezier(0.42, 0, 1, 1)`
- `ease-out` = `cubic-bezier(0, 0, 0.58, 1)`
- `ease-in-out` = `cubic-bezier(0.42, 0, 0.58, 1)`

### Spring linear() function is truncated
Spring curves have 40-50+ stops. Split extraction into two calls:
```javascript
// Call 1: first half
const v = getComputedStyle(document.documentElement).getPropertyValue('--spring-fast').trim();
const stops = v.replace('linear(','').replace(')','').split(',');
JSON.stringify({ total: stops.length, batch: stops.slice(0, 25).map(s => s.trim()) });

// Call 2: second half
// ... .slice(25).map(s => s.trim())
```

### No keyframes found but elements are animated
The animations may be driven by JavaScript (GSAP, Framer Motion, react-spring) rather than CSS. Check:
```javascript
// Look for JS animation libraries on window
const libs = [];
if (window.gsap) libs.push('GSAP');
if (window.__FRAMER_MOTION__) libs.push('Framer Motion');
if (window.anime) libs.push('Anime.js');
libs.length ? 'JS libraries: ' + libs.join(', ') : 'No known JS animation libraries detected';
```
For JS-driven animations, use `document.getAnimations()` (catches WAAPI) or `MutationObserver` on rapidly changing `style` attributes.

### Keyframe properties show matrix() instead of translate/rotate/scale
`getComputedStyle` resolves all transforms to `matrix()`. Use individual transform properties (Chrome 104+):
```javascript
const cs = getComputedStyle(el);
JSON.stringify({ translate: cs.translate, rotate: cs.rotate, scale: cs.scale });
```

---

## Relationship to Other Skills

| Skill | Purpose | Overlap |
|-------|---------|---------|
| `design-token-extraction` | CSS custom properties including `--spring-*` and `--duration-*` tokens | Overlapping — design tokens skill captures motion tokens alongside color/spacing; this skill goes deeper on animation mechanics |
| `html-structure-extraction` | DOM tree and element hierarchy | Complementary — structure shows what elements exist; this skill shows how they move |
| `component-state-extraction` | Hover/focus/active visual deltas | Complementary — state changes trigger transitions; use together for complete interaction documentation |
| `chrome-devtools-mcp` | Performance profiling (FPS, paint, composite layers) | Complementary — use for measuring animation performance on your own app |

Use `animation-transition-extraction` after `html-structure-extraction` (to know which elements to inspect) and alongside `component-state-extraction` (to capture both the visual delta and the transition that produces it).
