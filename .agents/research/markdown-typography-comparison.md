# Markdown Typography Styling Comparison

> **Date**: February 16, 2026
> **Scope**: How three open-source AI chat apps style markdown in chat responses
> **Projects**: Not A Wrapper (ours), Zola, WebClaw/Open WebUI

---

## 1. Project-by-Project Analysis

### 1.1 Not A Wrapper (Our Project)

**Stack**: React 19, Tailwind 4, `react-markdown` + `remark-gfm`, `@tailwindcss/typography` v0.5.x

**How typography is applied**:

- The `@tailwindcss/typography` plugin is loaded via `@plugin "@tailwindcss/typography"` in `app/globals.css`
- `MessageContent` (in `components/ui/message.tsx` line 79) applies a base class: `prose break-words whitespace-normal`
- `MessageAssistant` (in `app/components/chat/message-assistant.tsx` lines 228–231) overrides with:
  ```
  prose dark:prose-invert relative min-w-full bg-transparent p-0
  prose-h1:scroll-m-20 prose-h1:text-2xl prose-h1:font-semibold
  prose-h2:mt-8 prose-h2:scroll-m-20 prose-h2:text-xl prose-h2:mb-3 prose-h2:font-medium
  prose-h3:scroll-m-20 prose-h3:text-base prose-h3:font-medium
  prose-h4:scroll-m-20 prose-h5:scroll-m-20 prose-h6:scroll-m-20
  prose-strong:font-medium prose-table:block prose-table:overflow-y-auto
  ```
- `globals.css` adds text-wrapping rules:
  ```css
  .prose :is(h1, h2, h3, h4) { text-wrap: balance; }
  .prose p, .prose li { text-wrap: pretty; }
  ```
- Markdown rendering is done by `react-markdown` with `remark-gfm` and `remark-breaks` in `components/ui/markdown.tsx`

**What controls colors**:

| Element | Color Source | Value |
|---------|------------|-------|
| Body text | `--tw-prose-body` (plugin default) | `colors.slate[700]` light / inverted dark |
| Headings | `--tw-prose-headings` (plugin default) | `colors.slate[900]` light / inverted dark |
| Bullet markers | `--tw-prose-bullets` (plugin default) | `colors.slate[300]` light / inverted dark |
| List counter digits | `--tw-prose-counters` (plugin default) | `colors.slate[500]` light / inverted dark |
| Links | `--tw-prose-links` (plugin default) | `colors.slate[900]` light / inverted dark |
| Bold text | `--tw-prose-bold` (plugin default) | `colors.slate[900]` light / inverted dark |
| Code (inline) | Custom component in `markdown.tsx` | `bg-primary-foreground` (design token) |

**Key observations**:

1. **No `--tw-prose-*` overrides exist** — all typography colors come from the plugin's built-in slate palette
2. The `prose-invert` modifier flips colors for dark mode, but uses the plugin's inverted palette (not our oklch tokens)
3. `MessageContent` sets `text-foreground` as a base, but `prose` class overrides it with `--tw-prose-body` for all child elements
4. Only inline `<code>` and `<a>` elements use our design tokens (via custom components in `markdown.tsx`)
5. The text-wrap CSS rules in `globals.css` are a nice progressive enhancement unique to our project

**Gap**: Bullet markers (`--tw-prose-bullets: slate[300]`) and body text (`--tw-prose-body: slate[700]`) use the plugin's slate palette, which does not match our oklch-based `--foreground` / `--muted-foreground` tokens. In dark mode, `prose-invert` flips these to the plugin's own inverted values, not our `.dark` token values.

---

### 1.2 Zola

**Stack**: Next.js 16, React 19, Tailwind 4, `react-markdown` + `remark-gfm`, `@tailwindcss/typography` v0.5.x

**Source**: [github.com/ibelick/zola](https://github.com/ibelick/zola)

**Key finding**: Zola's markdown/typography code is **virtually identical to ours**. Both projects share the same prompt-kit origin (Zola was created by Julien Thibeaut, who also created prompt-kit). The specific files are:

- `components/prompt-kit/message.tsx` — `MessageContent` applies `prose break-words whitespace-normal`
- `app/components/chat/message-assistant.tsx` — applies the exact same prose modifier classes as our project
- `components/prompt-kit/markdown.tsx` — same `react-markdown` + `remark-gfm` + `remark-breaks` with `marked.lexer()` block parsing
- `app/globals.css` — same `@plugin "@tailwindcss/typography"`, same oklch design tokens, same `:root`/`.dark` token definitions

**Differences from our project**:

| Aspect | Not A Wrapper | Zola |
|--------|--------------|------|
| Text-wrap CSS rules | Yes (`.prose :is(h1,h2,h3,h4) { text-wrap: balance }`) | No |
| Streaming caret | Yes (StreamingCaret component) | No |
| Finish reason warning | Yes (output length limits) | No |
| Loading states | Multiple variants (shimmer, dots) | Simpler |

**Typography approach**: Identical to ours in every meaningful way:
1. Uses `@tailwindcss/typography` with `prose dark:prose-invert`
2. Does NOT override `--tw-prose-*` variables
3. Colors come from the plugin's default slate palette
4. Dark mode via `prose-invert` (plugin defaults, not design tokens)
5. Same heading/strong modifiers via utility classes
6. Inline code and links use design tokens via custom components

**Conclusion**: Zola has the **exact same gap** we have — typography colors are decoupled from the design system tokens. Since both projects share prompt-kit's DNA, any solution we implement could be contributed upstream.

---

### 1.3 WebClaw (Open WebUI Fork — React Rewrite)

**Stack**: React, Tailwind, **Streamdown** (not react-markdown), **no typography plugin**

**Source**: Historical WebClaw research snapshot, Section 1.2 and Section 9. The local WebClaw research files were removed during context cleanup.

**How typography is applied**:

WebClaw takes a **completely manual approach**. They do NOT use `@tailwindcss/typography` at all. Instead, they use the Streamdown library's `components` prop to map each HTML element to a custom React component with explicit Tailwind utility classes:

```typescript
const INITIAL_COMPONENTS = {
  h1: ({ children }) => <h1 className="text-xl font-medium tracking-tight text-balance">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-medium tracking-tight text-balance">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-medium">{children}</h3>,
  p:  ({ children }) => <p className="text-sm leading-relaxed text-pretty">{children}</p>,
  ul: ({ children }) => <ul className="ml-6 list-disc space-y-2 text-sm">{children}</ul>,
  ol: ({ children }) => <ol className="ml-6 list-decimal space-y-2 text-sm">{children}</ol>,
  a:  ({ href, children }) => <a href={href} className="text-primary-700 underline underline-offset-4 hover:text-primary-900">{children}</a>,
  code: // inline code: bg-primary-200/50 rounded-sm px-1 py-0.5 text-[13px]
  // ... 15+ more element mappings
}
```

**What controls colors**:

| Element | Color Source | Value |
|---------|------------|-------|
| Body text | Inherited from parent (no explicit color class) | Parent's `text-*` |
| Headings | Inherited from parent | Parent's `text-*` |
| Bullet markers | Browser default for `list-disc` | Black/white (system) |
| List counter digits | Browser default for `list-decimal` | Black/white (system) |
| Links | Explicit utility | `text-primary-700` / `hover:text-primary-900` |
| Inline code | Explicit utility | `bg-primary-200/50` background |

**Key observations**:

1. **No typography plugin** — every element is manually styled
2. **No `--tw-prose-*` variables** — no CSS custom properties for typography colors
3. **Headings capped at `font-medium` (500)** — never bolder, which is a deliberate design choice
4. **Body text is `text-sm` (14px)** — smaller than the typography plugin's default
5. **Color inheritance**: Most elements inherit color from the parent container. No explicit `text-*` color on headings or body, meaning the parent's `text-foreground` carries through
6. **Links use theme colors**: `text-primary-700` references their Tailwind color scale
7. **Dark mode**: Handled by the parent container's text color + explicit dark variants where needed
8. **Lists**: `ml-6` indent with `space-y-2` vertical spacing, not the plugin's default spacing

**Pros of this approach**:
- Complete control over every element
- No extra dependency (no typography plugin bundle)
- Colors naturally inherit from the parent, staying in sync with the design system
- Streamdown handles partial markdown during streaming better than react-markdown

**Cons**:
- Must manually maintain spacing, sizing, line-height for all elements
- Easy to miss elements (what about `<blockquote>`, `<hr>`, nested lists?)
- No responsive prose sizing (`prose-sm`, `prose-lg`) out of the box
- Bullet marker color is browser-default (no control without extra CSS)

---

### 1.4 Open WebUI (Original — Svelte)

**Stack**: SvelteKit, Tailwind (v3-era config), `marked.lexer()` + Svelte components, `@tailwindcss/typography`

**Source**: [github.com/open-webui/open-webui](https://github.com/open-webui/open-webui)

**How typography is applied**:

Open WebUI uses a **hybrid approach**: the typography plugin for base styling, with extensive utility-class overrides and manual component rendering for maximum control.

In `src/app.css`, they define multiple prose variants as CSS classes:

```css
.markdown-prose {
  @apply prose dark:prose-invert
    prose-blockquote:border-s-gray-100 prose-blockquote:dark:border-gray-800
    prose-blockquote:border-s-2 prose-blockquote:not-italic prose-blockquote:font-normal
    prose-headings:font-semibold
    prose-hr:my-4 prose-hr:border-gray-50 prose-hr:dark:border-gray-850
    prose-p:my-0 prose-img:my-1 prose-headings:my-1
    prose-pre:my-0 prose-table:my-0 prose-blockquote:my-0
    prose-ul:-my-0 prose-ol:-my-0 prose-li:-my-0
    whitespace-pre-line;
}

.markdown-prose-sm { /* Same but with text-sm */ }
.markdown-prose-xs { /* Same but with text-xs */ }
```

In `tailwind.config.js`, they **disable the plugin's code styling** to use their own:

```javascript
typography: {
  DEFAULT: {
    css: {
      pre: false,
      code: false,
      'pre code': false,
      'code::before': false,
      'code::after': false
    }
  }
}
```

Then they apply manual code styling:

```css
.codespan {
  color: #eb5757;
  border-width: 0px;
  padding: 3px 8px;
  font-size: 0.8em;
  font-weight: 600;
  @apply rounded-md dark:bg-gray-800 bg-gray-100 mx-0.5;
}
```

**Rendering pipeline**: `marked.lexer()` tokenizes markdown → `MarkdownTokens.svelte` renders each token type as a Svelte component → each component gets manual Tailwind classes for structure (tables, lists, etc.)

**What controls colors**:

| Element | Color Source | Value |
|---------|------------|-------|
| Body text | `--tw-prose-body` (plugin default) | Plugin's slate/gray palette |
| Headings | `--tw-prose-headings` + `prose-headings:font-semibold` | Plugin default color, semibold weight |
| Bullet markers | `--tw-prose-bullets` (plugin default) | Plugin's slate/gray palette |
| Links | `.marked a { @apply underline }` + plugin default | Plugin default color, underline added |
| Inline code | Manual `.codespan` class | Hardcoded `#eb5757` (red) |
| Blockquotes | Extensive overrides | `border-gray-100` / `dark:border-gray-800` |
| HR | Overrides | `border-gray-50` / `dark:border-gray-850` |

**Key observations**:

1. **Uses typography plugin** but with heavy overrides — primarily spacing adjustments (margin collapse)
2. **Does NOT override `--tw-prose-*` color variables** — body/heading/bullet colors are plugin defaults
3. **Gray scale uses CSS custom properties** (`--color-gray-50` through `--color-gray-950`) for theme-ability, but these don't flow into the prose variables
4. **Disables plugin's code styling** and replaces with manual `.codespan` class using hardcoded color
5. **3 size variants** (`.markdown-prose`, `.markdown-prose-sm`, `.markdown-prose-xs`) for different contexts
6. **Token-level rendering** via `marked.lexer()` gives maximum control over each markdown element
7. **Dark mode**: `dark:prose-invert` + manual dark variants on overridden elements
8. **Blockquote customization** is thorough: not italic, normal weight, custom border color per theme

---

## 2. Comparison Table

| Dimension | Not A Wrapper | Zola | WebClaw | Open WebUI |
|-----------|--------------|------|---------|------------|
| **Typography plugin?** | Yes (`@tailwindcss/typography`) | Yes (identical) | **No** | Yes |
| **Prose class?** | `prose dark:prose-invert` | Identical | None | `prose dark:prose-invert` via `.markdown-prose` |
| **Body text color** | Plugin default (`slate[700]`) | Plugin default | Inherited from parent | Plugin default |
| **Heading color** | Plugin default (`slate[900]`) | Plugin default | Inherited from parent | Plugin default |
| **Bullet marker color** | Plugin default (`slate[300]`) | Plugin default | Browser default | Plugin default |
| **Counter digit color** | Plugin default (`slate[500]`) | Plugin default | Browser default | Plugin default |
| **Link color** | Plugin default | Plugin default | `text-primary-700` (theme) | Plugin default + underline |
| **Inline code color** | `bg-primary-foreground` (token) | Same | `bg-primary-200/50` | Hardcoded `#eb5757` |
| **`--tw-prose-*` overrides?** | **No** | **No** | N/A | **No** |
| **Design token integration** | Partial (only code/links) | Partial (same) | Full (via inheritance) | Minimal (only gray scale) |
| **Dark mode strategy** | `prose-invert` | `prose-invert` | Parent color inheritance | `prose-invert` + manual dark variants |
| **CSS layering** | `@layer base` for global; utilities for prose | Same | Utility classes per component | `@apply` in CSS classes |
| **Markdown renderer** | `react-markdown` + `remark-gfm` | Identical | Streamdown | `marked.lexer()` + Svelte components |
| **Size variants** | None | None | N/A | 3 variants (default, sm, xs) |
| **Spacing overrides** | Heading margins only | Same | Manual per element | Extensive (all element margins) |
| **Code styling** | Custom component | Same | Custom component | Plugin disabled + manual `.codespan` |

---

## 3. Pros and Cons of Each Approach

### Approach A: Typography Plugin with Default Colors (Not A Wrapper / Zola)

| Criterion | Assessment |
|-----------|-----------|
| **Maintainability** | High — the plugin handles spacing, sizing, line-heights. Few lines of custom CSS. |
| **Customizability** | Medium — easy to adjust via prose modifiers, but changing bullet/body color requires overriding CSS variables or switching approaches. |
| **Dark mode consistency** | Medium — `prose-invert` works but uses the plugin's own inverted palette, not our oklch tokens. Bullet markers may appear differently from surrounding `text-muted-foreground` elements. |
| **Bundle size / complexity** | Low added complexity. The typography plugin adds ~10KB to CSS output. |
| **Color mismatch risk** | **High** — prose body text uses `slate[700]` while the rest of the UI uses `oklch(0.141 0.005 285.823)`. In dark mode, prose uses the plugin's inverted slate while the UI uses `oklch(0.985 0 0)`. These are close but not identical, creating subtle inconsistency. |

### Approach B: Manual Element Styling (WebClaw)

| Criterion | Assessment |
|-----------|-----------|
| **Maintainability** | Low-Medium — every element must be manually styled. Adding a new element (e.g., `<details>`) requires a new component. |
| **Customizability** | **Very High** — complete control over every element. Can change any property on any element. |
| **Dark mode consistency** | **High** — colors inherit from the parent container, which uses design tokens. No secondary color system. |
| **Bundle size / complexity** | Slightly lower CSS output (no plugin), but more component code. Net neutral. |
| **Color mismatch risk** | **Low** — colors flow from the design system via inheritance. No parallel color palette. |

### Approach C: Typography Plugin with Heavy Overrides (Open WebUI)

| Criterion | Assessment |
|-----------|-----------|
| **Maintainability** | Medium — benefits from the plugin's spacing defaults, but the override classes are long and hard to read. Multiple size variants add maintenance surface. |
| **Customizability** | High — overrides can target any element. Disabling code defaults and using manual classes shows this flexibility. |
| **Dark mode consistency** | Medium — `prose-invert` for base, but manual dark variants needed for overridden elements (e.g., `prose-blockquote:dark:border-gray-800`). |
| **Bundle size / complexity** | Medium — plugin CSS + override CSS + manual component CSS. Highest total CSS footprint. |
| **Color mismatch risk** | Medium-High — base prose colors are still plugin defaults; only overridden elements (blockquote borders, hr, code) use theme colors. Body text and bullets still use the plugin's palette. |

---

## 4. Recommendation

**Recommended approach: (b) Override `--tw-prose-*` variables to map to our design tokens.**

### Why Not (a) Keep As-Is

The current approach works, but has a real color mismatch problem. The typography plugin's slate palette (`slate[700]` for body, `slate[300]` for bullets) is **not** the same as our design tokens (`--foreground: oklch(0.141 0.005 285.823)`, `--muted-foreground: oklch(0.552 0.016 285.938)`). While these colors are similar, they're from two different color systems and will diverge as we refine our theme. In dark mode, the divergence is more noticeable.

### Why Not (c) Drop the Plugin

WebClaw's manual approach works, but it's only practical because they use Streamdown (which has a built-in component mapping pattern). With `react-markdown`, we'd need to override every HTML element as a custom component — which is more work than overriding CSS variables. The typography plugin also handles many subtle details we'd need to reimplement: spacing between elements, nested list indentation, responsive line-height, proper margin collapsing. The plugin is battle-tested; our manual implementation would not be.

### Why (b) Is the Best Fit

The typography plugin is designed to be customized via `--tw-prose-*` CSS custom properties. By mapping these to our design tokens, we get:

1. **Battle-tested spacing and sizing** — the plugin's layout rules are well-tuned for long-form content
2. **Colors that match our design system** — body text, headings, bullets, counters, links, bold text all reference our tokens
3. **Automatic dark mode** — when `.dark` changes our token values, prose colors update automatically via the variable chain
4. **Minimal CSS** — approximately 12 variable assignments in `:root` and `.dark`, versus hundreds of lines for manual styling
5. **Easy maintenance** — if we change `--foreground`, prose headings change too
6. **Upstream-friendly** — Zola has the identical gap; this fix could be contributed to prompt-kit

### Implementation Sketch

Add to `app/globals.css` inside the existing `:root` and `.dark` blocks:

```css
:root {
  /* ... existing tokens ... */

  /* Typography plugin → design token bridge */
  --tw-prose-body: var(--foreground);
  --tw-prose-headings: var(--foreground);
  --tw-prose-lead: var(--muted-foreground);
  --tw-prose-links: var(--foreground);
  --tw-prose-bold: var(--foreground);
  --tw-prose-counters: var(--muted-foreground);
  --tw-prose-bullets: var(--muted-foreground);
  --tw-prose-hr: var(--border);
  --tw-prose-quotes: var(--foreground);
  --tw-prose-quote-borders: var(--border);
  --tw-prose-captions: var(--muted-foreground);
  --tw-prose-th-borders: var(--border);
  --tw-prose-td-borders: var(--border);
}

.dark {
  /* ... existing tokens ... */

  /* Typography — inherits automatically from dark token values */
  --tw-prose-body: var(--foreground);
  --tw-prose-headings: var(--foreground);
  --tw-prose-lead: var(--muted-foreground);
  --tw-prose-links: var(--foreground);
  --tw-prose-bold: var(--foreground);
  --tw-prose-counters: var(--muted-foreground);
  --tw-prose-bullets: var(--muted-foreground);
  --tw-prose-hr: var(--border);
  --tw-prose-quotes: var(--foreground);
  --tw-prose-quote-borders: var(--border);
  --tw-prose-captions: var(--muted-foreground);
  --tw-prose-th-borders: var(--border);
  --tw-prose-td-borders: var(--border);

  /* With token bridge in place, prose-invert is no longer needed */
  /* --tw-prose-invert-* variables become unused */
}
```

After adding these overrides, `dark:prose-invert` on the `MessageContent` class could be **removed** (since the `.dark` block already sets the correct values via the token bridge). However, keeping it is harmless — the `--tw-prose-invert-*` variables simply won't be used if the base variables already have the correct dark values.

### Additional Improvements to Consider

1. **Remove `dark:prose-invert`** from `MessageAssistant` and `MessageContent` after implementing the token bridge — it becomes redundant
2. **Add `prose-sm`** modifier for a tighter chat-message feel (body at 14px instead of 16px), matching WebClaw's `text-sm` convention
3. **Add blockquote overrides** inspired by Open WebUI: `prose-blockquote:not-italic prose-blockquote:font-normal prose-blockquote:border-border`
4. **Consider margin collapse** overrides like Open WebUI's `prose-p:my-0 prose-li:-my-0` for tighter spacing in chat context

---

## 5. Evidence Quality

| Claim | Evidence Type | Confidence |
|-------|--------------|------------|
| Zola's typography code is identical to ours | Direct source comparison (GitHub raw files) | **High** — byte-for-byte identical in key files |
| WebClaw doesn't use typography plugin | Historical research snapshot + code analysis | **High** — confirmed during codebase deep dive |
| Open WebUI uses `.markdown-prose` with heavy overrides | Direct source (`src/app.css`, `tailwind.config.js`) | **High** — raw file contents verified |
| None of the projects override `--tw-prose-*` variables | Searched all CSS files in each project | **High** — no matches found |
| Color mismatch between prose defaults and oklch tokens | CSS value comparison | **High** — `slate[700]` ≠ `oklch(0.141 0.005 285.823)` (mathematically different) |

---

*Research completed February 16, 2026. Sources: Zola GitHub repo (main branch), Open WebUI GitHub repo (main branch), and the now-removed local WebClaw research snapshot.*
