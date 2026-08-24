"use client"

import { ComposerIconButton } from "@/components/ui/composer-icon-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useFileUpload } from "@/components/ui/file-upload"
import {
  closeVirtualKeyboard,
  isVirtualKeyboardOpen,
} from "@/components/ui/keyboard-viewport"
import { floatingMenuItemActiveClassName } from "@/components/ui/floating-surface"
import { Icon } from "@/components/ui/icon"
import { Kbd } from "@/components/ui/kbd"
import type { PromptInputActionQuery } from "@/components/ui/prompt-input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { cn } from "@/lib/utils"
import { RiAddLargeLine, RiPlugLine } from "@remixicon/react"
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import {
  composerActionRegistry,
  getComposerAction,
  getComposerActionQueryMatches,
  type ComposerActionId,
} from "./composer-action-registry"
import { PopoverContentAuth } from "./popover-content-auth"

const composerPlusIcon = (
  <Icon icon={RiAddLargeLine} slotSize={20} glyphInset={0} />
)
const composerPlusTooltip = (
  <TooltipShortcut label="Add files and more">
    <Kbd>@</Kbd>
  </TooltipShortcut>
)
const addFilesAction = getComposerAction("add-files")
const webSearchAction = getComposerAction("web-search")

/** One MCP connector row in the @ menu. `undefined` for the whole list means
 * the connectors are still loading (the menu shows skeleton rows). */
export type ComposerMenuConnector = Readonly<{
  id: string
  name: string
  description: string
  enabled: boolean
}>

const connectorItemId = (connectorId: string) => `connector:${connectorId}`
const CONNECTOR_ITEM_PREFIX = "connector:"

type ButtonPlusMenuProps = {
  isUserAuthenticated: boolean
  isFileUploadAvailable: boolean
  enableSearch: boolean
  onToggleSearch: (enabled: boolean) => void
  isSearchDisabled: boolean
  /** Override the default disabled tooltip for file upload */
  fileUploadDisabledMessage?: string
  /** Override the default disabled tooltip for web search */
  searchDisabledMessage?: string
  actionQuery?: PromptInputActionQuery | null
  onActivateActionQuery?: (
    actionId: ComposerActionId,
    query: PromptInputActionQuery
  ) => boolean
  /** MCP connectors for the @ menu; `undefined` while loading. */
  connectors?: readonly ComposerMenuConnector[]
  onActivateConnector?: (
    connectorId: string,
    query: PromptInputActionQuery
  ) => boolean
  /** Open (or toggle off) a synthetic action-query session in the editor —
   * the desktop + button drives the same menu as typing "@". */
  onOpenActionMenu?: () => void
  /** End the active action-query session (synthetic Escape / focus-out). */
  onCloseActionQuery?: () => void
}

export function ButtonPlusMenu({
  isUserAuthenticated,
  isFileUploadAvailable,
  enableSearch,
  onToggleSearch,
  isSearchDisabled,
  fileUploadDisabledMessage,
  searchDisabledMessage,
  actionQuery = null,
  onActivateActionQuery,
  connectors,
  onActivateConnector,
  onOpenActionMenu,
  onCloseActionQuery,
}: ButtonPlusMenuProps) {
  const { openFilePicker } = useFileUpload()
  const isMobile = useBreakpoint(768)
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

  const queriedActions = useMemo(
    () => (actionQuery ? getComposerActionQueryMatches(actionQuery.query) : []),
    [actionQuery]
  )
  // ChatGPT parity: "/" is the command menu (actions only); "@"/"+" typed
  // triggers and the synthetic + session also search connectors.
  const isConnectorSectionVisible =
    actionQuery !== null && actionQuery.trigger !== "/"
  const isConnectorsLoading =
    isConnectorSectionVisible && connectors === undefined
  const queriedConnectors = useMemo(() => {
    if (!isConnectorSectionVisible || !connectors) return []
    const normalizedQuery = (actionQuery?.query ?? "").toLocaleLowerCase()
    if (!normalizedQuery) return connectors
    return connectors.filter((connector) =>
      `${connector.name} ${connector.description}`
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    )
  }, [actionQuery, connectors, isConnectorSectionVisible])

  const isActionQueryOpen =
    isUserAuthenticated &&
    actionQuery !== null &&
    actionQuery.id !== dismissedActionQueryId &&
    (queriedActions.length > 0 ||
      isConnectorsLoading ||
      queriedConnectors.length > 0)
  const isMenuOpen = isActionQueryOpen || isTriggerMenuOpen

  const getActionState = (actionId: ComposerActionId) => {
    switch (actionId) {
      case "add-files":
        return {
          disabled: !isFileUploadAvailable,
          disabledMessage:
            fileUploadDisabledMessage ??
            "This model doesn’t support file uploads",
        }
      case "web-search":
        return {
          disabled: isSearchDisabled,
          disabledMessage:
            searchDisabledMessage ??
            "This model doesn’t support web search",
        }
    }
  }

  const activateItem = useCallback(
    (itemId: string) => {
      if (itemId.startsWith(CONNECTOR_ITEM_PREFIX)) {
        const connectorId = itemId.slice(CONNECTOR_ITEM_PREFIX.length)
        if (
          actionQuery !== null &&
          onActivateConnector?.(connectorId, actionQuery) === true
        ) {
          setDismissedActionQueryId(actionQuery.id)
        }
      } else {
        const actionId = itemId as ComposerActionId
        const handledAsActionQuery =
          isActionQueryOpen &&
          actionQuery !== null &&
          onActivateActionQuery?.(actionId, actionQuery) === true

        if (handledAsActionQuery) {
          setDismissedActionQueryId(actionQuery.id)
          if (actionId === "add-files") openFilePicker()
        } else {
          switch (actionId) {
            case "add-files":
              openFilePicker()
              break
            case "web-search":
              onToggleSearch(!enableSearch)
              break
          }
        }
      }
      setIsTriggerMenuOpen(false)
      setHighlightedItemId(null)
      focusEditor()
    },
    [
      actionQuery,
      enableSearch,
      focusEditor,
      isActionQueryOpen,
      onActivateActionQuery,
      onActivateConnector,
      onToggleSearch,
      openFilePicker,
    ]
  )

  const highlightableItemIds = useMemo(
    () => [
      ...queriedActions.flatMap((action) =>
        (action.id === "add-files"
          ? !isFileUploadAvailable
          : isSearchDisabled)
          ? []
          : [action.id as string]
      ),
      ...queriedConnectors.map((connector) => connectorItemId(connector.id)),
    ],
    [isFileUploadAvailable, isSearchDisabled, queriedActions, queriedConnectors]
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
  }, [actionQuery, onCloseActionQuery])

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

  const handleActionQueryOpenChange: NonNullable<
    ComponentProps<typeof Popover>["onOpenChange"]
  > = (open, eventDetails) => {
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

  const handleAuthPopoverOpenChange: NonNullable<
    ComponentProps<typeof Popover>["onOpenChange"]
  > = (open, eventDetails) => {
    if (
      !open &&
      eventDetails.reason === "focus-out" &&
      document.activeElement?.matches("#prompt-textarea")
    ) {
      eventDetails.cancel()
      return
    }
    // ChatGPT parity: the + handler defers opening past keyboard collapse in
    // both auth states.
    if (open && isVirtualKeyboardOpen()) {
      closeVirtualKeyboard(() => setIsTriggerMenuOpen(true))
      return
    }
    setIsTriggerMenuOpen(open)
    if (open) focusEditor()
  }

  const handleTriggerMenuOpenChange = (open: boolean) => {
    // ChatGPT parity (mobile + button): with the on-screen keyboard up, defer
    // opening until the keyboard has actually closed — blur the editor, wait
    // for the keyboard-closed signal (500ms fallback), then open.
    if (open && isVirtualKeyboardOpen()) {
      closeVirtualKeyboard(() => {
        setIsTriggerMenuOpen(true)
        setHighlightedItemId(initialItemId)
      })
      return
    }
    setIsTriggerMenuOpen(open)
    setHighlightedItemId(open ? initialItemId : null)
  }

  // Unauthenticated: show auth popover instead of dropdown
  if (!isUserAuthenticated) {
    return (
      <Popover open={isTriggerMenuOpen} onOpenChange={handleAuthPopoverOpenChange}>
        <Tooltip disableHoverablePopup disabled={isTriggerMenuOpen}>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <PopoverTrigger
              render={
                <ComposerIconButton
                  ref={setTriggerNode}
                  type="button"
                  id="composer-plus-btn"
                  data-testid="composer-plus-btn"
                  aria-label="Add files and more"
                />
              }
            >
              {composerPlusIcon}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" hideArrow>
            {composerPlusTooltip}
          </TooltipContent>
        </Tooltip>
        <PopoverContentAuth portalContainer={overlayContainerRef} />
      </Popover>
    )
  }

  const menuRowClassName = cn(
    floatingMenuItemActiveClassName,
    "menu-item-hoverable relative mx-2 flex h-(--floating-menu-item-height) cursor-pointer items-center gap-3 rounded-(--floating-menu-item-radius) px-2 py-1.5 text-sm outline-none select-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
  )

  const menuRow = ({
    itemId,
    disabled,
    children,
  }: {
    itemId: string
    disabled: boolean
    children: ReactNode
  }) => (
    <div
      ref={(node) => {
        if (
          node &&
          itemId === resolvedHighlightedItemId &&
          typeof node.scrollIntoView === "function"
        ) {
          node.scrollIntoView({ block: "nearest" })
        }
      }}
      aria-disabled={disabled || undefined}
      data-fill=""
      data-highlighted={
        itemId === resolvedHighlightedItemId ? "" : undefined
      }
      className={menuRowClassName}
      tabIndex={disabled ? -1 : 0}
      onClick={() => {
        if (!disabled) activateItem(itemId)
      }}
      onPointerDown={(event) => event.preventDefault()}
      onPointerMove={() => {
        if (!disabled) setHighlightedItemId(itemId)
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== "Enter" && event.key !== " ")) {
          return
        }
        event.preventDefault()
        activateItem(itemId)
      }}
    >
      {children}
    </div>
  )

  const editorOwnedContent = (
    <PopoverContent
      anchor={composerAnchor}
      portalContainer={overlayContainerRef}
      side="bottom"
      sideOffset={8}
      align="start"
      aria-busy={false}
      role={undefined}
      tabIndex={undefined}
      initialFocus={false}
      finalFocus={false}
      geometry="custom"
      className="max-h-[min(var(--available-height,50svh),var(--floating-menu-max-height))] w-(--anchor-width) max-w-[calc(100vw-12px)] overflow-y-auto rounded-(--floating-menu-radius) py-2 [scrollbar-width:none]"
    >
      <div
        role="group"
        className="empty:hidden [:not(:has(div:not([role=group])))]:hidden"
      >
        {queriedActions.map((action) => {
          const state = getActionState(action.id)
          return (
            <div key={action.id}>
              <Tooltip disabled={!state.disabled}>
                <TooltipTrigger
                  render={menuRow({
                    itemId: action.id,
                    disabled: state.disabled,
                    children: (
                      <>
                        <span className="relative flex size-5 shrink-0 items-center justify-center">
                          <Icon
                            icon={action.icon}
                            glyphInset={0}
                            iconClassName={action.iconClassName}
                            slotSize={20}
                          />
                        </span>
                        <span className="flex min-w-0 grow items-center gap-2.5">
                          <span className="me-24 flex min-w-0 flex-1 items-baseline gap-3">
                            <span className="text-foreground max-w-full min-w-0 shrink-0 truncate">
                              {action.label}
                            </span>
                            <span className="min-w-0 truncate text-[var(--text-tertiary)]">
                              {action.description}
                            </span>
                          </span>
                        </span>
                      </>
                    ),
                  })}
                />
                <TooltipContent side="right" sideOffset={4}>
                  {state.disabledMessage}
                </TooltipContent>
              </Tooltip>
            </div>
          )
        })}
      </div>
      {isConnectorsLoading && (
        <div role="group" aria-hidden="true" data-composer-menu-skeleton="">
          {[0, 1].map((index) => (
            <div
              key={index}
              className="mx-2 flex h-(--floating-menu-item-height) items-center gap-3 px-2 py-1.5"
            >
              <span className="bg-interactive-hover size-5 shrink-0 animate-pulse rounded-full" />
              <span className="bg-interactive-hover h-3 w-44 animate-pulse rounded-full" />
            </div>
          ))}
        </div>
      )}
      {queriedConnectors.length > 0 && (
        <div role="group">
          {queriedConnectors.map((connector) => {
            const itemId = connectorItemId(connector.id)
            return (
              <div key={connector.id}>
                {menuRow({
                  itemId,
                  disabled: false,
                  children: (
                    <>
                      <span className="relative flex size-5 shrink-0 items-center justify-center">
                        <Icon
                          icon={RiPlugLine}
                          glyphInset={0}
                          slotSize={20}
                        />
                      </span>
                      <span className="flex min-w-0 grow items-baseline gap-3">
                        <span className="text-foreground max-w-full min-w-0 shrink-0 truncate">
                          {connector.name}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[var(--text-tertiary)]">
                          {connector.description}
                        </span>
                        {connector.enabled && (
                          <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
                            On
                          </span>
                        )}
                      </span>
                    </>
                  ),
                })}
              </div>
            )
          })}
        </div>
      )}
      {isConnectorSectionVisible && actionQuery?.query === "" && (
        <div
          data-composer-menu-hint=""
          className="mx-2 px-2 pt-2 pb-0.5 text-sm text-[var(--text-tertiary)] select-none"
        >
          Type to search actions &amp; connectors
        </div>
      )}
    </PopoverContent>
  )

  if (isMobile) {
    const addFilesState = getActionState("add-files")
    const webSearchState = getActionState("web-search")

    return (
      <>
        <DropdownMenu
          open={isTriggerMenuOpen}
          onOpenChange={handleTriggerMenuOpenChange}
          modal
        >
          <Tooltip disableHoverablePopup disabled={isMenuOpen}>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <DropdownMenuTrigger
                render={
                  <ComposerIconButton
                    ref={setTriggerNode}
                    type="button"
                    id="composer-plus-btn"
                    data-testid="composer-plus-btn"
                    aria-label="Add files and more"
                    aria-expanded={isTriggerMenuOpen}
                    onClick={() => {
                      if (actionQuery?.isSynthetic) {
                        onCloseActionQuery?.()
                      } else if (actionQuery) {
                        setDismissedActionQueryId(actionQuery.id)
                      }
                    }}
                  />
                }
              >
                {composerPlusIcon}
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" hideArrow>
              {composerPlusTooltip}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            side="top"
            sideOffset={-44}
            align="start"
            alignOffset={-8}
            animated={false}
            geometry="custom"
            data-content-appearance="touch-optimized"
            className="max-h-(--available-height) w-[240px] min-w-[240px] max-w-xs overflow-y-auto rounded-[28px] bg-floating-surface py-1.5 [--floating-menu-item-active:#414141] [scrollbar-width:none] dark:bg-[#1b1b1b] dark:shadow-[0_8px_16px_rgba(0,0,0,0.32),inset_0_0_1px_rgba(255,255,255,0.2),0_0_1px_rgba(0,0,0,0.62)]"
            onKeyDownCapture={(event) => {
              if (event.key === "Tab") event.preventDefault()
            }}
          >
            <DropdownMenuGroup>
              <DropdownMenuItem
                geometry="custom"
                disabled={addFilesState.disabled}
                className="mx-1.5 h-12 gap-3 rounded-[28px] p-1.5 text-base/6"
                onClick={() => activateItem("add-files")}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#414141]">
                  <Icon
                    icon={addFilesAction.icon}
                    glyphInset={0}
                    slotSize={20}
                  />
                </span>
                <span className="min-w-0 grow truncate">
                  {addFilesAction.compactLabel}
                </span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuRadioGroup
              value={enableSearch ? "web-search" : ""}
            >
              <DropdownMenuRadioItem
                value="web-search"
                disabled={webSearchState.disabled}
                className="mx-1.5 h-12 gap-3 rounded-[28px] p-1.5 text-base/6"
                onClick={() => activateItem("web-search")}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#414141]">
                  <Icon
                    icon={webSearchAction.icon}
                    glyphInset={0}
                    iconClassName={webSearchAction.iconClassName}
                    slotSize={20}
                  />
                </span>
                <span className="min-w-0 grow truncate">
                  {webSearchAction.compactLabel}
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover
          open={isActionQueryOpen}
          onOpenChange={handleActionQueryOpenChange}
        >
          {editorOwnedContent}
        </Popover>
      </>
    )
  }

  // Desktop: the + button and typed "@"/"/" drive ONE editor-owned query
  // session (ChatGPT's synthetic session) — clicking + opens the same menu
  // that typing "@" does, and typing filters it.
  return (
    <Popover open={isActionQueryOpen} onOpenChange={handleActionQueryOpenChange}>
      <Tooltip disableHoverablePopup disabled={isActionQueryOpen}>
        <TooltipTrigger
          render={<span className="inline-flex" />}
        >
          <ComposerIconButton
            ref={setTriggerNode}
            type="button"
            id="composer-plus-btn"
            data-testid="composer-plus-btn"
            aria-label="Add files and more"
            aria-expanded={isActionQueryOpen}
            aria-haspopup="menu"
            onClick={() => {
              setHighlightedItemId(null)
              onOpenActionMenu?.()
            }}
            onPointerDown={(event) => event.preventDefault()}
          >
            {composerPlusIcon}
          </ComposerIconButton>
        </TooltipTrigger>
        <TooltipContent side="bottom" hideArrow>
          {composerPlusTooltip}
        </TooltipContent>
      </Tooltip>
      {editorOwnedContent}
    </Popover>
  )
}
