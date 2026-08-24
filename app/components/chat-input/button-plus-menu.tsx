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
import { RiAddLargeLine, RiPlugLine } from "@remixicon/react"
import { useCallback, useMemo } from "react"
import { type ComposerActionId } from "./composer-action-registry"
import {
  type ComposerActionAvailability,
  type ComposerMenuConnector,
} from "./composer-menu-items"
import { composerMenuRow } from "./composer-menu-row"
import { PopoverContentAuth } from "./popover-content-auth"
import { useComposerActionMenu } from "./use-composer-action-menu"

const composerPlusIcon = (
  <Icon icon={RiAddLargeLine} slotSize={20} glyphInset={0} />
)
const composerPlusTooltip = (
  <TooltipShortcut label="Add files and more">
    <Kbd>@</Kbd>
  </TooltipShortcut>
)

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

  // The registry stays product-neutral; this shell maps its live props onto
  // per-action availability (and, for toggles, selection).
  const availability = useMemo<ComposerActionAvailability>(
    () => ({
      "add-files": {
        disabled: !isFileUploadAvailable,
        disabledMessage:
          fileUploadDisabledMessage ??
          "This model doesn’t support file uploads",
      },
      "web-search": {
        disabled: isSearchDisabled,
        disabledMessage:
          searchDisabledMessage ??
          "This model doesn’t support web search",
        selected: enableSearch,
      },
    }),
    [
      enableSearch,
      fileUploadDisabledMessage,
      isFileUploadAvailable,
      isSearchDisabled,
      searchDisabledMessage,
    ]
  )

  const runAction = useCallback(
    (actionId: ComposerActionId) => {
      switch (actionId) {
        case "add-files":
          openFilePicker()
          break
        case "web-search":
          onToggleSearch(!enableSearch)
          break
      }
    },
    [enableSearch, onToggleSearch, openFilePicker]
  )

  const {
    activateItem,
    composerAnchor,
    connectorItems,
    dismissActionQuery,
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
  } = useComposerActionMenu({
    isUserAuthenticated,
    actionQuery,
    connectors,
    availability,
    onActivateActionQuery,
    onActivateConnector,
    onOpenActionMenu,
    onCloseActionQuery,
    onRunAction: runAction,
  })

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
        {actionItems.map((item) => (
          <div key={item.itemId}>
            <Tooltip disabled={!item.disabled}>
              <TooltipTrigger
                render={composerMenuRow({
                  itemId: item.itemId,
                  disabled: item.disabled,
                  highlighted: item.itemId === resolvedHighlightedItemId,
                  onActivate: activateItem,
                  onHighlight: setHighlightedItemId,
                  children: (
                    <>
                      <span className="relative flex size-5 shrink-0 items-center justify-center">
                        <Icon
                          icon={item.action.icon}
                          glyphInset={0}
                          iconClassName={item.action.iconClassName}
                          slotSize={20}
                        />
                      </span>
                      <span className="flex min-w-0 grow items-center gap-2.5">
                        <span className="me-24 flex min-w-0 flex-1 items-baseline gap-3">
                          <span className="text-foreground max-w-full min-w-0 shrink-0 truncate">
                            {item.action.label}
                          </span>
                          <span className="min-w-0 truncate text-[var(--text-tertiary)]">
                            {item.action.description}
                          </span>
                        </span>
                      </span>
                    </>
                  ),
                })}
              />
              <TooltipContent side="right" sideOffset={4}>
                {item.disabledMessage}
              </TooltipContent>
            </Tooltip>
          </div>
        ))}
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
      {connectorItems.length > 0 && (
        <div role="group">
          {connectorItems.map((item) => (
            <div key={item.connector.id}>
              {composerMenuRow({
                itemId: item.itemId,
                disabled: false,
                highlighted: item.itemId === resolvedHighlightedItemId,
                onActivate: activateItem,
                onHighlight: setHighlightedItemId,
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
                        {item.connector.name}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[var(--text-tertiary)]">
                        {item.connector.description}
                      </span>
                      {item.connector.enabled && (
                        <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
                          On
                        </span>
                      )}
                    </span>
                  </>
                ),
              })}
            </div>
          ))}
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
    const commandItems = triggerMenuItems.filter(
      (item) => item.action.behavior === "command"
    )
    const toggleItems = triggerMenuItems.filter(
      (item) => item.action.behavior === "toggle"
    )

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
                    onClick={dismissActionQuery}
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
          {/* ChatGPT's current mobile + menu (captured 2026-08-24): a compact
              content-sized popover on the main surface — rounded-[20px],
              py-2.5, 36px text-sm rows with plain 20px currentColor glyphs —
              NOT the old dark icon-circle panel. `w-max` overrides the shared
              dropdown base's anchor-width sizing: the popover is sized by its
              rows (capped at max-w-xs), never by the 36px + button. */}
          <DropdownMenuContent
            side="top"
            sideOffset={0}
            align="start"
            alignOffset={-7}
            animated={false}
            geometry="custom"
            data-content-appearance="touch-optimized"
            className="max-h-(--available-height) w-max max-w-xs overflow-y-auto rounded-[20px] py-2.5 [scrollbar-width:none]"
            onKeyDownCapture={(event) => {
              if (event.key === "Tab") event.preventDefault()
            }}
          >
            <DropdownMenuGroup>
              {commandItems.map((item) => (
                <DropdownMenuItem
                  key={item.itemId}
                  geometry="custom"
                  disabled={item.disabled}
                  className="mx-2.5 min-h-9 justify-between gap-6 rounded-[12px] px-2.5 py-1.5 text-sm"
                  onClick={() => activateItem(item.itemId)}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {/* Mobile rows keep ChatGPT's plain currentColor glyphs —
                        no per-action icon tint (that belongs to the @ menu). */}
                    <Icon
                      icon={item.action.icon}
                      glyphInset={0}
                      slotSize={20}
                    />
                    <span className="min-w-0 truncate">
                      {item.action.label}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuRadioGroup
              value={toggleItems.find((item) => item.selected)?.itemId ?? ""}
            >
              {toggleItems.map((item) => (
                <DropdownMenuRadioItem
                  key={item.itemId}
                  value={item.itemId}
                  disabled={item.disabled}
                  className="mx-2.5 min-h-9 justify-between gap-6 rounded-[12px] px-2.5 py-1.5 text-sm"
                  onClick={() => activateItem(item.itemId)}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Icon
                      icon={item.action.icon}
                      glyphInset={0}
                      slotSize={20}
                    />
                    <span className="min-w-0 truncate">
                      {item.action.label}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
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
            onClick={handleSyntheticSessionToggle}
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
