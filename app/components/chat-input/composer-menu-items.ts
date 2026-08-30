import type { PromptInputActionQuery } from "@/components/ui/prompt-input"
import {
  composerActionRegistry,
  getComposerActionQueryMatches,
  type ComposerActionDefinition,
  type ComposerActionId,
} from "./composer-action-registry"

/**
 * The single item vocabulary every Composer menu presentation consumes.
 * Registry actions and MCP connectors resolve into typed `ComposerMenuItem`s
 * here, so highlight tracking, keyboard navigation, and activation dispatch on
 * one id space instead of string-prefix encoding — and a new registry action
 * or connector source is a data change, not a per-presentation edit.
 */

/** One MCP connector row in the @ menu. `undefined` for the whole list means
 * the connectors are still loading (the menu shows skeleton rows). */
export type ComposerMenuConnector = Readonly<{
  id: string
  name: string
  description: string
  enabled: boolean
}>

/** Live availability (and, for toggles, selection) per registry action —
 * the caller-owned product state the registry deliberately excludes. */
export type ComposerActionAvailability = Readonly<
  Record<
    ComposerActionId,
    Readonly<{
      disabled: boolean
      disabledMessage: string
      selected?: boolean
      label?: string
    }>
  >
>

export type ComposerActionMenuItem = Readonly<{
  kind: "action"
  itemId: ComposerActionId
  action: ComposerActionDefinition
  disabled: boolean
  disabledMessage: string
  selected: boolean
  label: string
}>

export type ComposerConnectorMenuItem = Readonly<{
  kind: "connector"
  itemId: string
  connector: ComposerMenuConnector
}>

export type ComposerMenuItem = ComposerActionMenuItem | ComposerConnectorMenuItem

const connectorItemId = (connectorId: string) => `connector:${connectorId}`

function toActionMenuItem(
  action: ComposerActionDefinition,
  availability: ComposerActionAvailability
): ComposerActionMenuItem {
  const state = availability[action.id]
  return {
    kind: "action",
    itemId: action.id,
    action,
    disabled: state.disabled,
    disabledMessage: state.disabledMessage,
    selected: state.selected ?? false,
    label: state.label ?? action.label,
  }
}

/** Every registry action as a menu item — the trigger (non-query) menus. */
function getComposerActionMenuItems(availability: ComposerActionAvailability) {
  return composerActionRegistry.map((action) =>
    toActionMenuItem(action, availability)
  )
}

export type ComposerMenuSections = Readonly<{
  actionItems: readonly ComposerActionMenuItem[]
  connectorItems: readonly ComposerConnectorMenuItem[]
  isConnectorSectionVisible: boolean
  isConnectorsLoading: boolean
}>

/** The query-driven @ menu sections for the active action-query session. */
function resolveComposerMenuSections({
  actionQuery,
  connectors,
  availability,
}: {
  actionQuery: PromptInputActionQuery | null
  connectors: readonly ComposerMenuConnector[] | undefined
  availability: ComposerActionAvailability
}): ComposerMenuSections {
  const actionItems = actionQuery
    ? getComposerActionQueryMatches(actionQuery.query).map((action) =>
        toActionMenuItem(action, availability)
      )
    : []

  // "/" is the command menu (actions only); "@"/"+" typed
  // triggers and the synthetic + session also search connectors.
  const isConnectorSectionVisible =
    actionQuery !== null && actionQuery.trigger !== "/"
  const isConnectorsLoading =
    isConnectorSectionVisible && connectors === undefined

  let connectorItems: readonly ComposerConnectorMenuItem[] = []
  if (isConnectorSectionVisible && connectors) {
    const normalizedQuery = (actionQuery?.query ?? "").toLocaleLowerCase()
    connectorItems = (
      normalizedQuery
        ? connectors.filter((connector) =>
            `${connector.name} ${connector.description}`
              .toLocaleLowerCase()
              .includes(normalizedQuery)
          )
        : connectors
    ).map((connector) => ({
      kind: "connector",
      itemId: connectorItemId(connector.id),
      connector,
    }))
  }

  return {
    actionItems,
    connectorItems,
    isConnectorSectionVisible,
    isConnectorsLoading,
  }
}

export { getComposerActionMenuItems, resolveComposerMenuSections }
