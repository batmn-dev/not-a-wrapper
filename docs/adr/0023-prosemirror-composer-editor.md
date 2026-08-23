# ADR 0023: ProseMirror owns the composer editing DOM

## Status

Accepted.

## Context

The Composer owns a plain-string draft, attachment capture, and the complete
Chat turn payload. Its textarea duplicated browser-sensitive editing work for
multiline DOM, selection restoration, IME composition, paste normalization,
and external draft replacement. ChatGPT instead keeps a stable ProseMirror
contenteditable as the primary editor with a non-interactive textarea fallback.

## Decision

`PromptInputTextarea` keeps its public component name for compatibility but
renders a ProseMirror editor backed by a deliberately plain schema: document,
paragraph, and text only. Paragraph boundaries serialize to `\n`, so Composer,
draft persistence, attachment handling, and Chat turn payloads continue to own
ordinary strings. The editor exposes only the imperative focus and selection
commands Composer already requires.

The EditorView owns its DOM through a callback ref and is synchronized before
paint through the repository's browser-layout lifecycle. Input transactions
write through the existing `onValueChange` port. External draft changes replace
the editor document without entering undo history. No React `useEffect` or
timeout coordinates editor state.

A `display: none` textarea with ChatGPT's fallback field attributes remains
beside the contenteditable. The app also clones it transiently as the
source-parity measurement surface for the existing bounded multiline expansion
calculation.

## Alternatives considered

- Keep the native textarea. Rejected because it cannot preserve ChatGPT's
  stable editor DOM and paragraph model across controlled draft replacement.
- Build a hand-rolled contenteditable. Rejected because IME, undo, selection,
  paste, and browser mutation reconciliation would become local editor code.
- Adopt a richer editor framework such as Tiptap or Lexical. Rejected because
  the product contract is still a plain string and those layers add schema and
  UI surface the composer does not need.

## Consequences

- Chat data and turn contracts do not change.
- The contenteditable DOM and selection survive controlled value updates.
- Undo, IME, paragraph editing, and browser mutation reconciliation come from
  ProseMirror instead of local DOM code.
- Rich marks and block types are intentionally unavailable until a separate
  product decision expands the plain-string Chat turn contract.
- `prosemirror-model`, `prosemirror-state`, `prosemirror-view`, commands,
  keymap, and history are direct client dependencies.
