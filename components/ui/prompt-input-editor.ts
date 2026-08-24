import { RI_GLOBAL_LINE_PATH } from "@/lib/icons/composer"
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
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "prosemirror-state"
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view"

export type PromptInputEntity = Readonly<{
  id: string
  /** ChatGPT's mention kinds: "capability" renders as an ecosystemMention
   * pill, "tool" as a skillMention pill. */
  kind: "capability" | "tool"
  label: string
  /** Connector-style pills carry an icon image (ChatGPT's iconUrl); built-in
   * capabilities without one fall back to the web-search glyph. */
  iconUrl?: string | null
}>

export type PromptInputActionQueryTrigger = "@" | "+" | "/"

export type PromptInputActionQuery = Readonly<{
  id: number
  from: number
  to: number
  query: string
  trigger: PromptInputActionQueryTrigger
  /** True when the session was opened by UI (the + button) rather than a
   * typed trigger character, so no trigger symbol exists in the document. */
  isSynthetic: boolean
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
        iconUrl: { default: null },
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
            return {
              id,
              kind: node.dataset.symbol === "skillMention"
                ? "tool"
                : "capability",
              label,
              iconUrl: node.querySelector("img")?.getAttribute("src") ?? null,
            }
          },
        },
      ],
      selectable: false,
      // ChatGPT's mention pill contract (captured + measured live 2026-08-24):
      // connector-style mentions render an <img> icon in a 5×5 rounded-sm
      // wrapper with the raw id as data-system-hint-type, and their icon+label
      // sit inside an inner anchor whose RENDERED color is primary text — the
      // pill root stays accent, but `.prosemirror-parent a { color:
      // var(--text-primary) }` overrides the anchor's text-inherit. We have no
      // plugin detail pages, so the inner wrapper is a span carrying that
      // rendered result. Built-ins (web-search) keep the flat accent layout
      // with an inline glyph, and "tool" mentions carry
      // data-symbol="skillMention".
      toDOM: (node) => {
        const rootAttrs = {
          class:
            "text-composer-capability-accent hover:text-composer-capability-accent not-data-[inline-selection-pill-selected]:hover:bg-transparent data-[inline-file-previewable]:cursor-pointer data-[system-hint-type=glaux]:cursor-pointer data-[system-hint-type=glaux]:rounded-md data-[system-hint-type=glaux]:transition-colors data-[system-hint-type=glaux]:not-data-[inline-selection-pill-selected]:hover:bg-interactive-hover inline-flex min-w-0 cursor-text items-center gap-1 whitespace-nowrap rounded-none bg-transparent px-1 py-0 align-baseline",
          contenteditable: "false",
          "data-id": node.attrs.id === "web-search" ? "search" : node.attrs.id,
          "data-inline-selection-pill": "",
          "data-keyword": node.attrs.label,
          "data-symbol":
            node.attrs.kind === "tool" ? "skillMention" : "ecosystemMention",
          "data-system-hint-type":
            node.attrs.id === "web-search" ? "search" : node.attrs.id,
          dir: "auto",
        }
        const labelSpec = [
          "span",
          { class: "max-w-[16rem] self-baseline truncate" },
          node.attrs.label,
        ]

        if (node.attrs.iconUrl) {
          return [
            "span",
            rootAttrs,
            [
              "span",
              {
                class:
                  "text-foreground inline-flex min-w-0 items-center gap-1 rounded-sm",
              },
              [
                "span",
                {
                  "aria-hidden": "true",
                  // ChatGPT's icon wrapper computes to 4px; our rounded-sm
                  // token is 6px, so the literal is pinned deliberately.
                  class:
                    "relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[4px]",
                },
                [
                  "img",
                  {
                    alt: "",
                    class: "size-full object-cover",
                    src: node.attrs.iconUrl,
                  },
                ],
              ],
              labelSpec,
            ],
          ]
        }

        return [
          "span",
          rootAttrs,
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
              "path",
              {
                d: RI_GLOBAL_LINE_PATH,
                fill: "var(--web-search-icon-foreground)",
              },
            ],
          ],
          labelSpec,
        ]
      },
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
        (entity.iconUrl ?? null) === (right[index]?.iconUrl ?? null)
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

/** Slash commands keep ChatGPT's space-terminated grammar: the query ends at
 * the first whitespace, unlike "@" mentions whose query is the raw tail. */
const slashQueryPattern = /(?:^|\s)\/([\p{L}\p{N}\p{M}.:_-]*)$/u

/** ChatGPT parity: the mention trigger is the LAST "@" or "+" that starts a
 * word (start of the text run or after whitespace) and is not immediately
 * followed by whitespace unless the caret sits right after it. The query is
 * the raw tail after that trigger, so it may contain spaces. */
function findMentionTrigger(text: string) {
  let triggerIndex = -1
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (
      (character === "@" || character === "+") &&
      (index === 0 || /\s/u.test(text[index - 1] ?? "")) &&
      (index === text.length - 1 || !/\s/u.test(text[index + 1] ?? ""))
    ) {
      triggerIndex = index
    }
  }
  if (triggerIndex < 0) return null
  return {
    index: triggerIndex,
    trigger: text[triggerIndex] as "@" | "+",
    query: text.slice(triggerIndex + 1),
  }
}

function findLastSlashTriggerIndex(text: string) {
  let triggerIndex = -1
  for (let index = 0; index < text.length; index += 1) {
    if (
      text[index] === "/" &&
      (index === 0 || /\s/u.test(text[index - 1] ?? "")) &&
      (index === 0 ||
        index === text.length - 1 ||
        !/\s/u.test(text[index + 1] ?? ""))
    ) {
      triggerIndex = index
    }
  }
  return triggerIndex
}

type TypedActionQuery = Readonly<{
  trigger: PromptInputActionQueryTrigger
  query: string
  from: number
  to: number
}>

function readTypedActionQuery(
  $from: EditorState["selection"]["$from"]
): TypedActionQuery | null {
  if ($from.depth === 0) return null
  const text = $from.nodeBefore?.text
  if (text == null || text.includes("\n") || text.includes("\r")) return null

  const mention = findMentionTrigger(text)
  const slashTriggerIndex = findLastSlashTriggerIndex(text)
  const slashMatch = slashQueryPattern.exec(text)
  const slash = slashMatch
    ? {
        index: text.length - (slashMatch[1]?.length ?? 0) - 1,
        query: slashMatch[1] ?? "",
      }
    : null

  // ChatGPT parity: a "/" that starts a word later than the "@" trigger owns
  // the tail — when its space-terminated query no longer matches, NOTHING
  // matches (the stale slash blocks the earlier mention).
  const mentionIndex = mention?.index ?? -1
  if (slashTriggerIndex > mentionIndex) {
    if (slash == null || slash.index !== slashTriggerIndex) return null
    return {
      trigger: "/",
      query: slash.query,
      from: $from.pos - slash.query.length - 1,
      to: $from.pos,
    }
  }
  if (!mention) return null
  return {
    trigger: mention.trigger,
    query: mention.query,
    from: $from.pos - mention.query.length - 1,
    to: $from.pos,
  }
}

function readPromptInputActionQuery(
  state: EditorState
): PromptInputActionQueryRange | null {
  if (!state.selection.empty) return null
  const typed = readTypedActionQuery(state.selection.$from)
  if (!typed) return null
  return {
    from: typed.from,
    to: typed.to,
    query: typed.query,
    trigger: typed.trigger,
    isSynthetic: false,
  }
}

/**
 * The action-query session state machine, ported from ChatGPT's
 * systemHintPlugin. Typed sessions re-evaluate only on document changes at an
 * empty selection; synthetic sessions (opened by the + button) track a mapped
 * anchor on every transaction, adopt a typed trigger that appears at or after
 * the anchor, and close on newline, a caret before the anchor, or a changed
 * range selection.
 */
type PromptInputActionQuerySessionState = Readonly<{
  active: boolean
  trigger: PromptInputActionQueryTrigger
  query: string
  range: { from: number; to: number } | null
  isSynthetic: boolean
}>

type PromptInputActionQueryMeta =
  | { readonly toggleSynthetic: true }
  | { readonly close: true }

const inactiveActionQuerySession: PromptInputActionQuerySessionState = {
  active: false,
  trigger: "@",
  query: "",
  range: null,
  isSynthetic: false,
}

const promptInputActionQueryPluginKey =
  new PluginKey<PromptInputActionQuerySessionState>("promptInputActionQuery")

function createActionQueryPlugin() {
  return new Plugin<PromptInputActionQuerySessionState>({
    key: promptInputActionQueryPluginKey,
    state: {
      init: () => inactiveActionQuerySession,
      apply(transaction, previous, oldState, newState) {
        const meta = transaction.getMeta(promptInputActionQueryPluginKey) as
          | PromptInputActionQueryMeta
          | undefined
        if (meta && "close" in meta) return inactiveActionQuerySession
        if (meta && "toggleSynthetic" in meta) {
          if (previous.active && previous.isSynthetic) {
            return inactiveActionQuerySession
          }
          const caret = newState.selection.from
          return {
            active: true,
            trigger: "@",
            query: "",
            range: { from: caret, to: caret },
            isSynthetic: true,
          }
        }
        if (transaction.getMeta("externalValue")) {
          return inactiveActionQuerySession
        }

        const selection = newState.selection
        if (previous.isSynthetic && previous.range) {
          const anchor = transaction.mapping.map(previous.range.from, -1)
          if (
            (!selection.empty && !selection.eq(oldState.selection)) ||
            selection.from < anchor
          ) {
            return inactiveActionQuerySession
          }
          const typed = readTypedActionQuery(selection.$from)
          if (typed && typed.from >= anchor) {
            return {
              active: true,
              trigger: typed.trigger,
              query: typed.query,
              range: { from: typed.from, to: typed.to },
              isSynthetic: false,
            }
          }
          const text = newState.doc.textBetween(
            anchor,
            selection.from,
            "\n",
            "\n"
          )
          if (text.includes("\n")) return inactiveActionQuerySession
          return {
            active: true,
            trigger: previous.trigger,
            query: text,
            range: { from: anchor, to: selection.from },
            isSynthetic: true,
          }
        }

        if (!selection.empty || newState.doc.eq(oldState.doc)) {
          return previous
        }
        const typed = readTypedActionQuery(selection.$from)
        if (!typed) {
          return previous.active ? inactiveActionQuerySession : previous
        }
        return {
          active: true,
          trigger: typed.trigger,
          query: typed.query,
          range: { from: typed.from, to: typed.to },
          isSynthetic: false,
        }
      },
    },
  })
}

function readPromptInputActionQuerySession(state: EditorState) {
  return (
    promptInputActionQueryPluginKey.getState(state) ??
    inactiveActionQuerySession
  )
}

function toggleSyntheticPromptInputActionQuery(
  state: EditorState,
  dispatch: (transaction: Transaction) => void
) {
  dispatch(
    state.tr.setMeta(promptInputActionQueryPluginKey, { toggleSynthetic: true })
  )
}

function endPromptInputActionQuery(
  state: EditorState,
  dispatch: (transaction: Transaction) => void
) {
  dispatch(state.tr.setMeta(promptInputActionQueryPluginKey, { close: true }))
}

function replacePromptInputActionQuery(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  actionQuery: PromptInputActionQuery,
  entity?: PromptInputEntity
) {
  // ChatGPT parity: activation consumes the published trigger range even when
  // the caret has since moved. Doc edits republish the query, so the range is
  // validated against the document text instead of the current selection.
  // Synthetic sessions carry no trigger character in the document.
  const expectedText = actionQuery.isSynthetic
    ? actionQuery.query
    : `${actionQuery.trigger}${actionQuery.query}`
  if (
    actionQuery.from < 0 ||
    actionQuery.to > state.doc.content.size ||
    state.doc.textBetween(actionQuery.from, actionQuery.to, "\n", "￼") !==
      expectedText
  ) {
    return false
  }
  const currentQuery = actionQuery

  const transaction = state.tr
  if (actionQuery.isSynthetic) {
    transaction.setMeta(promptInputActionQueryPluginKey, { close: true })
  }
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
    createActionQueryPlugin(),
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
  endPromptInputActionQuery,
  getPromptInputEntitySelectionDecorations,
  promptInputEntitiesEqual,
  promptInputSchema,
  readPromptInputActionQuery,
  readPromptInputActionQuerySession,
  readPromptInputDocument,
  readPromptInputEntities,
  replacePromptInputActionQuery,
  replacePromptInputDocument,
  setPromptInputSelection,
  toggleSyntheticPromptInputActionQuery,
}
