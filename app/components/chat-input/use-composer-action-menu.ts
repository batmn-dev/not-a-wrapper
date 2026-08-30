import {
  closeVirtualKeyboard,
  isVirtualKeyboardOpen,
} from "@/components/ui/keyboard-viewport"
import type { Popover } from "@/components/ui/popover"
import type { PromptInputActionQuery } from "@/components/ui/prompt-input"
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react"
import type { ComposerActionId } from "./composer-action-registry"
import {
  getComposerActionMenuItems,
  resolveComposerMenuSections,
  type ComposerActionAvailability,
  type ComposerMenuConnector,
  type ComposerMenuItem,
} from "./composer-menu-items"

/**
 * The headless Composer action-menu controller, shared by every menu shell
 * (desktop popover, mobile dropdown, and future presentations such as the
 * touch content sheet). It owns session dismissal, highlight state and
 * keyboard navigation, activation dispatch over the unified item model, and
 * the keyboard-close sequencing for trigger menus. Shells render; the editor's
 * action-query plugin owns session state; this hook owns everything between.
 */

type ComposerActionMenuOptions = {
  isUserAuthenticated: boolean
  actionQuery: PromptInputActionQuery | null
  connectors: readonly ComposerMenuConnector[] | undefined
  availability: ComposerActionAvailability
  onActivateActionQuery?: (
    actionId: ComposerActionId,
    query: PromptInputActionQuery
  ) => boolean
  onActivateConnector?: (
    connectorId: string,
    query: PromptInputActionQuery
  ) => boolean
  /** Open (or toggle off) a synthetic action-query session in the editor —
   * the desktop + button drives the same menu as typing "@". */
  onOpenActionMenu?: () => void
  /** End the active action-query session (synthetic Escape / focus-out). */
  onCloseActionQuery?: () => void
  /** Direct (non-query) activation of a registry action. The product behavior
   * switch stays with the shell that owns the corresponding props. */
  onRunAction: (actionId: ComposerActionId) => void
  onMenuOpenChange?: (open: boolean) => void
}

type PopoverOpenChangeHandler = NonNullable<
  ComponentProps<typeof Popover>["onOpenChange"]
>

function useComposerActionMenu({
  isUserAuthenticated,
  actionQuery,
  connectors,
  availability,
  onActivateActionQuery,
  onActivateConnector,
  onOpenActionMenu,
  onCloseActionQuery,
  onRunAction,
  onMenuOpenChange,
}: ComposerActionMenuOptions) {
  const [isTriggerMenuOpen, setIsTriggerMenuOpen] = useState(false)
  const [dismissedActionQueryId, setDismissedActionQueryId] = useState<
    number | null
  >(null)
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(
    null
  )
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const overlayContainerRef = useRef<HTMLElement | null>(null)
  const composerAnchor = useCallback(
    () =>
      triggerRef.current?.closest<HTMLFormElement>(
        'form[data-type="unified-composer"]'
      ) ?? triggerRef.current,
    []
  )
  const focusEditor = useCallback(() => {
    triggerRef.current
      ?.closest<HTMLFormElement>('form[data-type="unified-composer"]')
      ?.querySelector<HTMLElement>("#prompt-textarea")
      ?.focus({ preventScroll: true })
  }, [])

  const triggerMenuItems = useMemo(
    () => getComposerActionMenuItems(availability),
    [availability]
  )
  const {
    actionItems,
    connectorItems,
    isConnectorSectionVisible,
    isConnectorsLoading,
  } = useMemo(
    () => resolveComposerMenuSections({ actionQuery, connectors, availability }),
    [actionQuery, availability, connectors]
  )

  const isActionQueryOpen =
    isUserAuthenticated &&
    actionQuery !== null &&
    actionQuery.id !== dismissedActionQueryId &&
    (actionItems.length > 0 ||
      isConnectorsLoading ||
      connectorItems.length > 0)
  const isMenuOpen = isActionQueryOpen || isTriggerMenuOpen

  const itemsById = useMemo(() => {
    const items = new Map<string, ComposerMenuItem>()
    for (const item of [...triggerMenuItems, ...actionItems, ...connectorItems]) {
      items.set(item.itemId, item)
    }
    return items
  }, [actionItems, connectorItems, triggerMenuItems])

  const activateItem = useCallback(
    (itemId: string) => {
      const item = itemsById.get(itemId)
      if (!item) return
      if (item.kind === "action" && item.disabled) return
      if (item.kind === "connector") {
        if (
          actionQuery !== null &&
          onActivateConnector?.(item.connector.id, actionQuery) === true
        ) {
          setDismissedActionQueryId(actionQuery.id)
        }
      } else {
        const handledAsActionQuery =
          isActionQueryOpen &&
          actionQuery !== null &&
          onActivateActionQuery?.(item.itemId, actionQuery) === true

        if (handledAsActionQuery) {
          setDismissedActionQueryId(actionQuery.id)
          // The action consumed the query. Command actions still run their
          // command; toggles were handled while consuming the query.
          if (item.action.behavior === "command") onRunAction(item.itemId)
        } else {
          onRunAction(item.itemId)
        }
      }
      setIsTriggerMenuOpen(false)
      onMenuOpenChange?.(false)
      setHighlightedItemId(null)
      focusEditor()
    },
    [
      actionQuery,
      focusEditor,
      isActionQueryOpen,
      itemsById,
      onActivateActionQuery,
      onActivateConnector,
      onMenuOpenChange,
      onRunAction,
    ]
  )

  const highlightableItemIds = useMemo(
    () => [
      ...actionItems.flatMap((item) => (item.disabled ? [] : [item.itemId])),
      ...connectorItems.map((item) => item.itemId),
    ],
    [actionItems, connectorItems]
  )
  const initialItemId = highlightableItemIds[0] ?? null
  const resolvedHighlightedItemId =
    highlightedItemId && highlightableItemIds.includes(highlightedItemId)
      ? highlightedItemId
      : initialItemId

  const moveHighlight = useCallback(
    (direction: -1 | 1) => {
      if (highlightableItemIds.length === 0) return
      const currentIndex = resolvedHighlightedItemId
        ? highlightableItemIds.indexOf(resolvedHighlightedItemId)
        : -1
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : highlightableItemIds.length - 1
          : (currentIndex + direction + highlightableItemIds.length) %
            highlightableItemIds.length
      setHighlightedItemId(highlightableItemIds[nextIndex] ?? null)
    },
    [highlightableItemIds, resolvedHighlightedItemId]
  )

  const dismissActionQuery = useCallback(() => {
    if (!actionQuery) return
    if (actionQuery.isSynthetic) {
      onCloseActionQuery?.()
    } else {
      setDismissedActionQueryId(actionQuery.id)
    }
    onMenuOpenChange?.(false)
  }, [actionQuery, onCloseActionQuery, onMenuOpenChange])

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (
        !isActionQueryOpen ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        !(event.target instanceof Element) ||
        !event.target.closest("#prompt-textarea")
      ) {
        return
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault()
          moveHighlight(1)
          return
        case "ArrowUp":
          event.preventDefault()
          moveHighlight(-1)
          return
        case "Home":
          event.preventDefault()
          setHighlightedItemId(initialItemId)
          return
        case "End":
          event.preventDefault()
          setHighlightedItemId(highlightableItemIds.at(-1) ?? null)
          return
        case "Enter":
          if (!resolvedHighlightedItemId) return
          event.preventDefault()
          activateItem(resolvedHighlightedItemId)
          return
        case "Escape":
          event.preventDefault()
          dismissActionQuery()
          setHighlightedItemId(null)
          return
        case "Tab":
          event.preventDefault()
          if (resolvedHighlightedItemId) {
            activateItem(resolvedHighlightedItemId)
          }
          return
      }
    },
    [
      activateItem,
      dismissActionQuery,
      highlightableItemIds,
      initialItemId,
      isActionQueryOpen,
      moveHighlight,
      resolvedHighlightedItemId,
    ]
  )

  const setTriggerNode = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node
      const form = node?.closest<HTMLFormElement>(
        'form[data-type="unified-composer"]'
      )
      overlayContainerRef.current =
        form?.querySelector<HTMLElement>("[data-composer-overlay-host]") ?? null
      if (!form) return

      form.addEventListener("keydown", handleComposerKeyDown, true)
      return () => {
        form.removeEventListener("keydown", handleComposerKeyDown, true)
        if (triggerRef.current === node) triggerRef.current = null
        if (overlayContainerRef.current?.closest("form") === form) {
          overlayContainerRef.current = null
        }
      }
    },
    [handleComposerKeyDown]
  )

  const handleActionQueryOpenChange: PopoverOpenChangeHandler = (
    open,
    eventDetails
  ) => {
    if (open) return
    if (
      eventDetails.reason === "focus-out" &&
      document.activeElement?.matches("#prompt-textarea")
    ) {
      eventDetails.cancel()
      return
    }
    // A press on the + button is the session toggle, not an outside press —
    // its own click handler closes (or reopens) the synthetic session.
    if (
      eventDetails.reason === "outside-press" &&
      eventDetails.event.target instanceof Element &&
      eventDetails.event.target.closest("#composer-plus-btn")
    ) {
      eventDetails.cancel()
      return
    }
    dismissActionQuery()
    setHighlightedItemId(null)
  }

  const handleAuthPopoverOpenChange: PopoverOpenChangeHandler = (
    open,
    eventDetails
  ) => {
    if (
      !open &&
      eventDetails.reason === "focus-out" &&
      document.activeElement?.matches("#prompt-textarea")
    ) {
      eventDetails.cancel()
      return
    }
    // Defer opening until the virtual keyboard collapses in both auth states.
    if (open && isVirtualKeyboardOpen()) {
      closeVirtualKeyboard(() => {
        setIsTriggerMenuOpen(true)
        onMenuOpenChange?.(true)
      })
      return
    }
    setIsTriggerMenuOpen(open)
    onMenuOpenChange?.(open)
    if (open) focusEditor()
  }

  const handleTriggerMenuOpenChange = (open: boolean) => {
    // With the on-screen keyboard up, blur the editor and wait for the
    // keyboard-closed signal (500ms fallback) before opening.
    if (open && isVirtualKeyboardOpen()) {
      closeVirtualKeyboard(() => {
        setIsTriggerMenuOpen(true)
        onMenuOpenChange?.(true)
        setHighlightedItemId(initialItemId)
      })
      return
    }
    setIsTriggerMenuOpen(open)
    onMenuOpenChange?.(open)
    setHighlightedItemId(open ? initialItemId : null)
  }

  const handleSyntheticSessionToggle = useCallback(() => {
    setHighlightedItemId(null)
    onMenuOpenChange?.(!isActionQueryOpen)
    onOpenActionMenu?.()
  }, [isActionQueryOpen, onMenuOpenChange, onOpenActionMenu])

  return {
    activateItem,
    composerAnchor,
    connectorItems,
    dismissActionQuery,
    focusEditor,
    handleActionQueryOpenChange,
    handleAuthPopoverOpenChange,
    handleSyntheticSessionToggle,
    handleTriggerMenuOpenChange,
    isActionQueryOpen,
    isConnectorSectionVisible,
    isConnectorsLoading,
    isMenuOpen,
    isTriggerMenuOpen,
    overlayContainerRef,
    actionItems,
    resolvedHighlightedItemId,
    setHighlightedItemId,
    setTriggerNode,
    triggerMenuItems,
  }
}

export { useComposerActionMenu }
