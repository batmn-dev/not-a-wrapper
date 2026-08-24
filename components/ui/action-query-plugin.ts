import {
  promptInputSchema,
  type PromptInputEntity,
} from "@/components/ui/prompt-input-schema"
import { closeHistory } from "prosemirror-history"
import { Fragment } from "prosemirror-model"
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "prosemirror-state"

/**
 * The action-query session plugin, ported from ChatGPT's systemHintPlugin.
 * This module owns everything about "@"/"+"/"/" discovery sessions: the typed
 * trigger grammar, the session state machine, and range-validated activation.
 */

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

export {
  createActionQueryPlugin,
  endPromptInputActionQuery,
  readPromptInputActionQuery,
  readPromptInputActionQuerySession,
  replacePromptInputActionQuery,
  toggleSyntheticPromptInputActionQuery,
}
