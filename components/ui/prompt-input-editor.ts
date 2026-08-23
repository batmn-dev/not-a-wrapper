import { baseKeymap, splitBlock } from "prosemirror-commands"
import { history, redo, undo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { Schema, type Node as ProseMirrorNode } from "prosemirror-model"
import { Plugin, TextSelection, type EditorState } from "prosemirror-state"
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view"

const promptInputSchema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      content: "text*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", { dir: "auto" }, 0],
    },
    text: { group: "inline" },
  },
})

function createPromptInputDocument(value: string) {
  const paragraphs = value.split("\n").map((line) =>
    promptInputSchema.nodes.paragraph.create(
      null,
      line ? promptInputSchema.text(line) : undefined
    )
  )
  return promptInputSchema.nodes.doc.create(null, paragraphs)
}

function readPromptInputDocument(document: ProseMirrorNode) {
  const paragraphs: string[] = []
  document.forEach((node) => paragraphs.push(node.textContent))
  return paragraphs.join("\n")
}

function textOffsetToDocumentPosition(document: ProseMirrorNode, offset: number) {
  const requested = Math.max(0, offset)
  let textOffset = 0
  let resolved = 1

  document.forEach((paragraph, paragraphOffset, index) => {
    if (textOffset > requested) return
    const paragraphEnd = textOffset + paragraph.textContent.length
    if (requested <= paragraphEnd) {
      resolved = paragraphOffset + 1 + requested - textOffset
      textOffset = Number.POSITIVE_INFINITY
      return
    }
    textOffset = paragraphEnd + (index < document.childCount - 1 ? 1 : 0)
    resolved = paragraphOffset + paragraph.nodeSize
  })

  return Math.min(
    Math.max(1, resolved),
    Math.max(1, document.content.size - 1)
  )
}

function replacePromptInputDocument(view: EditorView, value: string) {
  if (readPromptInputDocument(view.state.doc) === value) return false

  const nextDocument = createPromptInputDocument(value)
  const transaction = view.state.tr
    .replaceWith(0, view.state.doc.content.size, nextDocument.content)
    .setMeta("addToHistory", false)
    .setMeta("externalValue", true)
  const cursor = textOffsetToDocumentPosition(nextDocument, value.length)
  transaction.setSelection(TextSelection.create(transaction.doc, cursor))
  view.dispatch(transaction)
  return true
}

function setPromptInputSelection(
  view: EditorView,
  selectionStart: number,
  selectionEnd: number
) {
  const anchor = textOffsetToDocumentPosition(view.state.doc, selectionStart)
  const head = textOffsetToDocumentPosition(view.state.doc, selectionEnd)
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, anchor, head))
      .scrollIntoView()
  )
}

function createPromptInputPlugins(placeholder: () => string | undefined) {
  const placeholderPlugin = new Plugin({
    props: {
      decorations(state: EditorState) {
        const paragraph = state.doc.firstChild
        if (
          !paragraph ||
          state.doc.childCount !== 1 ||
          paragraph.content.size !== 0
        ) {
          return null
        }

        return DecorationSet.create(state.doc, [
          Decoration.node(0, paragraph.nodeSize, {
            class: "placeholder",
            "data-empty-paragraph": "true",
            "data-placeholder": placeholder() ?? "",
          }),
        ])
      },
    },
  })

  return [
    history(),
    placeholderPlugin,
    keymap({
      "Mod-y": redo,
      "Mod-z": undo,
      "Shift-Enter": splitBlock,
      "Shift-Mod-z": redo,
    }),
    keymap(baseKeymap),
  ]
}

export {
  createPromptInputDocument,
  createPromptInputPlugins,
  promptInputSchema,
  readPromptInputDocument,
  replacePromptInputDocument,
  setPromptInputSelection,
}
