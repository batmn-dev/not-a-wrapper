import {
  ComposerPaperclipIcon,
  ComposerWebSearchIcon,
} from "@/lib/icons/composer"
import type { ComponentType, SVGProps } from "react"

export type ComposerActionId = "add-files" | "web-search"

export type ComposerActionDefinition = Readonly<{
  id: ComposerActionId
  label: string
  compactLabel: string
  description: string
  keywords: readonly string[]
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>
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
    compactLabel: "Files",
    description: "Upload from computer",
    keywords: ["attach", "image", "photo", "upload"],
    icon: ComposerPaperclipIcon,
    behavior: "command",
  },
  {
    id: "web-search",
    label: "Web search",
    compactLabel: "Web search",
    description: "Find real-time news and info",
    keywords: ["browse", "internet", "search", "web"],
    icon: ComposerWebSearchIcon,
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
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return composerActionRegistry

  return composerActionRegistry.filter((action) =>
    [action.label, action.description, ...action.keywords]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  )
}
