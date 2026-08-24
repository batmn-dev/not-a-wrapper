import { describe, expect, it } from "vitest"
import { undo } from "prosemirror-history"
import { EditorState, TextSelection } from "prosemirror-state"
import {
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
  type PromptInputEntity,
} from "./prompt-input-editor"

const webSearchEntity: PromptInputEntity = {
  id: "web-search",
  kind: "capability",
  label: "Web search",
}

describe("PromptInput structured document", () => {
  const createEditorState = () =>
    EditorState.create({
      doc: createPromptInputDocument("", [webSearchEntity]),
      plugins: createPromptInputPlugins(() => "Ask anything"),
      schema: promptInputSchema,
    })

  it("keeps capability entities typed while serializing only user-authored text", () => {
    const document = createPromptInputDocument("first line\nsecond line", [
      webSearchEntity,
    ])

    expect(readPromptInputDocument(document)).toBe("first line\nsecond line")
    expect(readPromptInputEntities(document)).toEqual([webSearchEntity])
    expect(document.firstChild?.firstChild?.type.name).toBe(
      "composerEntityCursorTarget"
    )
    expect(document.firstChild?.child(1).type.name).toBe("composerEntity")
  })

  it("recognizes an @ action query only at a text boundary before the caret", () => {
    const withSelectionAtEnd = (value: string) => {
      const document = createPromptInputDocument(value)
      const state = EditorState.create({
        doc: document,
        schema: promptInputSchema,
      })
      return state.apply(
        state.tr.setSelection(
          TextSelection.create(document, document.content.size - 1)
        )
      )
    }

    expect(readPromptInputActionQuery(withSelectionAtEnd("@web"))).toEqual({
      from: 1,
      query: "web",
      to: 5,
    })
    expect(readPromptInputActionQuery(withSelectionAtEnd("hello @w"))).toEqual({
      from: 7,
      query: "w",
      to: 9,
    })
    expect(readPromptInputActionQuery(withSelectionAtEnd("hello@w"))).toBeNull()
    expect(readPromptInputActionQuery(withSelectionAtEnd("@ "))).toBeNull()
  })

  it("replaces the exact @ query range with one typed capability entity", () => {
    const document = createPromptInputDocument("hello @w")
    let state = EditorState.create({
      doc: document,
      plugins: createPromptInputPlugins(() => "Ask anything"),
      schema: promptInputSchema,
    })
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(document, document.content.size - 1)
      )
    )
    const query = readPromptInputActionQuery(state)
    expect(query).not.toBeNull()

    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }
    expect(
      replacePromptInputActionQuery(
        state,
        dispatch,
        { ...query!, id: 1 },
        webSearchEntity
      )
    ).toBe(true)

    expect(readPromptInputDocument(state.doc)).toBe("hello ")
    expect(readPromptInputEntities(state.doc)).toEqual([webSearchEntity])
    expect(readPromptInputActionQuery(state)).toBeNull()
    expect(state.doc.firstChild?.child(1).type.name).toBe(
      "composerEntityCursorTarget"
    )
    expect(state.doc.firstChild?.child(2).type.name).toBe("composerEntity")
    expect(state.doc.firstChild?.child(3).text).toBe(" ")
  })

  it("keeps @ typing and action activation as separate undo steps", () => {
    let state = EditorState.create({
      doc: createPromptInputDocument(""),
      plugins: createPromptInputPlugins(() => "Ask anything"),
      schema: promptInputSchema,
    })
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }

    dispatch(state.tr.insertText("@"))
    dispatch(state.tr.insertText("w"))
    const query = readPromptInputActionQuery(state)
    expect(query).not.toBeNull()
    expect(
      replacePromptInputActionQuery(
        state,
        dispatch,
        { ...query!, id: 1 },
        webSearchEntity
      )
    ).toBe(true)

    expect(undo(state, dispatch)).toBe(true)
    expect(readPromptInputDocument(state.doc)).toBe("@w")
    expect(readPromptInputActionQuery(state)).toMatchObject({ query: "w" })

    expect(undo(state, dispatch)).toBe(true)
    expect(readPromptInputDocument(state.doc)).toBe("")
  })

  it("keeps the entity spacer out of the draft without stripping user whitespace", () => {
    const document = createPromptInputDocument("  draft", [webSearchEntity])

    expect(document.firstChild?.textContent).toBe("   draft")
    expect(readPromptInputDocument(document)).toBe("  draft")
  })

  it("compares entity identity and attributes instead of array identity", () => {
    expect(
      promptInputEntitiesEqual([webSearchEntity], [{ ...webSearchEntity }])
    ).toBe(true)
    expect(
      promptInputEntitiesEqual(
        [webSearchEntity],
        [{ ...webSearchEntity, label: "Search the web" }]
      )
    ).toBe(false)
  })

  it("decorates an entity selected by the native text range", () => {
    const state = createEditorState()
    const selected = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 3, 2))
    )

    const decorations = getPromptInputEntitySelectionDecorations(selected)
    const [decoration] = decorations?.find() ?? []
    const decorationAttrs = (
      decoration as typeof decoration & {
        type: { attrs: Record<string, string> }
      }
    )?.type.attrs

    expect(decoration?.from).toBe(2)
    expect(decoration?.to).toBe(3)
    expect(decorationAttrs).toMatchObject({
      class: expect.stringContaining("selection:bg-transparent"),
      "data-inline-selection-pill-selected": "",
    })
  })

  it("deletes the cursor target, entity, and spacer in one undoable transaction", () => {
    let state = createEditorState()
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 3))
    )
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }

    expect(deleteComposerEntityBackward(state, dispatch)).toBe(true)
    expect(readPromptInputEntities(state.doc)).toEqual([])
    expect(
      state.doc.firstChild?.content.content.some(
        (node) => node.type.name === "composerEntityCursorTarget"
      )
    ).toBe(false)
    expect(readPromptInputDocument(state.doc)).toBe("")

    expect(undo(state, dispatch)).toBe(true)
    expect(readPromptInputEntities(state.doc)).toEqual([webSearchEntity])
    expect(state.doc.firstChild?.firstChild?.type.name).toBe(
      "composerEntityCursorTarget"
    )
  })

  it("deletes the same atomic entity structure when Delete starts before it", () => {
    let state = createEditorState()
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1))
    )
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }

    expect(deleteComposerEntityForward(state, dispatch)).toBe(true)
    expect(readPromptInputEntities(state.doc)).toEqual([])
    expect(readPromptInputDocument(state.doc)).toBe("")
  })

  it("exposes a trailing cursor target before the next Backspace deletes the chip", () => {
    let state = createEditorState()
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 4))
    )

    expect(deleteComposerEntityBackward(state)).toBe(false)
    state = state.apply(state.tr.delete(3, 4))

    const paragraph = state.doc.firstChild
    expect(paragraph?.childCount).toBe(2)
    expect(state.selection.from).toBe(3)
    const [trailingCursorTarget] =
      getPromptInputEntitySelectionDecorations(state)?.find(3, 3) ?? []
    expect(trailingCursorTarget?.from).toBe(3)
    expect(trailingCursorTarget?.to).toBe(3)

    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }
    expect(deleteComposerEntityBackward(state, dispatch)).toBe(true)
    expect(readPromptInputEntities(state.doc)).toEqual([])
    expect(readPromptInputDocument(state.doc)).toBe("")

    expect(undo(state, dispatch)).toBe(true)
    expect(readPromptInputEntities(state.doc)).toEqual([webSearchEntity])
    expect(state.doc.firstChild?.child(2).text).toBe(" ")
  })

  it("replaces the trailing cursor target when typing continues after the chip", () => {
    let state = createEditorState()
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 4))
    )
    state = state.apply(state.tr.delete(3, 4))
    state = state.apply(state.tr.insertText("x"))

    const paragraph = state.doc.firstChild
    expect(paragraph?.childCount).toBe(3)
    expect(paragraph?.child(2).text).toBe("x")
    expect(readPromptInputEntities(state.doc)).toEqual([webSearchEntity])
    expect(readPromptInputDocument(state.doc)).toBe("x")
  })

  it("normalizes an orphaned cursor target in the transaction that removed its entity", () => {
    const state = createEditorState()
    const result = state.applyTransaction(state.tr.delete(2, 3)).state

    expect(readPromptInputEntities(result.doc)).toEqual([])
    expect(
      result.doc.firstChild?.content.content.some(
        (node) => node.type.name === "composerEntityCursorTarget"
      )
    ).toBe(false)
  })

  it("repairs missing cursor targets in one appended transaction", () => {
    const state = createEditorState()
    const withoutBoundaries = state.tr
      .delete(3, 4)
      .delete(1, 2)
    const result = state.applyTransaction(withoutBoundaries).state
    const paragraph = result.doc.firstChild

    expect(paragraph?.firstChild?.type.name).toBe(
      "composerEntityCursorTarget"
    )
    expect(paragraph?.child(1).type.name).toBe("composerEntity")
    expect(paragraph?.childCount).toBe(2)
  })
})
