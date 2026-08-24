import {
  createActionQueryPlugin,
  endPromptInputActionQuery,
  readPromptInputActionQuery,
  readPromptInputActionQuerySession,
  replacePromptInputActionQuery,
  toggleSyntheticPromptInputActionQuery,
  type PromptInputActionQuery,
  type PromptInputActionQueryTrigger,
} from "@/components/ui/action-query-plugin"
import {
  createComposerEntityPlugins,
  deleteComposerEntityBackward,
  deleteComposerEntityForward,
  getPromptInputEntitySelectionDecorations,
} from "@/components/ui/composer-entity-plugin"
import {
  createPromptInputDocument,
  promptInputEntitiesEqual,
  promptInputSchema,
  readPromptInputDocument,
  readPromptInputEntities,
  replacePromptInputDocument,
  setPromptInputSelection,
  type PromptInputEntity,
} from "@/components/ui/prompt-input-schema"
import { baseKeymap, splitBlock } from "prosemirror-commands"
import { history, redo, undo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { Plugin, type EditorState } from "prosemirror-state"
import { Decoration, DecorationSet } from "prosemirror-view"

/**
 * The Composer editor's public surface: plugin assembly plus re-exports of the
 * three subsystems it composes —
 *   - prompt-input-schema: the document model and plain-text boundary
 *   - composer-entity-plugin (+ composer-entity-pill): mention-pill mechanics
 *   - action-query-plugin: ChatGPT's systemHintPlugin session machine
 * Consumers import from here; the split keeps each subsystem independently
 * reviewable without changing this module's API.
 */

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
    ...createComposerEntityPlugins(),
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

export type {
  PromptInputActionQuery,
  PromptInputActionQueryTrigger,
  PromptInputEntity,
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
