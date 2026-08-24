"use client"

import { ComposerIconButton } from "@/components/ui/composer-icon-button"
import { useFileUpload } from "@/components/ui/file-upload"
import { floatingMenuItemActiveClassName } from "@/components/ui/floating-surface"
import { Icon } from "@/components/ui/icon"
import type { PromptInputActionQuery } from "@/components/ui/prompt-input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { RiAddLargeLine } from "@remixicon/react"
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react"
import {
  composerActionRegistry,
  getComposerActionQueryMatches,
  type ComposerActionId,
} from "./composer-action-registry"
import { PopoverContentAuth } from "./popover-content-auth"

const composerPlusIcon = (
  <Icon icon={RiAddLargeLine} slotSize={20} glyphInset={0} />
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
}: ButtonPlusMenuProps) {
  const { openFilePicker } = useFileUpload()
  const [isTriggerMenuOpen, setIsTriggerMenuOpen] = useState(false)
  const [dismissedActionQueryId, setDismissedActionQueryId] = useState<
    number | null
  >(null)
  const [highlightedActionId, setHighlightedActionId] =
    useState<ComposerActionId | null>(null)
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
  const isActionQueryOpen =
    isUserAuthenticated &&
    actionQuery !== null &&
    actionQuery.id !== dismissedActionQueryId &&
    queriedActions.length > 0
  const menuSource = isActionQueryOpen
    ? "action-query"
    : isTriggerMenuOpen
      ? "trigger"
      : null
  const isMenuOpen = menuSource !== null
  const visibleActions =
    menuSource === "action-query" ? queriedActions : composerActionRegistry

  const getActionState = (actionId: ComposerActionId) => {
    switch (actionId) {
      case "add-files":
        return {
          disabled: !isFileUploadAvailable,
          disabledMessage:
            fileUploadDisabledMessage ??
            "This model doesn\u2019t support file uploads",
        }
      case "web-search":
        return {
          disabled: isSearchDisabled,
          disabledMessage:
            searchDisabledMessage ??
            "This model doesn\u2019t support web search",
        }
    }
  }

  const activateAction = useCallback(
    (actionId: ComposerActionId) => {
      const handledAsActionQuery =
        menuSource === "action-query" &&
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
      setIsTriggerMenuOpen(false)
      setHighlightedActionId(null)
      focusEditor()
    },
    [
      actionQuery,
      enableSearch,
      focusEditor,
      menuSource,
      onActivateActionQuery,
      onToggleSearch,
      openFilePicker,
    ]
  )

  const enabledActionIds = useMemo(
    () =>
      visibleActions.flatMap((action) =>
        (action.id === "add-files"
          ? !isFileUploadAvailable
          : isSearchDisabled)
          ? []
          : [action.id]
      ),
    [isFileUploadAvailable, isSearchDisabled, visibleActions]
  )
  const initialActionId = enabledActionIds[0] ?? null
  const resolvedHighlightedActionId =
    highlightedActionId && enabledActionIds.includes(highlightedActionId)
      ? highlightedActionId
      : initialActionId

  const moveHighlight = useCallback(
    (direction: -1 | 1) => {
      if (enabledActionIds.length === 0) return
      const currentIndex = resolvedHighlightedActionId
        ? enabledActionIds.indexOf(resolvedHighlightedActionId)
        : -1
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : enabledActionIds.length - 1
          : (currentIndex + direction + enabledActionIds.length) %
            enabledActionIds.length
      setHighlightedActionId(enabledActionIds[nextIndex] ?? null)
    },
    [enabledActionIds, resolvedHighlightedActionId]
  )

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (
        !isMenuOpen ||
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
          setHighlightedActionId(initialActionId)
          return
        case "End":
          event.preventDefault()
          setHighlightedActionId(enabledActionIds.at(-1) ?? null)
          return
        case "Enter":
          if (!resolvedHighlightedActionId) return
          event.preventDefault()
          activateAction(resolvedHighlightedActionId)
          return
        case "Escape":
          event.preventDefault()
          if (menuSource === "action-query" && actionQuery) {
            setDismissedActionQueryId(actionQuery.id)
          }
          setIsTriggerMenuOpen(false)
          setHighlightedActionId(null)
          return
        case "Tab":
          event.preventDefault()
          if (
            menuSource === "action-query" &&
            resolvedHighlightedActionId
          ) {
            activateAction(resolvedHighlightedActionId)
          }
          return
        default:
          if (
            event.key.length === 1 &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const query = event.key.toLocaleLowerCase()
            const match = composerActionRegistry.find(
              (action) =>
                enabledActionIds.includes(action.id) &&
                action.label.toLocaleLowerCase().includes(query)
            )
            if (match) setHighlightedActionId(match.id)
          }
      }
    },
    [
      enabledActionIds,
      activateAction,
      initialActionId,
      isMenuOpen,
      menuSource,
      moveHighlight,
      resolvedHighlightedActionId,
      actionQuery,
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

  const handleMenuOpenChange: NonNullable<
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

    if (!open && menuSource === "action-query" && actionQuery) {
      setDismissedActionQueryId(actionQuery.id)
    }
    setIsTriggerMenuOpen(open)
    setHighlightedActionId(open ? initialActionId : null)
    if (open) focusEditor()
  }

  // Unauthenticated: show auth popover instead of dropdown
  if (!isUserAuthenticated) {
    return (
      <Popover open={isTriggerMenuOpen} onOpenChange={handleMenuOpenChange}>
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
            Add files and more
          </TooltipContent>
        </Tooltip>
        <PopoverContentAuth portalContainer={overlayContainerRef} />
      </Popover>
    )
  }

  return (
    <Popover open={isMenuOpen} onOpenChange={handleMenuOpenChange}>
      <Tooltip disableHoverablePopup disabled={isMenuOpen}>
        <TooltipTrigger
          render={
            <ComposerIconButton
              ref={setTriggerNode}
              type="button"
              id="composer-plus-btn"
              data-testid="composer-plus-btn"
              aria-label="Add files and more"
              aria-expanded={isTriggerMenuOpen}
              aria-haspopup="menu"
              onClick={() => {
                if (actionQuery) setDismissedActionQueryId(actionQuery.id)
                setIsTriggerMenuOpen((open) => !open)
                setHighlightedActionId(initialActionId)
                focusEditor()
              }}
              onPointerDown={(event) => event.preventDefault()}
            />
          }
        >
          {composerPlusIcon}
        </TooltipTrigger>
        <TooltipContent side="bottom" hideArrow>
          Add files and more
        </TooltipContent>
      </Tooltip>
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
          {visibleActions.map((action) => {
            const state = getActionState(action.id)
            return (
              <div key={action.id}>
                <Tooltip disabled={!state.disabled}>
                  <TooltipTrigger
                    render={
                      <div
                        ref={(node) => {
                          if (
                            node &&
                            action.id === resolvedHighlightedActionId &&
                            typeof node.scrollIntoView === "function"
                          ) {
                            node.scrollIntoView({ block: "nearest" })
                          }
                        }}
                        aria-disabled={state.disabled || undefined}
                        data-fill=""
                        data-highlighted={
                          action.id === resolvedHighlightedActionId
                            ? ""
                            : undefined
                        }
                        className={cn(
                          floatingMenuItemActiveClassName,
                          "menu-item-hoverable relative mx-2 flex h-(--floating-menu-item-height) cursor-pointer items-center gap-3 rounded-(--floating-menu-item-radius) px-2 py-1.5 text-sm outline-none select-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                        )}
                        tabIndex={state.disabled ? -1 : 0}
                        onClick={() => {
                          if (!state.disabled) activateAction(action.id)
                        }}
                        onPointerDown={(event) => event.preventDefault()}
                        onPointerMove={() => {
                          if (!state.disabled) {
                            setHighlightedActionId(action.id)
                          }
                        }}
                        onKeyDown={(event) => {
                          if (
                            state.disabled ||
                            (event.key !== "Enter" && event.key !== " ")
                          ) {
                            return
                          }
                          event.preventDefault()
                          activateAction(action.id)
                        }}
                      />
                    }
                  >
                    <span className="relative flex size-5 shrink-0 items-center justify-center">
                      <Icon icon={action.icon} glyphInset={0} slotSize={20} />
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
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={4}>
                    {state.disabledMessage}
                  </TooltipContent>
                </Tooltip>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
