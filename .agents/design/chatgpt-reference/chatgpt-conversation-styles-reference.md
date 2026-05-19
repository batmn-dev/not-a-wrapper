# ChatGPT Conversation - Styles Reference

Agent-facing CSS reference for replicating the ChatGPT conversation and message body from copied HTML. Use with the desktop/mobile conversation HTML examples in this folder.

## Scope

- Message column layout and readable width.
- User bubble and assistant prose styling.
- Markdown/prose typography for paragraphs, lists, headings, links, blockquotes, code, and tables.
- Light/dark semantic tokens needed by message surfaces.

For global foundations, load `chatgpt-design-tokens.md`. For all raw variable declarations, use `raw/chatgpt-css-exhaustive-2026-05-18.md` only as a lookup archive.

## Message Surface Tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--message-surface` | `#e9e9e980` | `#323232d9` | User bubble and message surface |
| `--default-theme-user-msg-bg` | `var(--message-surface)` | `var(--message-surface)` | Default user bubble bg |
| `--default-theme-user-msg-text` | `var(--text-primary)` | `var(--text-primary)` | User bubble text |
| `--text-primary` | `var(--gray-950)` | `var(--gray-100)` | Assistant body text |
| `--text-secondary` | `#0009` | `#ffffffb3` | Metadata/subtle controls |
| `--border-light` | `#0000001a` | `#ffffff1a` | Divider and table border |
| `--main-surface-primary` | `var(--white)` | `var(--gray-800)` | Conversation base surface |
| `--main-surface-secondary` | `var(--gray-50)` | `var(--gray-750)` | Secondary blocks/code bg |

## Layout Model

```css
/* Use as behavioral reference, not a copy-paste production stylesheet. */
.chatgpt-thread {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  color: var(--text-primary);
  background: var(--bg-primary);
}

.chatgpt-message-row {
  width: 100%;
  padding-inline: 1rem;
}

.chatgpt-message-content {
  max-width: 48rem;
  margin-inline: auto;
}

.chatgpt-user-bubble {
  width: fit-content;
  max-width: min(70%, 38rem);
  margin-left: auto;
  border-radius: 1.5rem;
  padding: .625rem 1rem;
  color: var(--default-theme-user-msg-text);
  background: var(--default-theme-user-msg-bg);
}
```

## Prose Rules

The loaded ChatGPT CSS uses Tailwind Typography-style `.prose` rules. Preserve these behaviors when translating copied assistant-message HTML:

```css
.prose {
  max-width: 65ch;
  color: var(--tw-prose-body);
}

.prose a {
  color: var(--tw-prose-links);
  font-weight: 500;
}

.prose strong,
.prose dt {
  color: var(--tw-prose-bold);
  font-weight: 600;
}

.prose blockquote {
  color: var(--tw-prose-quotes);
  font-weight: 500;
}

.prose h1 {
  color: var(--tw-prose-headings);
  font-size: 2.25em;
  font-weight: 800;
  line-height: 1.11111;
}

.prose [class~="lead"] {
  color: var(--tw-prose-lead);
  font-size: 1.25em;
  line-height: 1.6;
}
```

## Practical Translation Rules

- Assistant messages are usually unboxed prose on the main surface.
- User messages use the message surface as a rounded bubble aligned to the right.
- Keep message text at 16px / 24px unless the copied HTML clearly uses a smaller utility.
- Keep prose width constrained; do not stretch assistant markdown across the full viewport.
- For markdown children, preserve vertical rhythm more than exact generated class names.
- Use local code-block/table components where available, but keep ChatGPT's subtle borders and secondary surfaces.

## Responsive Notes

- Desktop conversation examples in this folder were captured around 1609px viewport width.
- Mobile examples were captured around 390px width.
- On narrow screens, message content should keep side padding and allow user bubbles to use more horizontal space without touching viewport edges.
- The prompt composer remains visually tied to the message column; do not let conversation width and composer width diverge without a deliberate reason.
