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
