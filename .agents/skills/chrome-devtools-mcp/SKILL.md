---
name: chrome-devtools-mcp
description: Guide for browser-based design inspection using two tools — Claude Code's built-in /chrome for signed-in pages (primary), and chrome-devtools-mcp for performance profiling, network throttling, and localhost debugging (secondary). Use when extracting design tokens, analyzing competitor UIs, debugging layout, profiling performance, or inspecting network traffic.
---

# Browser Inspection & Design Token Extraction

This skill covers two browser inspection tools used together:

1. **Claude `/chrome`** (primary) — Connects to your real Chrome browser with all login sessions. Use for signed-in page inspection, design analysis, and token extraction.
2. **`chrome-devtools-mcp`** (secondary) — Launches a separate Chrome instance via DevTools Protocol. Use for performance profiling, network/CPU throttling, and localhost debugging.

## When to Use Which Tool

| Task | Use `/chrome` | Use `chrome-devtools-mcp` |
|------|:---:|:---:|
| Inspect signed-in pages and competitors | **Yes** | No (can't sign in — Google OAuth blocked) |
| Extract design tokens from authenticated UIs | **Yes** | No |
| Inspect your own localhost/staging app | Yes | **Yes** |
| Performance profiling (LCP, CLS, INP) | No | **Yes** |
| Network throttling (3G, 4G, Offline) | No | **Yes** |
| CPU throttling (simulate slow devices) | No | **Yes** |
| Geolocation emulation | No | **Yes** |
| Multi-tab inspection | No | **Yes** |

**Rule**: Default to `/chrome` for all design inspection. Only reach for `chrome-devtools-mcp` when you need performance, throttling, or multi-tab capabilities.

---

## Part 1: Claude `/chrome` (Primary — Signed-In Inspection)

### Prerequisites

- [ ] "Claude in Chrome" extension installed from Chrome Web Store (v1.0.36+)
- [ ] Claude Code v2.0.73+
- [ ] Direct Anthropic plan (Pro, Max, Teams, Enterprise)

### Setup

```bash
# Launch Claude Code with Chrome access
claude --chrome

# Or enable mid-session
/chrome

# To enable by default
# Run /chrome → select "Enabled by default"
```

### How It Works

`/chrome` connects to your **actual running Chrome browser** via the extension. This means:
- All your login sessions work (Google, GitHub, authenticated apps, etc.)
- No bot detection issues — the site sees your real browser
- Your extensions, cookies, and localStorage are all available
- You see the exact same page a real user sees

### Available Tools (via /chrome)

When `/chrome` is enabled, Claude Code gains access to Chrome DevTools Protocol tools on your real browser:
- `take_snapshot` — Accessibility tree with element UIDs
- `take_screenshot` — Visual capture
- `evaluate_script` — Run arbitrary JS in page context
- `click`, `fill`, `hover`, `press_key` — Interact with elements
- `list_console_messages` — Console errors/warnings
- `list_network_requests` — HTTP traffic
- `navigate_page` — Navigate to URLs

### Core Workflow: Design Token Extraction (Signed-In)

```
Step 1: Sign into the target site in your regular Chrome browser

Step 2: Ask Claude to navigate and extract
  "Navigate to the target site and extract all design tokens —
   typography, colors, spacing, CSS variables. Save to markdown."

Step 3: Claude uses /chrome tools to:
  - navigate_page → load the authenticated page
  - take_snapshot → get page structure with UIDs
  - evaluate_script → extract CSS custom properties, computed styles, colors
  - take_screenshot → visual reference

Step 4: Results saved outside this public repo, preferably in the private reference/research repository
```

### Why Not chrome-devtools-mcp for Signed-In Pages?

Google **blocks OAuth sign-in** from Chrome instances launched with remote debugging flags (`--remote-debugging-*`). Since `chrome-devtools-mcp` launches a new Chrome with these flags, you cannot:
- Sign in via Google OAuth
- Access any Google-authenticated session
- Use "Sign in with Google" on any third-party site

This is a deliberate Google security measure, not a bug.

---

## Part 2: chrome-devtools-mcp (Secondary — Performance & Localhost)

### Prerequisites

- [ ] MCP server installed: `claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest`
- [ ] Node.js v20.19+, Chrome installed
- [ ] Tools prefixed with `mcp__chrome-devtools__` in tool list

### When to Use

Use `chrome-devtools-mcp` when you need capabilities `/chrome` doesn't provide:

1. **Performance profiling** — Core Web Vitals, traces, LCP breakdown
2. **Network throttling** — Simulate Slow 3G, Fast 4G, Offline
3. **CPU throttling** — Simulate 4x-20x slower devices
4. **Geolocation emulation** — Test location-based features
5. **Multi-tab management** — Open/switch/close multiple pages
6. **Localhost/staging inspection** — No authentication needed
7. **Dialog handling** — Accept/dismiss browser alerts

### Quick Reference

| Category | Tools | Purpose |
|----------|-------|---------|
| Navigation | `navigate_page`, `list_pages`, `select_page`, `new_page`, `close_page`, `wait_for` | Multi-page management |
| Debugging | `evaluate_script`, `take_screenshot`, `take_snapshot`, `get_console_message`, `list_console_messages` | JS execution, DOM snapshots, console |
| Input | `click`, `drag`, `fill`, `fill_form`, `handle_dialog`, `hover`, `press_key`, `upload_file` | Page interaction |
| Network | `list_network_requests`, `get_network_request` | HTTP traffic inspection |
| Performance | `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight` | Core Web Vitals, traces |
| Emulation | `emulate`, `resize_page` | Device, network, geolocation, color scheme |

### Workflow: Performance Profiling

```
1. navigate_page({ type: "url", url: "http://localhost:3000" })
2. performance_start_trace({ reload: true, autoStop: true })
   # Returns: CWV scores (LCP, CLS, INP) + available insight sets

3. performance_analyze_insight({
     insightSetId: "navigation-1",
     insightName: "LCPBreakdown"
   })

# Save raw trace for external analysis
4. performance_start_trace({
     reload: true,
     autoStop: true,
     filePath: "./trace.json.gz"
   })
```

Available insight names: `DocumentLatency`, `LCPBreakdown`, `CLSContributors`, `RenderBlocking`, `ThirdParties`, `SlowCSS`, `LongTasks`.

### Workflow: Device & Network Emulation

```
# Emulate mobile + slow network
emulate({
  viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  networkConditions: "Slow 3G",
  cpuThrottlingRate: 4,
  colorScheme: "dark"
})

# Reset all emulation
emulate({
  viewport: null,
  userAgent: null,
  networkConditions: "No emulation",
  cpuThrottlingRate: 1,
  colorScheme: "auto",
  geolocation: null
})
```

Network presets: `No emulation`, `Offline`, `Slow 3G`, `Fast 3G`, `Slow 4G`, `Fast 4G`.

### Workflow: Design Token Extraction (Unauthenticated / Localhost)

```
1. navigate_page({ type: "url", url: "http://localhost:3000" })
2. take_snapshot({})

3. Extract CSS custom properties:
   evaluate_script({
     function: `() => {
       const root = getComputedStyle(document.documentElement);
       const tokens = {};
       for (const sheet of document.styleSheets) {
         try {
           for (const rule of sheet.cssRules) {
             if (rule.selectorText && rule.selectorText.includes(':root')) {
               for (const prop of rule.style) {
                 if (prop.startsWith('--')) {
                   tokens[prop] = root.getPropertyValue(prop).trim();
                 }
               }
             }
           }
         } catch(e) {}
       }
       return tokens;
     }`
   })

4. Extract computed styles per element:
   evaluate_script({
     function: `() => {
       const selectors = { h1:'h1', h2:'h2', body:'body', button:'button', input:'input' };
       const props = ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor'];
       const result = {};
       for (const [name, sel] of Object.entries(selectors)) {
         const el = document.querySelector(sel);
         if (!el) continue;
         const s = getComputedStyle(el);
         result[name] = {};
         for (const p of props) result[name][p] = s[p];
       }
       return result;
     }`
   })

5. Extract all unique colors:
   evaluate_script({
     function: `() => {
       const colors = new Set();
       document.querySelectorAll('*').forEach(el => {
         const s = getComputedStyle(el);
         colors.add(s.color);
         colors.add(s.backgroundColor);
         if (s.borderColor !== s.color) colors.add(s.borderColor);
       });
       return [...colors].filter(c => c !== 'rgba(0, 0, 0, 0)').sort();
     }`
   })

6. Test dark mode:
   emulate({ colorScheme: "dark" })
   # Re-run steps 3-5

7. Save outside this public repo, preferably in the private reference/research repository
```

### Workflow: Network & Console Debugging

```
1. navigate_page({ type: "url", url: "http://localhost:3000" })
2. list_console_messages({ types: ["error", "warn"] })
3. get_console_message({ msgid: 5 })              # Source-mapped stack trace

4. click({ uid: "e23" })                           # Trigger API call
5. wait_for({ text: "Results" })
6. list_network_requests({ resourceTypes: ["fetch", "xhr"] })
7. get_network_request({ reqid: 12 })              # Headers + body + response
8. get_network_request({ reqid: 12, responseFilePath: "./api-response.json" })
```

### Workflow: Multi-Page Comparison

```
1. navigate_page({ type: "url", url: "http://localhost:3000/page-a" })
2. new_page({ url: "http://localhost:3000/page-b", background: true })
3. list_pages({})
4. select_page({ pageId: 1, bringToFront: true })
5. take_snapshot({})
6. close_page({ pageId: 1 })
```

---

## Tool Reference (chrome-devtools-mcp)

### evaluate_script — MOST POWERFUL TOOL

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `function` | string | Yes | JS function declaration: `() => { ... }` or `(el) => { ... }` |
| `args` | array | No | Element references: `[{ uid: "e45" }]` |

**Key details:**
- Must be a **function declaration**, not a statement
- `args` passes element references by `uid` (from `take_snapshot`)
- Return values must be **JSON-serializable** (no DOM nodes, functions, circular refs)
- Runs in page context — access to `document`, `window`, `fetch`
- Supports `async`: `async () => { return await fetch(...) }`

### navigate_page

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `type` | string | No | — | `"url"`, `"back"`, `"forward"`, `"reload"` |
| `url` | string | No | — | Target URL (only for `type: "url"`) |
| `timeout` | number | No | — | Max wait time in ms |
| `ignoreCache` | boolean | No | — | Ignore cache on reload |
| `initScript` | string | No | — | JS to execute before page scripts on next nav |

### take_snapshot

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `verbose` | boolean | No | `false` | Include full a11y tree info |
| `filePath` | string | No | — | Save snapshot to file |

Returns accessibility tree with `uid` identifiers. **Always use latest snapshot** — UIDs change after DOM mutations.

### emulate

| Parameter | Type | Description |
|-----------|------|-------------|
| `viewport` | object/null | `{ width, height, deviceScaleFactor, isMobile, hasTouch, isLandscape }`. `null` to reset. |
| `colorScheme` | string | `"dark"`, `"light"`, `"auto"` |
| `networkConditions` | string | `"No emulation"`, `"Offline"`, `"Slow 3G"`, `"Fast 3G"`, `"Slow 4G"`, `"Fast 4G"` |
| `cpuThrottlingRate` | number | 1 (normal) to 20 (20x slower) |
| `geolocation` | object/null | `{ latitude, longitude }`. `null` to clear. |
| `userAgent` | string/null | Custom user agent. `null` to clear. |

### performance_start_trace

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reload` | boolean | Yes | Reload page after starting trace |
| `autoStop` | boolean | Yes | Auto-stop after page load |
| `filePath` | string | No | Save raw trace (`.json.gz` or `.json`) |

Navigate to target URL BEFORE starting trace if `reload` or `autoStop` is true.

### performance_analyze_insight

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `insightSetId` | string | Yes | From trace results (e.g., `"navigation-1"`) |
| `insightName` | string | Yes | e.g., `"LCPBreakdown"`, `"CLSContributors"` |

### list_network_requests

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `resourceTypes` | string[] | all | `document`, `stylesheet`, `image`, `font`, `script`, `xhr`, `fetch`, `websocket`, etc. |
| `pageSize` | number | all | Max requests per page |
| `pageIdx` | number | `0` | Pagination |

### get_network_request

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reqid` | number | No | Request ID. Omit for currently selected in DevTools. |
| `requestFilePath` | string | No | Save request body to file |
| `responseFilePath` | string | No | Save response body to file |

### list_console_messages

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `types` | string[] | all | `log`, `error`, `warn`, `info`, `debug`, `trace`, `assert`, `verbose` |
| `pageSize` | number | all | Max messages |
| `pageIdx` | number | `0` | Pagination |
| `includePreservedMessages` | boolean | `false` | Include last 3 navigations |

---

## Configuration

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--headless` | off | No visible browser window |
| `--no-performance-crux` | off | Don't send trace URLs to Google CrUX API |
| `--no-usage-statistics` | off | Disable anonymous usage stats |

### Privacy-Conscious MCP Config

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--no-performance-crux", "--no-usage-statistics"]
    }
  }
}
```

## Limitations

### `/chrome` Limitations
- No performance tracing
- No network/CPU throttling
- No geolocation emulation
- No multi-tab management
- Requires direct Anthropic plan (not Bedrock/Vertex)
- Beta — may have connection stability issues in long sessions

### chrome-devtools-mcp Limitations
- **Cannot sign into Google OAuth** — blocked by Google security on debugging-flagged Chrome
- **No built-in CSS inspection tools** — must use `evaluate_script` with custom JS
- **Snapshot UIDs are ephemeral** — change after any DOM mutation; re-snapshot after interactions
- **CrUX API calls by default** — use `--no-performance-crux` to disable
- **Usage statistics on by default** — use `--no-usage-statistics` to disable
- **Separate browser instance** — does not share sessions with your regular Chrome

## Output Format: Design Token Markdown

When extracting tokens, save outside this public repo using this format:

```markdown
# Design Tokens — [Site Name]
Extracted: [date] | URL: [url] | Auth: signed-in/anonymous

## Colors
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| Background | #ffffff | #212121 | Body bg |
| Text Primary | #111827 | #ffffff | Main text |
| Accent | #3b82f6 | #60a5fa | Buttons, links |

## Typography
| Element | Font | Size | Weight | Line Height | Letter Spacing |
|---------|------|------|--------|-------------|----------------|
| h1 | Inter | 28px | 400 | 34px | 0.38px |
| body | Inter | 16px | 400 | 24px | normal |
| button | Inter | 14px | 500 | 20px | normal |

## Spacing & Layout
| Component | Padding | Border Radius | Height |
|-----------|---------|---------------|--------|
| Header | 8px | 0 | 52px |
| Button (primary) | 0 12px | pill | 36px |
| Input area | 0 0 16px | 0 | auto |

## CSS Custom Properties
| Variable | Value |
|----------|-------|
| --spring-fast-duration | .667s |
| --cot-shimmer-duration | 2s |

## Animation Tokens
| Token | Duration | Curve Type |
|-------|----------|------------|
| --spring-fast | 0.667s | Linear spring approximation |
| --spring-bounce | 0.833s | Spring with overshoot |
```
