import { WEB_SEARCH_GLOBE_PATH } from "@/lib/icons/composer"
import { baseKeymap, splitBlock } from "prosemirror-commands"
import { closeHistory, history, redo, undo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import {
  Fragment,
  Schema,
  type Node as ProseMirrorNode,
} from "prosemirror-model"
import {
  Plugin,
  TextSelection,
  type EditorState,
  type Transaction,
} from "prosemirror-state"
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view"

export type PromptInputEntity = Readonly<{
  id: string
  kind: "capability"
  label: string
}>

export type PromptInputActionQuery = Readonly<{
  id: number
  from: number
  to: number
  query: string
}>

type PromptInputActionQueryRange = Omit<PromptInputActionQuery, "id">

const selectedEntityClassName =
  "data-[inline-selection-pill-selected]:bg-(--composer-selection-background) selection:bg-transparent selection:text-inherit"

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
      },
      group: "inline",
      inline: true,
      parseDOM: [
        {
          tag: "span[data-inline-selection-pill]",
          getAttrs: (node) => {
            if (!(node instanceof HTMLElement)) return false
            const id = node.dataset.id
            const label = node.dataset.keyword
            if (!id || !label) return false
            return { id, kind: "capability", label }
          },
        },
      ],
      selectable: false,
      toDOM: (node) => [
        "span",
        {
          class:
            "text-composer-capability-accent hover:text-composer-capability-accent not-data-[inline-selection-pill-selected]:hover:bg-transparent data-[inline-file-previewable]:cursor-pointer data-[system-hint-type=glaux]:cursor-pointer data-[system-hint-type=glaux]:rounded-md data-[system-hint-type=glaux]:transition-colors data-[system-hint-type=glaux]:not-data-[inline-selection-pill-selected]:hover:bg-interactive-hover inline-flex min-w-0 cursor-text items-center gap-1 whitespace-nowrap rounded-none bg-transparent px-1 py-0 align-baseline",
          contenteditable: "false",
          "data-id": node.attrs.id === "web-search" ? "search" : node.attrs.id,
          "data-inline-selection-pill": "",
          "data-keyword": node.attrs.label,
          "data-symbol": "ecosystemMention",
          "data-system-hint-type":
            node.attrs.id === "web-search" ? "search" : "capability",
          dir: "auto",
        },
        [
          "http://www.w3.org/2000/svg svg",
          {
            "aria-hidden": "true",
            class: "h-5 w-5 shrink-0",
            fill: "none",
            height: "24",
            viewBox: "0 0 24 24",
            width: "24",
          },
          [
            "g",
            {},
            [
              "circle",
              {
                cx: "12",
                cy: "12",
                fill: "var(--web-search-icon-surface)",
                r: "9",
              },
            ],
            [
              "path",
              {
                "clip-rule": "evenodd",
                d: WEB_SEARCH_GLOBE_PATH,
                fill: "var(--web-search-icon-foreground)",
                "fill-rule": "evenodd",
              },
            ],
          ],
        ],
        [
          "span",
          { class: "max-w-[16rem] self-baseline truncate" },
          node.attrs.label,
        ],
      ],
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
        entity.label === right[index]?.label
    )
  )
}

function getPromptInputEntitySelectionDecorations(state: EditorState) {
  const decorations: Decoration[] = []
  if (state.selection.empty) {
    const entity = state.selection.$from.nodeBefore
    if (
      entity?.type === promptInputSchema.nodes.composerEntity &&
      state.selection.$from.nodeAfter === null
    ) {
      decorations.push(
        Decoration.widget(
          state.selection.from,
          () => {
            const cursorTarget = document.createElement("span")
            cursorTarget.ariaHidden = "true"
            cursorTarget.contentEditable = "false"
            cursorTarget.dataset.inlineSelectionPillCursorTarget = ""
            cursorTarget.textContent = "\uFEFF"
            return cursorTarget
          },
          {
            key: `composer-entity-cursor-target:${entity.attrs.id}`,
            raw: true,
            side: 1,
          }
        )
      )
    }
  } else {
    state.doc.nodesBetween(
      state.selection.from,
      state.selection.to,
      (node, pos) => {
        if (
          node.type === promptInputSchema.nodes.composerEntity &&
          state.selection.from <= pos &&
          state.selection.to >= pos + node.nodeSize
        ) {
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: selectedEntityClassName,
              "data-inline-selection-pill-selected": "",
            })
          )
        }
      }
    )
  }

  return decorations.length > 0
    ? DecorationSet.create(state.doc, decorations)
    : null
}

function readPromptInputActionQuery(
  state: EditorState
): PromptInputActionQueryRange | null {
  if (!state.selection.empty || !state.selection.$from.parent.isTextblock) {
    return null
  }

  const textBeforeCursor = state.selection.$from.parent.textBetween(
    0,
    state.selection.$from.parentOffset,
    undefined,
    "\uFFFC"
  )
  const match = /(?:^|\s)@([^\s@]*)$/.exec(textBeforeCursor)
  if (!match) return null

  const query = match[1] ?? ""
  const triggerLength = query.length + 1
  return {
    from: state.selection.from - triggerLength,
    to: state.selection.from,
    query,
  }
}

function replacePromptInputActionQuery(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  actionQuery: PromptInputActionQuery,
  entity?: PromptInputEntity
) {
  const currentQuery = readPromptInputActionQuery(state)
  if (
    !currentQuery ||
    currentQuery.from !== actionQuery.from ||
    currentQuery.to !== actionQuery.to ||
    currentQuery.query !== actionQuery.query
  ) {
    return false
  }

  const transaction = state.tr
  if (!entity) {
    transaction.delete(currentQuery.from, currentQuery.to)
    transaction.setSelection(
      TextSelection.create(transaction.doc, currentQuery.from)
    )
  } else {
    const replacement = Fragment.fromArray([
      promptInputSchema.nodes.composerEntityCursorTarget.create({
        entityId: entity.id,
      }),
      promptInputSchema.nodes.composerEntity.create(entity),
      promptInputSchema.text(" "),
    ])
    transaction.replaceWith(currentQuery.from, currentQuery.to, replacement)
    transaction.setSelection(
      TextSelection.create(transaction.doc, currentQuery.from + replacement.size)
    )
  }

  dispatch(closeHistory(transaction).scrollIntoView())
  return true
}

function getEntityDeletionRange(
  state: EditorState,
  entityPos: number,
  entity: ProseMirrorNode
) {
  let from = entityPos
  let to = entityPos + entity.nodeSize
  const before = state.doc.resolve(entityPos).nodeBefore
  if (
    before?.type === promptInputSchema.nodes.composerEntityCursorTarget &&
    before.attrs.entityId === entity.attrs.id
  ) {
    from -= before.nodeSize
  }

  const after = state.doc.resolve(to).nodeAfter
  if (after?.isText && after.text?.startsWith(" ")) {
    to += 1
  }
  return { from, to }
}

function deleteSelectedComposerEntities(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void
) {
  if (state.selection.empty) return false

  const ranges: Array<{ from: number; to: number }> = []
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (
      node.type === promptInputSchema.nodes.composerEntity &&
      state.selection.from <= pos &&
      state.selection.to >= pos + node.nodeSize
    ) {
      ranges.push(getEntityDeletionRange(state, pos, node))
    }
  })
  if (ranges.length === 0) return false

  if (dispatch) {
    const transaction = state.tr
    for (const range of ranges.toSorted((left, right) => right.from - left.from)) {
      transaction.delete(range.from, range.to)
    }
    dispatch(transaction.scrollIntoView())
  }
  return true
}

function deleteComposerEntityBackward(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void
) {
  if (deleteSelectedComposerEntities(state, dispatch)) return true
  if (!state.selection.empty) return false

  const entity = state.selection.$from.nodeBefore
  if (entity?.type !== promptInputSchema.nodes.composerEntity) return false
  const entityPos = state.selection.from - entity.nodeSize
  const range = getEntityDeletionRange(state, entityPos, entity)
  dispatch?.(state.tr.delete(range.from, range.to).scrollIntoView())
  return true
}

function deleteComposerEntityForward(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void
) {
  if (deleteSelectedComposerEntities(state, dispatch)) return true
  if (!state.selection.empty) return false

  const target = state.selection.$from.nodeAfter
  if (
    target?.type !== promptInputSchema.nodes.composerEntityCursorTarget
  ) {
    return false
  }
  const entityPos = state.selection.from + target.nodeSize
  const entity = state.doc.resolve(entityPos).nodeAfter
  if (
    entity?.type !== promptInputSchema.nodes.composerEntity ||
    entity.attrs.id !== target.attrs.entityId
  ) {
    return false
  }

  const range = getEntityDeletionRange(state, entityPos, entity)
  dispatch?.(state.tr.delete(range.from, range.to).scrollIntoView())
  return true
}

function normalizeComposerEntityStructure(
  transactions: readonly { docChanged: boolean }[],
  _oldState: EditorState,
  newState: EditorState
) {
  if (!transactions.some((transaction) => transaction.docChanged)) return null

  const operations: Array<
    | { kind: "delete"; from: number; to: number }
    | { kind: "insert"; pos: number; node: ProseMirrorNode }
  > = []

  newState.doc.forEach((paragraph, paragraphOffset) => {
    paragraph.forEach((node, childOffset, index) => {
      const pos = paragraphOffset + 1 + childOffset
      if (
        node.type === promptInputSchema.nodes.composerEntityCursorTarget
      ) {
        const entity =
          index + 1 < paragraph.childCount ? paragraph.child(index + 1) : null
        if (
          entity?.type !== promptInputSchema.nodes.composerEntity ||
          entity.attrs.id !== node.attrs.entityId
        ) {
          operations.push({ kind: "delete", from: pos, to: pos + node.nodeSize })
        }
        return
      }

      if (node.type !== promptInputSchema.nodes.composerEntity) return
      const target = index > 0 ? paragraph.child(index - 1) : null
      if (
        target?.type !== promptInputSchema.nodes.composerEntityCursorTarget ||
        target.attrs.entityId !== node.attrs.id
      ) {
        operations.push({
          kind: "insert",
          pos,
          node: promptInputSchema.nodes.composerEntityCursorTarget.create({
            entityId: node.attrs.id,
          }),
        })
      }

    })
  })

  if (operations.length === 0) return null
  const transaction = newState.tr
  for (const operation of operations.toSorted((left, right) => {
    const leftPos = left.kind === "delete" ? left.from : left.pos
    const rightPos = right.kind === "delete" ? right.from : right.pos
    return rightPos - leftPos
  })) {
    if (operation.kind === "delete") {
      transaction.delete(operation.from, operation.to)
    } else {
      transaction.insert(operation.pos, operation.node)
    }
  }
  return transaction
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
  const entitySelectionPlugin = new Plugin({
    props: {
      decorations: getPromptInputEntitySelectionDecorations,
    },
  })
  const entityStructurePlugin = new Plugin({
    appendTransaction: normalizeComposerEntityStructure,
  })

  return [
    history(),
    placeholderPlugin,
    entitySelectionPlugin,
    entityStructurePlugin,
    keymap({
      Backspace: deleteComposerEntityBackward,
      Delete: deleteComposerEntityForward,
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
  deleteComposerEntityBackward,
  deleteComposerEntityForward,
  getPromptInputEntitySelectionDecorations,
  promptInputEntitiesEqual,
  promptInputSchema,
  readPromptInputActionQuery,
  readPromptInputDocument,
  readPromptInputEntities,
  replacePromptInputActionQuery,
  replacePromptInputDocument,
  setPromptInputSelection,
}
