---
name: html-structure-extraction
description: Extract full HTML structure from live web pages into markdown references using Claude in Chrome (/chrome). Provides a pre-built tree renderer optimized for MCP output limits, section-by-section extraction plans with depth presets, content-safety-aware modes, and a class name batch extractor. Use when documenting competitor UI structure, creating HTML reference docs, reverse-engineering component hierarchies, or auditing page accessibility landmarks.
---

# HTML Structure Extraction via /chrome

Structured workflow for extracting the complete HTML hierarchy from live authenticated pages into a markdown reference document. Optimized to avoid MCP output truncation and content safety blocks.

## When to Use

- Documenting the HTML structure of a competitor's authenticated UI
- Creating a component hierarchy reference for replication
- Auditing page accessibility landmarks and ARIA attributes
- Reverse-engineering layout patterns (grid areas, flex structures)
- Updating an existing HTML structure reference after a site redesign

## Key Constraints

### MCP Output Truncation
The `/chrome` JavaScript tool truncates at ~1500 characters. All extraction scripts use compact indented text (not JSON) and limit tree depth per call.

### Content Safety Blocking
The MCP tool blocks responses containing URLs, cookies, or data that resembles credentials. **Always use structure-only mode** (no text content, no href values) for the initial extraction. Only add text previews in a second pass for known-safe elements.

---

## Phase 1: Setup & Page Discovery

### Step 1: Navigate and Wait

```
mcp__claude-in-chrome__tabs_context_mcp (createIfEmpty: true)
mcp__claude-in-chrome__navigate (url: "<target>", tabId: <id>)
mcp__claude-in-chrome__computer (action: "wait", duration: 3, tabId: <id>)
mcp__claude-in-chrome__computer (action: "screenshot", tabId: <id>)
```

Always take a screenshot first to understand the visual layout before extracting structure.

### Step 2: Body-Level Skeleton

This gives you the top-level page organization to plan your section extractions.

```javascript
// Compact listing of body's direct children
const items = [];
for (const el of document.body.children) {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const ti = el.getAttribute('data-testid') || '';
  const role = el.getAttribute('role') || '';
  const n = el.children.length;
  const cls = (typeof el.className === 'string')
    ? '.' + el.className.split(' ').slice(0,4).join('.')
    : '';
  items.push(`<${tag}${id}${cls}${ti ? ' [testid="'+ti+'"]' : ''}${role ? ' [role="'+role+'"]' : ''}> (${n} ch)`);
}
items.join('\n');
```

### Step 3: Identify the App Root

Find the main app container (usually the only `<div>` under `<body>` with 2+ children):

```javascript
const divs = [...document.body.children].filter(
  el => el.tagName === 'DIV' && el.children.length >= 2
);
const app = divs[0]; // usually the first large div
const result = [];
result.push('APP: class="' + (app?.className || '').substring(0,120) + '"');
for (const ch of (app?.children || [])) {
  const cls = (typeof ch.className === 'string') ? ch.className.substring(0,120) : '';
  const id = ch.id ? ' #'+ch.id : '';
  result.push('  <' + ch.tagName.toLowerCase() + id + '> class="' + cls + '" (' + ch.children.length + ' ch)');
  for (const gc of ch.children) {
    const gcls = (typeof gc.className === 'string') ? gc.className.substring(0,100) : '';
    const gid = gc.id ? ' #'+gc.id : '';
    result.push('    <' + gc.tagName.toLowerCase() + gid + '> class="' + gcls + '" (' + gc.children.length + ' ch)');
  }
}
result.join('\n');
```

---

## Phase 2: Section-by-Section Extraction

### The Tree Renderer

Copy this function into every extraction call. It produces compact indented text that stays under the MCP truncation limit.

**Structure-only mode** (DEFAULT — safe from content blocking):

```javascript
function tree(el, d=0, maxD=5, maxCh=12) {
  if (!el || !el.tagName || d > maxD) return '';
  const t = el.tagName.toLowerCase();
  if (t==='script'||t==='style'||t==='svg'||t==='path'||t==='img'||t==='picture'||t==='source'||t==='noscript') return '';
  const id = el.id ? '#'+el.id : '';
  const ti = el.getAttribute('data-testid');
  const rl = el.getAttribute('role');
  const al = el.getAttribute('aria-label');
  let a = '';
  if (ti) a += ` [testid="${ti}"]`;
  if (rl) a += ` [role="${rl}"]`;
  if (al) a += ` [aria="${al.substring(0,30)}"]`;
  // Add any domain-specific data attributes here:
  for (const attr of ['data-message-id','data-message-author-role','data-composer-surface','data-state']) {
    const v = el.getAttribute(attr);
    if (v) a += ` [${attr}="${v.substring(0,12)}"]`;
  }
  const pad = '  '.repeat(d);
  let txt = '';
  if (el.children.length===0 && el.textContent?.trim()) txt = ' [text]';
  let r = pad+'<'+t+id+a+'>'+txt+'\n';
  let i=0;
  for (const ch of el.children) {
    if (i>=maxCh) { r+=pad+'  ...+'+(el.children.length-i)+' more\n'; break; }
    r += tree(ch, d+1, maxD, maxCh); i++;
  }
  return r;
}
```

**Annotated mode** (includes short text previews — use only on known-safe elements like headings, buttons, labels):

```javascript
function tree(el, d=0, maxD=5, maxCh=12) {
  if (!el || !el.tagName || d > maxD) return '';
  const t = el.tagName.toLowerCase();
  if (t==='script'||t==='style'||t==='svg'||t==='path'||t==='img'||t==='picture'||t==='source'||t==='noscript') return '';
  const id = el.id ? '#'+el.id : '';
  const ti = el.getAttribute('data-testid');
  const rl = el.getAttribute('role');
  const al = el.getAttribute('aria-label');
  let a = '';
  if (ti) a += ` [testid="${ti}"]`;
  if (rl) a += ` [role="${rl}"]`;
  if (al) a += ` [aria="${al.substring(0,30)}"]`;
  const pad = '  '.repeat(d);
  let txt = '';
  if (el.children.length===0) {
    const c = el.textContent?.trim();
    // Only include text for safe elements — never for <a>, <span> with URLs
    const safe = ['h1','h2','h3','h4','h5','h6','button','label','th','td','dt','dd','figcaption','legend','option'];
    if (c && c.length<40 && (safe.includes(t) || !c.includes('http'))) txt = ' "'+c+'"';
    else if (c) txt = ' [text]';
  }
  let r = pad+'<'+t+id+a+'>'+txt+'\n';
  let i=0;
  for (const ch of el.children) {
    if (i>=maxCh) { r+=pad+'  ...+'+(el.children.length-i)+' more\n'; break; }
    r += tree(ch, d+1, maxD, maxCh); i++;
  }
  return r;
}
```

### Depth & Children Presets

Use these settings per section type to balance detail vs. truncation:

| Section | Selector Pattern | `maxD` | `maxCh` | Notes |
|---------|-----------------|--------|---------|-------|
| Sidebar nav | `nav[aria-label]`, `#sidebar` | 4 | 8 | Chat list items are repetitive; cap early |
| Header / toolbar | `header`, `#page-header` | 5 | 10 | Usually shallow but wide |
| Message turns | `article[data-testid]` | 7 | 10 | Deep nesting in message bubbles |
| Markdown body | `.markdown`, `.prose` | 4 | 15 | Many siblings (paragraphs, lists) |
| Forms / composer | `form`, `[data-composer-surface]` | 7 | 12 | Deep nesting through grid areas |
| Carousels / widgets | `[data-testid*="widget"]` | 6 | 8 | Single card detail, skip duplicates |
| Modals / dialogs | `[role="dialog"]` | 5 | 10 | Usually self-contained |
| Footer / disclaimer | last child of composer wrapper | 3 | 5 | Very shallow |

### Extraction Order

Run these in parallel groups (each group = 1 round trip with 3 parallel JS calls):

| Round | Calls | What |
|-------|-------|------|
| 1 | Screenshot + body skeleton + app root | Page overview |
| 2 | Sidebar + header + thread top-level | Layout structure |
| 3 | User turn + assistant turn + composer | Core content |
| 4 | Widgets/carousels + action buttons + class names | Detail pass |
| 5 | Remaining sections + text previews (annotated mode) | Polish pass |

**Target: 5-6 round trips for a full page** (vs. 12+ without the skill).

---

## Phase 3: Class Name Extraction

Tailwind class strings are often 200+ characters and get truncated in tree output. Extract them separately with this dedicated utility:

```javascript
// Batch class extractor — adapt selectors to your target page
const selectors = {
  'app-root': '.flex.h-svh',                          // adjust per site
  'sidebar': '#stage-slideover-sidebar',
  'header': '#page-header',
  'thread': '#thread',
  'thread-scroll': '#thread > div[role="presentation"]',
  'thread-bottom': '#thread-bottom-container',
  'composer-form': '#thread-bottom form',
  'composer-surface': '[data-composer-surface="true"]',
  'textarea': '#prompt-textarea',
  'user-msg': '[data-message-author-role="user"]',
  'assistant-msg': '[data-message-author-role="assistant"]',
  'markdown-body': '.markdown',
};
const r = {};
for (const [name, sel] of Object.entries(selectors)) {
  const el = document.querySelector(sel);
  r[name] = el ? (typeof el.className === 'string' ? el.className.substring(0, 250) : '') : 'NOT FOUND';
}
JSON.stringify(r, null, 2);
```

**Important:** This will likely truncate. Split into 2 batches of 6 selectors each if needed. Keep each batch under 8 selectors.

### Deep class path extractor

For critical elements (like user message bubble), walk the ancestor chain:

```javascript
const target = document.querySelector('[data-message-author-role="user"]');
let el = target;
const path = [];
while (el && el.children.length > 0 && path.length < 8) {
  path.push({
    tag: el.tagName.toLowerCase(),
    class: (typeof el.className === 'string') ? el.className.substring(0, 150) : '',
    children: el.children.length,
  });
  el = el.children[0]; // follow first child
}
JSON.stringify(path, null, 2);
```

---

## Phase 4: Detail Passes

### Data Attribute Inventory

Discover all custom data attributes used on the page:

```javascript
const attrs = new Set();
document.querySelectorAll('*').forEach(el => {
  for (const a of el.attributes) {
    if (a.name.startsWith('data-') && !a.name.startsWith('data-radix'))
      attrs.add(a.name);
  }
});
JSON.stringify([...attrs].sort());
```

### Button/Action Inventory

Get all interactive elements with testids or aria-labels:

```javascript
const btns = document.querySelectorAll('button[data-testid], button[aria-label]');
const r = [];
for (let i = 0; i < Math.min(btns.length, 20); i++) {
  const b = btns[i];
  r.push({
    testid: b.getAttribute('data-testid'),
    aria: b.getAttribute('aria-label'),
    class: (typeof b.className === 'string') ? b.className.substring(0, 100) : '',
  });
}
JSON.stringify(r, null, 2);
```

### Landmark Audit

Get all ARIA landmarks and roles:

```javascript
const landmarks = document.querySelectorAll('[role], main, nav, header, footer, aside, form');
const r = [];
for (const el of landmarks) {
  const role = el.getAttribute('role') || el.tagName.toLowerCase();
  const label = el.getAttribute('aria-label') || '';
  const id = el.id || '';
  r.push(`${role}${id ? ' #'+id : ''}${label ? ' "'+label.substring(0,30)+'"' : ''}`);
}
r.join('\n');
```

---

## Phase 5: Compile Markdown

### Output Template

Use this structure for the final markdown file:

```markdown
# [Site Name] [Page Type] — HTML Structure Reference

Extracted from [description of the page].
URL pattern: `site.com/path/{id}`

> **Extracted:** YYYY-MM-DD via Chrome DevTools (Claude in Chrome)
> **Page state:** [authenticated/anonymous], [dark/light mode]

---

## Page Skeleton
(body-level structure in tree format)

## Sidebar / Navigation
(sidebar tree + class annotations)

## Header
(header tree)

## Main Content Area
(scroll container, layout wrappers)

## [Content Section 1 — e.g., User Message]
(deep tree of the section)

## [Content Section 2 — e.g., Assistant Message]
(deep tree)

## [Widget/Component — e.g., Search Carousel]
(component tree)

## Composer / Input Area
(form tree with grid areas annotated)

## Key Data Attributes
(table: attribute → purpose → example value)

## Key CSS Token Classes
(table: class → purpose)

## Key IDs
(table: id → element → purpose)
```

### Naming Convention

Save extraction artifacts outside this public repo, preferably in the private reference/research repository, unless the user explicitly asks for a repo-local file.

Examples:
- `[site]-conversation-html-structure.md`
- `[site]-home-html-structure.md`
- `[site]-chat-html-structure.md`

---

## Content Safety Reference

### Always Safe to Extract
- Tag names, IDs, data attributes, ARIA attributes, roles
- Class names (no content, just utility names)
- Element counts and nesting depth
- Heading text (`<h1>`-`<h6>`), button labels, form labels
- Placeholder text

### Potentially Blocked (use structure-only mode)
- `<a>` href values and link text (may contain URLs)
- `<p>`, `<span>`, `<li>` text content (may contain URLs from search results, citations)
- `<img>` src attributes
- `<input>` values
- Any element that might contain user-generated content with links

### Recovery If Blocked

If the MCP tool returns `[BLOCKED: Cookie/query string data]`:

1. Re-run the same extraction using the **structure-only tree renderer** (replace text with `[text]`)
2. For the blocked section, extract text content separately using annotated mode on a per-element basis (e.g., just headings, just buttons)
3. Skip `<a>` text content entirely — document as `[link text]` in the markdown

---

## Relationship to Other Skills

| Skill | Purpose | Overlap |
|-------|---------|---------|
| `design-token-extraction` | CSS custom properties and computed styles | Complementary — tokens go in a separate reference file |
| `chrome-devtools-mcp` | Performance profiling, network, throttling | Different tool — use for localhost/staging |

Use `html-structure-extraction` for the DOM tree, and `design-token-extraction` for the visual styling. Together they form a complete UI reference.

---

## Troubleshooting

### Tree output is empty or just the root element
The tree renderer filters out `<script>`, `<style>`, `<svg>`, `<img>` tags. If the target element only contains these, the output will appear empty. Check with:
```javascript
document.querySelector('<selector>').children.length;
document.querySelector('<selector>').innerHTML.substring(0, 200);
```

### Selector doesn't match
Tailwind classes with special characters need escaping in `querySelector`:
```javascript
// Won't work:
document.querySelector('.@container/main');
// Will work:
document.querySelector('.\\@container\\/main');
// Or use attribute selector:
document.querySelector('[class*="@container/main"]');
```

### Output consistently truncated
Reduce `maxCh` to 6-8 and `maxD` by 1. For very wide elements (nav with 20+ items), extract just the first child as a representative example, then note the total count.

### Page structure changed after navigation
SPAs often rehydrate the DOM after navigation. Wait 2-3 seconds, then re-discover elements. IDs and data attributes are more stable than class names across navigations.
