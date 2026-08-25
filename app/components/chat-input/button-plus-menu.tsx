"use client"

import { ComposerIconButton } from "@/components/ui/composer-icon-button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { useIsMobileDeviceOs } from "@/hooks/use-mobile-device-os"
import type { SearchMode } from "@/lib/models/types"
import { RiPlugLine } from "@remixicon/react"
import { useCallback, useMemo, useRef } from "react"
import { type ComposerActionId } from "./composer-action-registry"
import {
  ComposerCameraIcon,
  ComposerCheckIcon,
  ComposerGlobeIcon,
  ComposerImageSquareIcon,
  ComposerPaperclipIcon,
  ComposerPlusIcon,
} from "./composer-menu-icons"
import {
  type ComposerActionAvailability,
  type ComposerActionMenuItem,
  type ComposerMenuConnector,
} from "./composer-menu-items"
import { composerMenuRow } from "./composer-menu-row"
import { PopoverContentAuth } from "./popover-content-auth"
import { useComposerActionMenu } from "./use-composer-action-menu"

const composerPlusIcon = (
  <Icon icon={ComposerPlusIcon} slotSize={20} glyphInset={0} />
)
const composerPlusTooltip = (
  <TooltipShortcut label="Add files and more">
    <Kbd>@</Kbd>
  </TooltipShortcut>
)

/* ChatGPT's touch-optimized + menu treatment (decompiled from their
 * production bundles + root CSS 2026-08-24; see reference-ui/ChatGPT/
 * components/chat-composer/chatgpt-plus-menu-touch-optimized-2026-08-24.md):
 * mobile-OS user agents get large icon-chip rows in a content-sized,
 * rounded-28 superellipse popover — 6px row inline margin/padding, 12px gap,
 * 36px full-round chips on the tertiary surface with 20px glyphs, row
 * highlight on the same tertiary token, and no group separators. */
const touchMenuRowClassName =
  "mx-1.5 h-auto min-h-(--floating-menu-item-height) cursor-auto scroll-m-1.5 gap-3 rounded-[28px] border-y-0! [corner-shape:superellipse(1.1)] px-1.5 py-1.5 text-sm hover:bg-(--floating-menu-touch-tertiary) focus:bg-(--floating-menu-touch-tertiary) data-highlighted:bg-(--floating-menu-touch-tertiary)"
const touchMenuChipClassName =
  "flex size-9 shrink-0 items-center justify-center rounded-full bg-(--floating-menu-touch-tertiary) text-foreground"
const touchMenuActionIcons = {
  "add-files": ComposerPaperclipIcon,
  "web-search": ComposerGlobeIcon,
} as const
const touchMenuCheck = (
  <Icon icon={ComposerCheckIcon} slotSize={16} glyphInset={0} />
)

type ButtonPlusMenuProps = {
  isUserAuthenticated: boolean
  isFileUploadAvailable: boolean
  enableSearch: boolean
  onToggleSearch: (enabled: boolean) => void
  searchMode: SearchMode
  /** Override the default disabled tooltip for file upload */
  fileUploadDisabledMessage?: string
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
  /** Toggle an MCP connector from the direct mobile trigger menu. */
  onToggleConnector?: (connectorId: string) => void
  /** Open (or toggle off) a synthetic action-query session in the editor —
   * the desktop + button drives the same menu as typing "@". */
  onOpenActionMenu?: () => void
  /** End the active action-query session (synthetic Escape / focus-out). */
  onCloseActionQuery?: () => void
}

type ComposerActionMenuRowProps = {
  item: ComposerActionMenuItem
  highlighted: boolean
  onActivate: (itemId: string) => void
  onHighlight: (itemId: string) => void
}

function ComposerActionMenuRow({
  item,
  highlighted,
  onActivate,
  onHighlight,
}: ComposerActionMenuRowProps) {
  const primaryTextRef = useRef<HTMLSpanElement>(null)

  return (
    <div>
      <Tooltip disabled={!item.disabled}>
        <TooltipTrigger
          render={composerMenuRow({
            itemId: item.itemId,
            disabled: item.disabled,
            selected:
              item.action.behavior === "toggle" ? item.selected : undefined,
            highlighted,
            onActivate,
            onHighlight,
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
                    <span
                      ref={primaryTextRef}
                      className="text-foreground max-w-full min-w-0 shrink-0 truncate"
                      data-composer-action-tooltip-anchor=""
                    >
                      {item.label}
                    </span>
                    <span className="min-w-0 truncate text-[var(--text-tertiary)]">
                      {item.action.description}
                    </span>
                  </span>
                  {item.selected && (
                    <span
                      aria-hidden="true"
                      className="ms-auto shrink-0"
                      data-composer-action-check=""
                    >
                      <Icon
                        icon={ComposerCheckIcon}
                        glyphInset={0}
                        slotSize={16}
                      />
                    </span>
                  )}
                </span>
              </>
            ),
          })}
        />
        <TooltipContent anchor={primaryTextRef} side="right" sideOffset={4}>
          {item.disabledMessage}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export function ButtonPlusMenu({
  isUserAuthenticated,
  isFileUploadAvailable,
  enableSearch,
  onToggleSearch,
  searchMode,
  fileUploadDisabledMessage,
  actionQuery = null,
  onActivateActionQuery,
  connectors,
  onActivateConnector,
  onToggleConnector,
  onOpenActionMenu,
  onCloseActionQuery,
}: ButtonPlusMenuProps) {
  const { openFilePicker, addFiles } = useFileUpload()
  const isMobile = useBreakpoint(768)
  // ChatGPT parity: the touch treatment keys on the user-agent OS (iOS /
  // Android / iPadOS-as-Mac), NOT pointer coarseness or width — a narrow
  // desktop window keeps the compact plain-glyph popover.
  const isTouchMenu = useIsMobileDeviceOs()
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const photosInputRef = useRef<HTMLInputElement | null>(null)
  const handleTouchFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.currentTarget.files
      if (files?.length) addFiles(Array.from(files))
      // ChatGPT parity: reset so re-picking the same file fires change again.
      event.currentTarget.value = ""
    },
    [addFiles]
  )

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
        disabled: searchMode !== "optional",
        disabledMessage:
          searchMode === "always-on"
            ? "Web search is always on for this model"
            : "This model doesn’t support web search",
        selected: enableSearch,
        ...(searchMode === "always-on"
          ? {
              label: "Web search always on",
            }
          : {}),
      },
    }),
    [
      enableSearch,
      fileUploadDisabledMessage,
      isFileUploadAvailable,
      searchMode,
    ]
  )

  const runAction = useCallback(
    (actionId: ComposerActionId) => {
      switch (actionId) {
        case "add-files":
          openFilePicker()
          break
        case "web-search":
          if (searchMode === "optional") onToggleSearch(!enableSearch)
          break
      }
    },
    [enableSearch, onToggleSearch, openFilePicker, searchMode]
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
      aria-busy={isConnectorsLoading}
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
          <ComposerActionMenuRow
            key={item.itemId}
            item={item}
            highlighted={item.itemId === resolvedHighlightedItemId}
            onActivate={activateItem}
            onHighlight={setHighlightedItemId}
          />
        ))}
      </div>
      {isConnectorsLoading && (
        <div
          aria-hidden="true"
          className="skeleton group relative mx-1.5 flex min-h-(--floating-menu-item-height) w-auto items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 [--skeleton-opacity:0.75]"
          data-composer-menu-skeleton=""
        >
          <div className="skeleton-child icon shrink-0 rounded-md" />
          <div className="skeleton-child h-4 w-40 max-w-[70%] rounded-md" />
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
          {isTouchMenu ? (
            /* ChatGPT's touch-optimized + menu (decompiled 2026-08-24): a
               content-sized rounded-28 superellipse popover, min-w 240px,
               height-capped by --floating-menu-item-height rows, with
               Camera / Photos / Files icon-chip rows in place of the single
               add-files row. data-content-appearance marks THIS treatment —
               the fine-pointer popover below deliberately lacks it. */
            <DropdownMenuContent
              side="top"
              sideOffset={-45}
              align="start"
              alignOffset={-8}
              animated={false}
              geometry="custom"
              data-content-appearance="touch-optimized"
              style={{ "--min-items": 5.8 } as React.CSSProperties}
              className="bg-(--floating-menu-touch-surface) shadow-floating-menu-touch max-h-[min(var(--available-height,50svh),calc(var(--spacing)*1.5+var(--min-items,6.8)*var(--floating-menu-item-height)))] w-max min-w-60 max-w-xs overflow-y-auto rounded-[28px] [corner-shape:superellipse(1.1)] py-1.5 select-none [scrollbar-width:none] [overscroll-behavior:contain]"
              onKeyDownCapture={(event) => {
                if (event.key === "Tab") event.preventDefault()
              }}
            >
              <DropdownMenuGroup>
                {isFileUploadAvailable && (
                  <DropdownMenuItem
                    geometry="custom"
                    className={touchMenuRowClassName}
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <span className={touchMenuChipClassName}>
                      <Icon
                        icon={ComposerCameraIcon}
                        glyphInset={0}
                        slotSize={20}
                      />
                    </span>
                    <span className="flex min-w-0 grow items-center gap-2.5">
                      <span className="truncate">Camera</span>
                    </span>
                  </DropdownMenuItem>
                )}
                {isFileUploadAvailable && (
                  <DropdownMenuItem
                    geometry="custom"
                    className={touchMenuRowClassName}
                    onClick={() => photosInputRef.current?.click()}
                  >
                    <span className={touchMenuChipClassName}>
                      <Icon
                        icon={ComposerImageSquareIcon}
                        glyphInset={0}
                        slotSize={20}
                      />
                    </span>
                    <span className="flex min-w-0 grow items-center gap-2.5">
                      <span className="truncate">Photos</span>
                    </span>
                  </DropdownMenuItem>
                )}
                {commandItems.map((item) => (
                  <DropdownMenuItem
                    key={item.itemId}
                    geometry="custom"
                    disabled={item.disabled}
                    className={touchMenuRowClassName}
                    onClick={() => activateItem(item.itemId)}
                  >
                    <span className={touchMenuChipClassName}>
                      <Icon
                        icon={touchMenuActionIcons[item.itemId]}
                        glyphInset={0}
                        slotSize={20}
                      />
                    </span>
                    <span className="flex min-w-0 grow items-center gap-2.5">
                      <span className="truncate">
                        {item.action.touchLabel ?? item.label}
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
                    indicator={touchMenuCheck}
                    className={touchMenuRowClassName}
                    onClick={() => activateItem(item.itemId)}
                  >
                    <span className={touchMenuChipClassName}>
                      <Icon
                        icon={touchMenuActionIcons[item.itemId]}
                        glyphInset={0}
                        slotSize={20}
                      />
                    </span>
                    <span className="flex min-w-0 grow items-center gap-2.5">
                      <span className="truncate">{item.label}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {connectors?.map((connector) => (
                <DropdownMenuCheckboxItem
                  key={connector.id}
                  checked={connector.enabled}
                  indicator={touchMenuCheck}
                  className={touchMenuRowClassName}
                  onCheckedChange={() => onToggleConnector?.(connector.id)}
                >
                  <span className={touchMenuChipClassName}>
                    <Icon icon={RiPlugLine} glyphInset={0} slotSize={20} />
                  </span>
                  <span className="flex min-w-0 grow items-center gap-2.5">
                    <span className="truncate">{connector.name}</span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          ) : (
            /* ChatGPT's fine-pointer narrow-width + menu (captured
               2026-08-24): a compact content-sized popover on the main
               surface — rounded-[20px], py-2.5, 36px text-sm rows with plain
               20px currentColor glyphs — NOT the old dark icon-circle panel.
               `w-max` overrides the shared dropdown base's anchor-width
               sizing: the popover is sized by its rows (capped at max-w-xs),
               never by the 36px + button. */
            <DropdownMenuContent
              side="top"
              sideOffset={0}
              align="start"
              alignOffset={-7}
              animated={false}
              geometry="custom"
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
                        {item.label}
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
                        {item.label}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {connectors?.map((connector) => (
                <DropdownMenuCheckboxItem
                  key={connector.id}
                  checked={connector.enabled}
                  className="mx-2.5 min-h-9 justify-between gap-6 rounded-[12px] px-2.5 py-1.5 text-sm"
                  onCheckedChange={() => onToggleConnector?.(connector.id)}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Icon icon={RiPlugLine} glyphInset={0} slotSize={20} />
                    <span className="min-w-0 truncate">{connector.name}</span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          )}
        </DropdownMenu>
        {isTouchMenu && isFileUploadAvailable && (
          /* ChatGPT parity: the camera / photo-library sources are hidden
             file inputs the touch rows click — mounted OUTSIDE the menu so
             they survive the menu closing on row activation. */
          <>
            <input
              ref={photosInputRef}
              className="sr-only select-none"
              type="file"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="composer-upload-photos-input"
              id="upload-photos"
              accept="image/*"
              multiple
              onChange={handleTouchFileInputChange}
            />
            <input
              ref={cameraInputRef}
              className="sr-only select-none"
              type="file"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="composer-upload-camera-input"
              id="upload-camera"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handleTouchFileInputChange}
            />
          </>
        )}
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
