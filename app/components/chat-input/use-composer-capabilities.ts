import type {
  PromptInputActionQuery,
  PromptInputEditorHandle,
  PromptInputEntity,
} from "@/components/ui/prompt-input"
import type { SearchMode } from "@/lib/models/types"
import { useCallback, useMemo, type RefObject } from "react"
import {
  getComposerAction,
  type ComposerActionId,
} from "./composer-action-registry"

const WEB_SEARCH_ACTION = getComposerAction("web-search")

/**
 * The capability↔pill projection: which capability toggles render as typed
 * entities in the editor, how removing a pill writes back to the toggle, and
 * how @/-menu activation inserts the pill. Connector pills (kind "tool" with
 * an iconUrl) extend exactly this seam.
 */
function useComposerCapabilities({
  enableSearch,
  setEnableSearch,
  searchMode,
  editorRef,
}: {
  enableSearch: boolean
  setEnableSearch: (enabled: boolean) => void
  searchMode: SearchMode
  editorRef: RefObject<PromptInputEditorHandle | null>
}) {
  const entities = useMemo<readonly PromptInputEntity[]>(
    () =>
      enableSearch
        ? [
            {
              id: WEB_SEARCH_ACTION.id,
              kind: "capability",
              label:
                searchMode === "always-on"
                  ? "Web search always on"
                  : WEB_SEARCH_ACTION.label,
              ...(searchMode === "always-on" ? { removable: false } : {}),
            },
          ]
        : [],
    [enableSearch, searchMode]
  )

  const handleEntitiesChange = useCallback(
    (nextEntities: readonly PromptInputEntity[]) => {
      if (searchMode !== "optional") return
      const hasWebSearch = nextEntities.some(
        (entity) => entity.id === WEB_SEARCH_ACTION.id
      )
      if (hasWebSearch !== enableSearch) setEnableSearch(hasWebSearch)
    },
    [enableSearch, searchMode, setEnableSearch]
  )

  const activateActionQuery = useCallback(
    (actionId: ComposerActionId, query: PromptInputActionQuery) => {
      const editor = editorRef.current
      if (!editor || searchMode !== "optional") return false

      return editor.replaceActionQuery(
        query,
        actionId === WEB_SEARCH_ACTION.id
          ? {
              id: WEB_SEARCH_ACTION.id,
              kind: "capability",
              label: WEB_SEARCH_ACTION.label,
            }
          : undefined
      )
    },
    [editorRef, searchMode]
  )

  return { entities, handleEntitiesChange, activateActionQuery }
}

export { useComposerCapabilities }
