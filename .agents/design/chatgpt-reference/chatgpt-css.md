# ChatGPT CSS Reference

Purpose: compact, agent-facing CSS guidance for replicating ChatGPT components from copied HTML. This is not an exhaustive stylesheet dump. Load this file first, then load the component-specific reference for the surface being implemented.

Captured from `https://chatgpt.com/` on 2026-05-18. Static light/dark token values were parsed from loaded ChatGPT CSS assets. Live computed element metrics were verified in Chrome against the rendered dark page.

## Load Order

1. `README.md` for the reference map.
2. `chatgpt-design-tokens.md` for global type, radii, shadows, and semantic color tokens.
3. The matching component reference:
   - `prompt-input/chatgpt-prompt-styles-reference.md`
   - `sidebar/chatgpt-styles-reference.md`
   - `chatgpt-conversation-styles-reference.md`
4. `raw/chatgpt-css-exhaustive-2026-05-18.md` only when a token or selector is missing from the curated docs.

## Agent Replication Checklist

Use this checklist when translating copied ChatGPT HTML into local frontend components. It captures the non-obvious context that raw variables alone do not explain.

### Component Anatomy Map

| Selector / pattern | Role | Replication priority |
| --- | --- | --- |
| `#thread-bottom-container` | Sticky bottom composer region that owns the vertical bottom space | Preserve sticky placement and message-column alignment |
| `[data-composer-surface="true"]` | Rounded composer shell | Preserve 28px pill radius, grid layout, padding, and subtle shadow |
| `#prompt-textarea` | Editable prompt body | Preserve 16px / 24px type, transparent bg, bottom padding, and placeholder contrast |
| `[data-message-author-role="user"]` | User-authored message row/bubble | Right-align and use `--message-surface` / `--default-theme-user-msg-*` |
| `[data-message-author-role="assistant"]` | Assistant response row | Keep mostly unboxed prose with constrained readable width |
| `.prose` | Markdown response body | Preserve max-width, line-height, link/strong/list/code/table styling |
| Sidebar item selectors / `data-sidebar-item` | Sidebar row state layer | Preserve muted hover, selected, trailing action, and collapsed rail behavior |

### Required States

- Composer: default, focused, disabled/blocked, file/tool attached, send-button enabled, send-button disabled, mobile compact.
- Message row: user, assistant, streaming/loading, error/retry, selected/shared, hover action bar.
- Sidebar: expanded, collapsed rail, item hover, active item, trailing button hover/focus, section header, empty/new chat.
- Interactive controls: default, hover, press, focus-visible, disabled, selected.
- Theme: light and dark should resolve through semantic tokens; avoid separate component CSS branches unless layout or shadow actually changes.

### Responsive Rules

- Keep the conversation column and composer visually tied together; do not let the composer drift wider than the readable message column.
- Desktop chat content should stay around the `--chat-max-width` / 48rem-50rem range, with centered content and side gutters.
- Mobile should retain side padding and prevent user bubbles from touching viewport edges.
- Sidebar uses `--sidebar-width` for expanded state and `--sidebar-rail-width` for the collapsed rail; do not approximate with unrelated app shell widths.
- The composer is sticky to the bottom region, but the rounded surface itself should remain visually light and unframed.

### Critical Visual Recipes

- Composer pill: rounded `28px`, `10px` padding, transparent textarea, no hard border, ambient shadow plus dark-mode inset hairline.
- User bubble: `width: fit-content`, max-width below full column width, right aligned, `--message-surface` background, generous radius.
- Assistant prose: unboxed, readable measure, markdown-specific spacing, muted secondary controls.
- Sidebar item: transparent default, low-contrast hover, stronger active state, text and icons using sidebar semantic tokens.
- Code block: secondary surface, syntax token colors, subtle header/action affordances, and borders that follow light/dark token contrast.

### Duplication Pitfalls

- Do not paste the full ChatGPT class list as the implementation contract; treat classes as evidence for behavior.
- Do not turn every message row into a card; assistant messages are mostly surface-free prose.
- Do not replace the composer shadow with a visible border; the edge is intentionally soft.
- Do not use one raw gray value everywhere; preserve surface hierarchy with semantic tokens.
- Do not skip focus-visible states; ChatGPT controls rely on restrained but present focus feedback.
- Do not load the raw exhaustive archive into an agent by default; it is a lookup file, not implementation guidance.

## High-Signal Tokens

Prefer semantic tokens over raw palette tokens when recreating components. Raw Tailwind and generated internals are intentionally omitted unless they directly affect copied component HTML.

### Surfaces

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg-primary` | `#fff` | `#212121` | Main app background |
| `--bg-secondary` | `#e8e8e8` | `#303030` | Secondary surface |
| `--bg-tertiary` | `#f3f3f3` | `#414141` | Hover/tertiary surface |
| `--bg-elevated-primary` | `#fff` | `#303030` | Popovers/cards |
| `--bg-elevated-secondary` | `#f9f9f9` | `#181818` | Elevated sidebar/panel |
| `--main-surface-background` | `#fffffff2` | `#212121e6` | Main translucent shell |
| `--main-surface-primary` | `var(--white)` | `var(--gray-800)` | Primary app surface |
| `--main-surface-secondary` | `var(--gray-50)` | `var(--gray-750)` | Secondary app surface |
| `--main-surface-tertiary` | `var(--gray-100)` | `var(--gray-700)` | Tertiary app surface |

### Text, Icons, Borders

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--text-primary` | `var(--gray-950)` | `var(--gray-100)` | Primary text |
| `--text-secondary` | `#0009` | `#ffffffb3` | Secondary text |
| `--text-tertiary` | `#0000004a` | `#ffffff94` | Subtle labels |
| `--text-placeholder` | `#000000b3` | `#fffc` | Composer placeholder |
| `--icon-primary` | `#0d0d0d` | `#e8e8e8` | Primary icon |
| `--icon-secondary` | `#676767` | `#cdcdcd` | Secondary icon |
| `--icon-tertiary` | `#8f8f8f` | `#afafaf` | Muted icon |
| `--border-default` | `#0d0d0d1a` | `#ffffff26` | Default border |
| `--border-light` | `#0000001a` | `#ffffff1a` | Light border |
| `--border-medium` | `#00000026` | `#ffffff26` | Medium border |
| `--border-heavy` | `#0003` | `#fff3` | Heavy border |

### Component Surfaces

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--message-surface` | `#e9e9e980` | `#323232d9` | User bubble and message surface |
| `--composer-surface` | `var(--message-surface)` | `var(--message-surface)` | Composer shell alias |
| `--composer-surface-primary` | `var(--main-surface-primary)` | `#303030` | Composer primary surface |
| `--composer-blue-bg` | `#daeeff` | `#2a4a6d` | Tool/accent pill background |
| `--composer-blue-hover` | `#bddcf4` | `#1a416a` | Tool/accent hover |
| `--default-theme-user-msg-bg` | `var(--message-surface)` | `var(--message-surface)` | Default user message bg |
| `--default-theme-user-msg-text` | `var(--text-primary)` | `var(--text-primary)` | Default user message text |
| `--sidebar-surface-primary` | `var(--gray-50)` | `var(--gray-900)` | Sidebar bg |
| `--sidebar-surface-secondary` | `var(--gray-100)` | `var(--gray-800)` | Sidebar hover/selected base |
| `--sidebar-surface-tertiary` | `var(--gray-200)` | `var(--gray-750)` | Sidebar stronger hover |
| `--sidebar-title-primary` | `#28282880` | `#f0f0f080` | Sidebar section title |
| `--sidebar-body-primary` | `#0d0d0d` | `#ededed` | Sidebar item text |
| `--sidebar-icon` | `#7d7d7d` | `#a4a4a4` | Sidebar icons |

### Interactive Primitives

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--interactive-bg-primary-default` | `#0d0d0d` | `#fff` | Primary button bg |
| `--interactive-bg-primary-hover` | `#0d0d0dcc` | `#fffc` | Primary button hover |
| `--interactive-bg-secondary-hover` | `#0d0d0d05` | `#ffffff1a` | Secondary hover |
| `--interactive-bg-secondary-press` | `#0d0d0d0d` | `#ffffff0d` | Secondary press |
| `--interactive-bg-tertiary-hover` | `#f9f9f9` | `#181818` | Tertiary hover |
| `--interactive-label-primary-default` | `#fff` | `#0d0d0d` | Label on primary |
| `--interactive-label-secondary-default` | `#0d0d0d` | `#f3f3f3` | Secondary label |
| `--interactive-label-tertiary-default` | `#5d5d5d` | `#cdcdcd` | Tertiary label |
| `--interactive-icon-primary-default` | `#fff` | `#0d0d0d` | Icon on primary |
| `--interactive-icon-secondary-default` | `#0d0d0d` | `#f3f3f3` | Secondary icon |

## Critical Supporting Variables

These variables are not always visible in the first copied component, but they materially affect faithful duplication of chat layout, markdown, scroll regions, status UI, code blocks, and interaction polish.

### Layout And Sizing

| Token | Value | Use |
| --- | --- | --- |
| `--spacing` | `.25rem` / `4px` | Base spacing unit |
| `--chat-max-width` | `800px` | Conversation content width |
| `--chat-gutter` | `calc(var(--spacing)*5)` | Chat horizontal gutter |
| `--sidebar-width` | `260px` | Expanded sidebar width |
| `--sidebar-rail-width` | `calc(13 * var(--spacing))` / `52px` | Collapsed sidebar rail |
| `--sidebar-section-margin-top` | `1.25rem` | Sidebar section spacing |
| `--sidebar-section-first-margin-top` | `.5rem` | First sidebar section spacing |
| `--breakpoint-md` | `48rem` | Medium breakpoint |
| `--breakpoint-lg` | `64rem` | Large breakpoint |
| `--breakpoint-xl` | `80rem` | Extra-large breakpoint |

### Links, Selection, Scrollbars

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--link` | `#2964aa` | `#7ab7ff` | Inline prose links |
| `--link-hover` | `#749ac8` | `#5e83b3` | Link hover |
| `--scrollbar-color` | `#0000001a` | `#ffffff1a` | Scrollbar thumb |
| `--scrollbar-color-hover` | `#0003` | `#fff3` | Scrollbar hover |
| `--selection` | `#007aff` | `#007aff` | Text selection |

### Status, Hints, And Tool Feedback

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--text-error` | `#f93a37` | `#f93a37` | Error text |
| `--text-danger` | `var(--red-500)` / `#e02e2a` | `var(--red-500)` / `#e02e2a` | Destructive text |
| `--surface-error` | `249 58 55` | `249 58 55` | Error surface RGB triplet |
| `--content-primary` | `#01172b` | `#f2f6fa` | Tool/canvas primary content |
| `--content-secondary` | `#44505b` | `#dbe2e8` | Tool/canvas secondary content |
| `--dot-color` | `var(--black)` | `var(--white)` | Loading/status dots |
| `--icon-surface` | `13 13 13` | `240 240 240` | Icon surface RGB triplet |
| `--hint-bg` | `#b3dbff` | `#b3dbff` | Hint/callout background |
| `--hint-text` | `#08f` | `#08f` | Hint/callout text |
| `--tag-blue` | `#08f` | `#08f` | Tag/accent blue |

### Code Blocks

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--codeblock-background-color` | `var(--gray-25)` | `var(--gray-25)` | Code block surface |
| `--codeblock-syntax-1` | `#c0660d` | `#f4d35e` | Syntax color 1 |
| `--codeblock-syntax-2` | `#0a66d1` | `#93c5fd` | Syntax color 2 |
| `--codeblock-syntax-3` | `#138a36` | `#86efac` | Syntax color 3 |
| `--codeblock-syntax-4` | `#d14f8a` | `#f9a8d4` | Syntax color 4 |
| `--codeblock-syntax-5` | `#8b5cf6` | `#d8b4fe` | Syntax color 5 |
| `--code-icon-c0` | - | `#bebebe` | Code icon foreground |
| `--code-icon-c1` | - | `#4d4d4d` | Code icon layer |
| `--code-icon-c2` | - | `#4d4d4d` | Code icon layer |
| `--code-icon-c3` | - | `#4d4d4d` | Code icon layer |

### Motion, Radius, And Effects

| Token | Value | Use |
| --- | --- | --- |
| `--default-transition-duration` | `.15s` | Standard UI transition duration |
| `--default-transition-timing-function` | `cubic-bezier(.4, 0, .2, 1)` | Standard transition easing |
| `--ease-in` | `cubic-bezier(.4, 0, 1, 1)` | Enter/press acceleration |
| `--ease-out` | `cubic-bezier(0, 0, .2, 1)` | Exit/deceleration |
| `--ease-in-out` | `cubic-bezier(.4, 0, .2, 1)` | Balanced UI motion |
| `--radius-xs` | `.125rem` | Small inner rounding |
| `--radius-sm` | `.25rem` | Small control rounding |
| `--radius-md` | `.375rem` | Medium control rounding |
| `--radius-lg` | `.5rem` | Card/control rounding |
| `--radius-xl` | `.75rem` | Large control rounding |
| `--radius-2xl` | `1rem` | Bubble/panel rounding |
| `--shadow-hairline` | `0 0 0 var(--shadow-hairline-width) var(--shadow-hairline-color)` | Border-like hairline shadow |
| `--shadow-hairline-color` | light `#00000014` / `#0000001a`, dark `#ffffff1a` / `#ffffff1f` | Hairline color |
| `--shadow-hairline-width` | `1px` / `.5px` | Hairline thickness |
| `--blur-xs` | `4px` | Small blur |
| `--blur-sm` | `8px` | Small-medium blur |
| `--blur-md` | `12px` | Medium blur |
| `--blur-lg` | `16px` | Large blur |

## Live Computed Signals

Chrome snapshot: dark mode, 746px viewport, ChatGPT home/composer state.

### Composer Surface

```css
[data-composer-surface="true"] {
  display: grid;
  position: relative;
  width: 640px;
  height: 56px;
  padding: 10px;
  border-radius: 28px;
  overflow: clip;
  background-color: rgb(33, 33, 33);
  color: rgb(255, 255, 255);
  box-shadow:
    rgba(0, 0, 0, 0.06) 0px 3px 6px 0px,
    rgba(255, 255, 255, 0.2) 0px 0px 1px 0px inset;
}
```

### Prompt Textarea

```css
#prompt-textarea {
  width: 418.156px;
  height: 40px;
  margin: 16px 0 0;
  padding: 0 0 16px;
  background-color: transparent;
  color: rgb(255, 255, 255);
  font: 400 16px/24px -apple-system-body, ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
}
```

### Sticky Composer Region

```css
#thread-bottom-container {
  display: flex;
  position: sticky;
  z-index: 10;
  width: 746px;
  height: 767.344px;
  background-color: transparent;
}
```

## Implementation Notes

- Treat ChatGPT classes as evidence, not as a class list to copy wholesale.
- Preserve semantic behavior first: surface hierarchy, text contrast, 28px composer radius, subtle inset/ambient shadow, sticky bottom composer, and muted hover states.
- For project implementation, map these values to local design tokens instead of recreating ChatGPT's full Tailwind variable universe.
- Use the raw archive only to resolve missing token names or obscure copied selectors.
