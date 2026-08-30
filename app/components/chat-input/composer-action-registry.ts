import {
  RiAttachmentLine,
  RiGlobalLine,
  type RemixiconComponentType,
} from "@remixicon/react"

export type ComposerActionId = "add-files" | "web-search"

export type ComposerActionDefinition = Readonly<{
  id: ComposerActionId
  label: string
  /** The touch-optimized menu uses a short label where pointer menus use the
   * full one. */
  touchLabel?: string
  description: string
  keywords: readonly string[]
  icon: RemixiconComponentType
  iconClassName: string | undefined
  behavior: "command" | "toggle"
}>

/**
 * The product-neutral catalog for Composer actions. Availability, selected
 * state, and handlers remain live caller inputs; display copy and behavior
 * identity do not get duplicated by each menu presentation.
 */
export const composerActionRegistry = [
  {
    id: "add-files",
    label: "Add photos & files",
    touchLabel: "Files",
    description: "Upload from computer",
    keywords: ["attach", "image", "photo", "upload"],
    icon: RiAttachmentLine,
    iconClassName: undefined,
    behavior: "command",
  },
  {
    id: "web-search",
    label: "Web search",
    description: "Find real-time news and info",
    keywords: ["browse", "internet", "search", "web"],
    icon: RiGlobalLine,
    iconClassName: "text-[var(--web-search-icon-foreground)]",
    behavior: "toggle",
  },
] as const satisfies readonly ComposerActionDefinition[]

export function getComposerAction(actionId: ComposerActionId) {
  const action = composerActionRegistry.find(({ id }) => id === actionId)
  if (!action) {
    throw new Error(`Unknown Composer action: ${actionId}`)
  }
  return action
}

export function getComposerActionQueryMatches(query: string) {
  // Run one case-insensitive substring check against the item's concatenated
  // searchable text, with no query trimming. Multi-word queries
  // match across field boundaries in order ("files upload"), never reordered.
  const normalizedQuery = query.toLocaleLowerCase()
  if (!normalizedQuery) return composerActionRegistry

  return composerActionRegistry.filter((action) =>
    [action.label, action.description, ...action.keywords]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  )
}
