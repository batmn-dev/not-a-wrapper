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
renders a ProseMirror editor backed by a deliberately small schema: document,
paragraph, text, and protected typed inline entities. Paragraph boundaries
serialize to `\n`; entity atoms are presentation projections of typed Composer
capabilities and never enter submitted text. Composer, draft persistence,
attachment handling, and Chat turn payloads therefore continue to own ordinary
strings. The editor exposes only the imperative focus and selection commands
Composer already requires.

The EditorView owns its DOM through a callback ref and is synchronized before
paint through the repository's browser-layout lifecycle. Input transactions
write through the existing `onValueChange` port. External draft changes replace
the editor document without entering undo history. No React `useEffect` or
timeout coordinates editor state.

Capability entities retain ChatGPT's sibling DOM projection: an invisible
leading cursor-target node, one protected entity atom, and an initial
structural spacer. Deleting the spacer exposes a trailing cursor-target widget
decoration at the collapsed selection; the next Backspace deletes the complete
entity without requiring ArrowLeft, while typed input replaces that decorated
boundary. Keeping the trailing target outside the document also groups both
Backspaces into one history event. A ProseMirror keymap deletes the structure
atomically, an appended transaction normalizes orphaned leading boundaries,
and the history plugin restores the initial entity plus spacer. Selection
decorations project native range selection onto the atom with
`data-inline-selection-pill-selected`; React does not mirror editor selection.
The editor also derives a typed `@query` from the collapsed ProseMirror
selection. A query begins only at a text boundary, stays in one editor-owned
session while its text changes, and is replaced by an action result in one
transaction. Composer presents that query through the shared action registry;
Escape dismisses the current session without changing text or focus, and a new
session can open discovery again. This keeps keyboard filtering, activation,
undo, and entity insertion on the same document transaction boundary.

ProseMirror's raw-widget separator image is hidden inside the editor scope. It
is a cursor-addressing sentinel, not content; allowing the global image reset
to make it block-level would add a false line while deleting an entity spacer.

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
- Rich marks and block types are intentionally unavailable. Typed atom entities
  may project Composer capabilities without expanding the plain-string Chat
  turn contract.
- Capability selection, deletion, and undo remain Editor transactions, so the
  typed Composer state and protected DOM cannot diverge.
- `prosemirror-model`, `prosemirror-state`, `prosemirror-view`, commands,
  keymap, and history are direct client dependencies.
