import {
  composerEntityPillToDOM,
  parseComposerEntityPill,
} from "@/components/ui/composer-entity-pill"
import { Schema, type Node as ProseMirrorNode } from "prosemirror-model"
import { TextSelection } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"

/**
 * The Composer's document model and plain-text boundary: the schema, the
 * string↔document serializers, and the text-offset↔position mapping that
 * keeps the editor's controlled `value` contract entity-free.
 */

export type PromptInputEntity = Readonly<{
  id: string
  /** "capability" renders as an ecosystemMention pill and "tool" as a
   * skillMention pill. */
  kind: "capability" | "tool"
  label: string
  /** Connector-style pills carry an icon image; built-in capabilities without
   * one fall back to the web-search glyph. */
  iconUrl?: string | null
  /** False for status entities that are visible but cannot be removed. */
  removable?: boolean
}>

const promptInputSchema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", { dir: "auto" }, 0],
    },
    composerEntityCursorTarget: {
      atom: true,
      attrs: {
        entityId: { validate: "string" },
      },
      group: "inline",
      inline: true,
      parseDOM: [
        {
          tag: "span[data-inline-selection-pill-cursor-target]",
          getAttrs: () => ({ entityId: "" }),
        },
      ],
      selectable: false,
      toDOM: (node) => [
        "span",
        {
          "aria-hidden": "true",
          contenteditable: "false",
          "data-inline-selection-pill-cursor-target": "",
        },
        "\uFEFF",
      ],
    },
    composerEntity: {
      atom: true,
      attrs: {
        id: { validate: "string" },
        kind: { validate: "string" },
        label: { validate: "string" },
        iconUrl: { default: null },
        removable: { default: true },
      },
      group: "inline",
      inline: true,
      parseDOM: [
        {
          tag: "span[data-inline-selection-pill]",
          getAttrs: parseComposerEntityPill,
        },
      ],
      selectable: false,
      toDOM: composerEntityPillToDOM,
    },
    text: { group: "inline" },
  },
})

function createPromptInputDocument(
  value: string,
  entities: readonly PromptInputEntity[] = []
) {
  const paragraphs = value.split("\n").map((line, index) => {
    const content = [
      ...(index === 0
        ? entities.flatMap((entity) => [
            promptInputSchema.nodes.composerEntityCursorTarget.create({
              entityId: entity.id,
            }),
            promptInputSchema.nodes.composerEntity.create(entity),
            promptInputSchema.text(" "),
          ])
        : []),
      ...(line ? [promptInputSchema.text(line)] : []),
    ]

    return promptInputSchema.nodes.paragraph.create(
      null,
      content.length > 0 ? content : undefined
    )
  })
  return promptInputSchema.nodes.doc.create(null, paragraphs)
}

function readPromptInputDocument(document: ProseMirrorNode) {
  const paragraphs: string[] = []
  document.forEach((node) => {
    let text = ""
    let expectsEntitySpacer = false
    node.forEach((child) => {
      if (child.type === promptInputSchema.nodes.composerEntity) {
        expectsEntitySpacer = true
        return
      }
      if (!child.isText) return
      const childText = child.text ?? ""
      if (expectsEntitySpacer && childText.startsWith(" ")) {
        text += childText.slice(1)
      } else {
        text += childText
      }
      expectsEntitySpacer = false
    })
    paragraphs.push(text)
  })
  return paragraphs.join("\n")
}

function readPromptInputEntities(document: ProseMirrorNode) {
  const entities: PromptInputEntity[] = []
  document.descendants((node) => {
    if (node.type !== promptInputSchema.nodes.composerEntity) return true
    entities.push({
      id: node.attrs.id,
      kind: node.attrs.kind,
      label: node.attrs.label,
      iconUrl: node.attrs.iconUrl ?? null,
      ...(node.attrs.removable === false ? { removable: false } : {}),
    })
    return false
  })
  return entities
}

function promptInputEntitiesEqual(
  left: readonly PromptInputEntity[],
  right: readonly PromptInputEntity[]
) {
  return (
    left.length === right.length &&
    left.every(
      (entity, index) =>
        entity.id === right[index]?.id &&
        entity.kind === right[index]?.kind &&
        entity.label === right[index]?.label &&
        (entity.iconUrl ?? null) === (right[index]?.iconUrl ?? null) &&
        (entity.removable ?? true) === (right[index]?.removable ?? true)
    )
  )
}

function textOffsetToDocumentPosition(
  document: ProseMirrorNode,
  offset: number
) {
  const requested = Math.max(0, offset)
  let textOffset = 0
  let resolved = 1

  document.forEach((paragraph, paragraphOffset, index) => {
    if (textOffset > requested) return
    let paragraphTextLength = 0
    let expectsEntitySpacer = false
    paragraph.forEach((child) => {
      if (child.type === promptInputSchema.nodes.composerEntity) {
        expectsEntitySpacer = true
        return
      }
      if (!child.isText) return
      const childText = child.text ?? ""
      paragraphTextLength +=
        childText.length -
        (expectsEntitySpacer && childText.startsWith(" ") ? 1 : 0)
      expectsEntitySpacer = false
    })
    const paragraphEnd = textOffset + paragraphTextLength
    if (requested <= paragraphEnd) {
      const paragraphTextOffset = requested - textOffset
      let consumedText = 0
      let expectsEntitySpacer = false
      resolved = paragraphOffset + 1 + paragraph.content.size
      paragraph.forEach((child, childOffset) => {
        if (child.type === promptInputSchema.nodes.composerEntity) {
          expectsEntitySpacer = true
          return
        }
        if (!child.isText || consumedText > paragraphTextOffset) return
        const childTextLength = child.text?.length ?? 0
        const skippedEntitySpacers =
          expectsEntitySpacer && child.text?.startsWith(" ") ? 1 : 0
        expectsEntitySpacer = false
        const editableTextLength = childTextLength - skippedEntitySpacers
        if (paragraphTextOffset <= consumedText + editableTextLength) {
          resolved =
            paragraphOffset +
            1 +
            childOffset +
            skippedEntitySpacers +
            paragraphTextOffset -
            consumedText
          consumedText = Number.POSITIVE_INFINITY
          return
        }
        consumedText += editableTextLength
      })
      textOffset = Number.POSITIVE_INFINITY
      return
    }
    textOffset = paragraphEnd + (index < document.childCount - 1 ? 1 : 0)
    resolved = paragraphOffset + paragraph.nodeSize
  })

  return Math.min(Math.max(1, resolved), Math.max(1, document.content.size - 1))
}

function replacePromptInputDocument(
  view: EditorView,
  value: string,
  entities: readonly PromptInputEntity[] = []
) {
  if (
    readPromptInputDocument(view.state.doc) === value &&
    promptInputEntitiesEqual(readPromptInputEntities(view.state.doc), entities)
  ) {
    return false
  }

  const nextDocument = createPromptInputDocument(value, entities)
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

export {
  createPromptInputDocument,
  promptInputEntitiesEqual,
  promptInputSchema,
  readPromptInputDocument,
  readPromptInputEntities,
  replacePromptInputDocument,
  setPromptInputSelection,
  textOffsetToDocumentPosition,
}
