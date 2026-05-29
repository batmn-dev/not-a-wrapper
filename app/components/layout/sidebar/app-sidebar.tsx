"use client"

import { AuthModalTrigger } from "@/app/auth/_components/auth-modal"
import { useScrollAttributes } from "@/app/hooks/use-scroll-attributes"
import { NawIcon } from "@/components/icons/naw"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Sidebar,
  SIDEBAR_CONTAINER_ID,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useUser } from "@/lib/user-store/provider"
import { cn } from "@/lib/utils"
import {
  RiAddCircleFill,
  RiAddCircleLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiDownloadLine,
  RiExpandRightLine,
  RiFileTextLine,
  RiInformationLine,
  RiQuestionLine,
  RiQuillPenLine,
  RiSearchLine,
  RiSettings3Line,
  RiSparklingLine,
  RiUserLine,
} from "@remixicon/react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import React, { useMemo, useRef } from "react"
import { PopoverContentAuth } from "../../chat-input/popover-content-auth"
import { useHistorySearch } from "../../history/history-search-provider"
import { HistoryTrigger } from "../../history/history-trigger"
import { UserMenu } from "../user-menu"
import { SidebarList } from "./sidebar-list"
import { SidebarMenuItem } from "./sidebar-menu-item"
import { SidebarProject } from "./sidebar-project"

export function AppSidebar() {
  const { isMobile } = useSidebar()

  if (isMobile) {
    return <MobileAppSidebarDrawer />
  }

  return <DesktopAppSidebar />
}

function DesktopAppSidebar() {
  const { state, toggleSidebar } = useSidebar()
  const sidebarData = useAppSidebarData()
  const isCollapsed = state === "collapsed"
  const railPopupOpenRef = useRef(false)
  const railInteractiveSelector =
    "a,button,input,textarea,select,[role='button'],[data-sidebar-item]"
  const railPopupSelector =
    "[data-slot='dropdown-menu-content'],[data-slot='popover-content']"
  const setRailPopupOpen = React.useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      railPopupOpenRef.current = true
      return
    }

    window.setTimeout(() => {
      railPopupOpenRef.current = false
    }, 0)
  }, [])

  return (
    <Sidebar
      collapsible="icon"
      variant="sidebar"
      className={cn(
        "border-border/40 border-r",
        isCollapsed ? "bg-background" : "bg-sidebar"
      )}
    >
      {/* 
        Dual-layer structure (ChatGPT pattern):
        - Collapsed rail: Always rendered, visible when collapsed
        - Expanded content: Always rendered, visible when expanded
        Both use opacity transitions for smooth crossfade
      */}

      {/* === COLLAPSED RAIL === */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 z-10 flex h-full w-(--sidebar-rail-width) flex-col items-start",
          "cursor-e-resize bg-transparent pb-1.5 rtl:cursor-w-resize",
          // Rail easing: steps(1,start) snaps visible instantly when collapsing;
          // steps(1,end) stays visible until the end when expanding (hidden by panel fade-in)
          "motion-safe:transition-opacity motion-safe:duration-150",
          isCollapsed
            ? "motion-safe:ease-[steps(1,start)]"
            : "motion-safe:ease-[steps(1,end)]",
          // Visibility based on state
          isCollapsed
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        )}
        aria-hidden={!isCollapsed}
        inert={!isCollapsed ? true : undefined}
        onPointerDown={(event) => {
          if (!isCollapsed) return
          if (
            railPopupOpenRef.current ||
            document.querySelector(railPopupSelector)
          ) {
            return
          }
          const target = event.target
          if (!(target instanceof Element)) return
          if (target.closest(railInteractiveSelector)) return
          if (document.querySelector('[role="dialog"]:not([hidden])')) return
          toggleSidebar()
        }}
      >
        {/* Header */}
        <div className="flex h-(--sidebar-header-height) w-full items-center justify-center">
          <CollapsedHeaderToggle />
        </div>

        {/* Action buttons */}
        <div className="mt-(--sidebar-section-first-margin-top) flex w-full flex-col items-start gap-0 px-1.5">
          <CollapsedMenuItem
            icon={<Icon icon={RiAddCircleLine} slotSize={20} />}
            activeIcon={<Icon icon={RiAddCircleFill} slotSize={20} />}
            label="New chat"
            href="/"
            shortcut="⇧⌘O"
            isActive={sidebarData.isNewChatActive}
          />
          {sidebarData.isLoggedIn ? (
            <HistoryTrigger
              hasSidebar={false}
              trigger={
                <CollapsedMenuItem
                  icon={<Icon icon={RiSearchLine} slotSize={20} />}
                  label="Search"
                  shortcut="⌘K"
                  isActive={sidebarData.isHistoryOpen}
                />
              }
              hasPopover={false}
            />
          ) : (
            <SignedOutCollapsedSearchPopover onOpenChange={setRailPopupOpen} />
          )}
        </div>

        {/* Spacer */}
        <div className="pointer-events-none flex-grow" />

        {/* Footer */}
        <div className="mb-1 w-full px-1.5">
          <CollapsedUserAvatar
            user={sidebarData.user}
            onSignedOutMenuOpenChange={setRailPopupOpen}
          />
        </div>
      </div>

      {/* === EXPANDED CONTENT === */}
      {/*
        ChatGPT scroll model: Single <nav> with overflow-y-auto.
        Header, actions, and footer are sticky children inside the scroll container.
        Scroll state tracked via data attributes (zero re-renders) for CSS-only indicators.
      */}
      <div
        className={cn(
          "h-full",
          "w-(--sidebar-width) overflow-x-clip text-clip whitespace-nowrap",
          // Linear crossfade in both directions (ChatGPT pattern)
          "motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-linear",
          // Visibility based on state
          isCollapsed
            ? "pointer-events-none opacity-0"
            : "pointer-events-auto opacity-100"
        )}
        // `inert` prevents focus/interaction when hidden (ChatGPT pattern)
        inert={isCollapsed ? true : undefined}
      >
        <SidebarExpandedNav data={sidebarData} />
      </div>
    </Sidebar>
  )
}

function MobileAppSidebarDrawer() {
  const { openMobile, setOpenMobile } = useSidebar()
  const sidebarData = useAppSidebarData()
  const closeMobileSidebar = React.useCallback(() => {
    setOpenMobile(false)
  }, [setOpenMobile])

  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent
        id={SIDEBAR_CONTAINER_ID}
        data-sidebar="sidebar"
        data-mobile="true"
        side="left"
        showCloseButton={false}
        className="bg-sidebar text-sidebar-foreground h-full min-w-0 gap-0 overflow-hidden p-0"
        style={{ width: "100dvw", maxWidth: "none" }}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Sidebar</SheetTitle>
          <SheetDescription>Displays the mobile sidebar.</SheetDescription>
        </SheetHeader>
        <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
          <SidebarExpandedNav
            data={sidebarData}
            onMobileClose={closeMobileSidebar}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

function useAppSidebarData() {
  const { isHistoryOpen } = useHistorySearch()
  const { chats, pinnedChats, isLoading } = useChats()
  const { user } = useUser()
  const params = useParams<{ chatId: string }>()
  const pathname = usePathname()
  const currentChatId = params.chatId
  const isLoggedIn = !!user
  const isNewChatActive = pathname === "/"

  const nonPinnedChats = useMemo(
    () => chats.filter((chat) => !chat.pinned && !chat.project_id),
    [chats]
  )
  const hasChats = chats.length > 0

  return {
    currentChatId,
    hasChats,
    isHistoryOpen,
    isLoading,
    isLoggedIn,
    isNewChatActive,
    nonPinnedChats,
    pinnedChats,
    user,
  }
}

type AppSidebarData = ReturnType<typeof useAppSidebarData>

function SidebarExpandedNav({
  data,
  onMobileClose,
}: {
  data: AppSidebarData
  onMobileClose?: () => void
}) {
  const scrollRef = useRef<HTMLElement>(null)
  // Zero-rerender scroll tracking via data attributes
  useScrollAttributes(scrollRef)

  return (
    <>
      <h2 className="sr-only">Chat history</h2>

      {/* Single unified scroll container (ChatGPT pattern) */}
      <nav
        ref={scrollRef}
        className="group/scrollport relative flex h-full w-full min-w-0 flex-1 flex-col overflow-y-auto"
        aria-label="Chat history"
      >
        {/* === STICKY HEADER === */}
        <div
          className={cn(
            "bg-sidebar sticky top-0 z-30",
            // Shadow only on SHORT viewports where actions scroll away (ChatGPT pattern)
            "not-tall:group-data-[scrolled-from-top]/scrollport:shadow-[inset_0_-1px_0_0_var(--sidebar-border)]"
          )}
        >
          <div className="px-2">
            <div className="flex h-(--sidebar-header-height) items-center justify-between">
              <Link
                href="/"
                onClick={onMobileClose}
                className="hover:bg-accent flex h-9 w-9 items-center justify-center rounded-lg"
                data-sidebar-item="true"
                aria-label="Home"
              >
                <NawIcon className="size-5" />
              </Link>
              {onMobileClose ? (
                <button
                  type="button"
                  onClick={onMobileClose}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-9 items-center justify-center rounded-md bg-transparent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  aria-label="Close sidebar"
                >
                  <Icon icon={RiCloseLine} slotSize={20} />
                </button>
              ) : (
                <Tooltip disableHoverablePopup>
                  <TooltipTrigger
                    render={
                      <SidebarTrigger className="cursor-w-resize rtl:cursor-e-resize" />
                    }
                  />
                  <TooltipContent side="bottom" align="center">
                    Close sidebar ⇧⌘S
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>

        {/* === STICKY ACTION BUTTONS === */}
        {/* Conditionally sticky: pinned on tall viewports, scrolls on short ones (ChatGPT pattern) */}
        <div
          className={cn(
            "bg-sidebar z-20 px-0 pt-(--sidebar-section-first-margin-top)",
            "tall:sticky tall:top-(--sidebar-header-height)",
            "not-tall:relative"
          )}
        >
          <div className="flex w-full flex-col items-start gap-0">
            <SidebarMenuItem
              icon={<Icon icon={RiAddCircleLine} slotSize={20} />}
              activeIcon={<Icon icon={RiAddCircleFill} slotSize={20} />}
              label="New chat"
              href="/"
              testId="new-chat-button"
              isActive={data.isNewChatActive}
              onClick={onMobileClose}
              trailing={
                <KbdGroup>
                  <Kbd label="Shift">⇧</Kbd>
                  <Kbd label="Command">⌘</Kbd>
                  <Kbd>O</Kbd>
                </KbdGroup>
              }
            />
            {data.isLoggedIn ? (
              <HistoryTrigger
                hasSidebar={false}
                trigger={
                  <SidebarMenuItem
                    icon={<Icon icon={RiSearchLine} slotSize={20} />}
                    label="Search"
                    isActive={data.isHistoryOpen}
                    trailing={
                      <KbdGroup>
                        <Kbd label="Command">⌘</Kbd>
                        <Kbd>K</Kbd>
                      </KbdGroup>
                    }
                  />
                }
                hasPopover={false}
              />
            ) : (
              <SignedOutSidebarSearchPopover />
            )}
          </div>
          {/* Solid bg mask below sticky actions — hides scroll seam (ChatGPT pattern) */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 -bottom-1.5 h-1.5",
              "bg-sidebar",
              "opacity-0 will-change-[opacity]",
              "group-data-[scrolled-from-top]/scrollport:opacity-100"
            )}
            aria-hidden="true"
          />
        </div>

        {/* === SCROLLABLE CONTENT === */}
        <div className="px-0">
          {/* Project and chat lists */}
          <SidebarProject isAuthenticated={data.isLoggedIn} />
          {data.isLoading ? (
            <div className="h-full" />
          ) : data.hasChats ? (
            <div className="space-y-4">
              {data.pinnedChats.length > 0 && (
                <SidebarList
                  key="pinned"
                  title="Pinned"
                  items={data.pinnedChats}
                  currentChatId={data.currentChatId}
                  storageKey="sidebar-section-pinned"
                />
              )}
              {data.nonPinnedChats.length > 0 && (
                <SidebarList
                  title="Chats"
                  items={data.nonPinnedChats}
                  currentChatId={data.currentChatId}
                  storageKey="sidebar-section-your-chats"
                />
              )}
            </div>
          ) : null}
        </div>

        {/* Grow spacer — pushes footer to bottom when content is short (ChatGPT pattern) */}
        <div className="grow" />

        {!data.isLoggedIn && (
          <div className="bg-sidebar z-20 flex w-full flex-col items-start gap-0 px-0 pb-3">
            <SidebarMenuItem
              aria-disabled="true"
              disabled
              icon={<Icon icon={RiSparklingLine} slotSize={20} />}
              label="See plans and pricing"
            />
            <SidebarMenuItem
              aria-disabled="true"
              disabled
              icon={<Icon icon={RiSettings3Line} slotSize={20} />}
              label="Settings"
            />
            <SignedOutHelpPopover />
          </div>
        )}

        {data.isLoggedIn && (
          <div
            className={cn(
              "pointer-events-none sticky z-40 flex shrink-0 flex-col justify-end",
              "opacity-0 group-data-[scrolled-from-end]/scrollport:opacity-100",
              "motion-safe:transition-opacity motion-safe:duration-150"
            )}
            style={{
              bottom: "calc(3.75rem - 1px)",
              marginTop: "-4px",
              height: "4px",
              maskImage: "linear-gradient(to top, transparent 25%, white 75%)",
            }}
            aria-hidden="true"
          >
            <div
              className="bg-sidebar-border sticky w-full"
              style={{ bottom: "3.75rem", height: "1px" }}
            />
          </div>
        )}

        {/* === STICKY FOOTER === */}
        {data.isLoggedIn ? (
          <div className="bg-sidebar sticky bottom-0 z-30 px-2 py-1.5 empty:hidden">
            <UserMenu variant="sidebar" />
          </div>
        ) : (
          <div className="bg-sidebar border-sidebar-border sticky bottom-0 z-30 border-t p-5">
            <div className="mb-6 text-sm whitespace-normal">
              <p className="text-sidebar-foreground mb-4 font-semibold">
                Get responses tailored to you
              </p>
              <p className="text-muted-foreground leading-5 text-pretty">
                Log in to save chats, add files, use more models, BYOK, and
                more.
              </p>
            </div>
            <div className="-mx-1.5">
              <AuthModalTrigger
                variant="outline"
                size="lg"
                className="h-11 w-full px-4 text-sm font-medium"
              >
                <span>Log in</span>
              </AuthModalTrigger>
            </div>
          </div>
        )}
      </nav>
    </>
  )
}

/* ============================================
   COLLAPSED RAIL COMPONENTS
   ============================================ */

/**
 * Header toggle button for collapsed state.
 * Shows logo by default, swaps to expand arrow on hover.
 */
function CollapsedHeaderToggle() {
  const { toggleSidebar } = useSidebar()

  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={toggleSidebar}
            className="group/toggle hover:bg-accent relative flex h-9 w-9 cursor-e-resize items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none rtl:cursor-w-resize"
            aria-label="Open sidebar"
            aria-expanded={false}
            aria-controls={SIDEBAR_CONTAINER_ID}
          />
        }
      >
        {/* Default: Logo icon */}
        <NawIcon className="absolute inset-0 m-auto size-5 transition-opacity group-hover/toggle:opacity-0 group-focus-visible/toggle:opacity-0" />
        {/* Hover: Sidebar icon */}
        <Icon
          icon={RiExpandRightLine}
          slotSize={20}
          glyphInset={0}
          className="absolute inset-0 m-auto opacity-0 transition-opacity group-hover/toggle:opacity-100 group-focus-visible/toggle:opacity-100"
        />
      </TooltipTrigger>
      <TooltipContent side="right">Open sidebar ⇧⌘S</TooltipContent>
    </Tooltip>
  )
}

/**
 * Menu item for collapsed rail.
 * Follows ChatGPT's icon wrapper pattern for alignment.
 */
function CollapsedMenuItem({
  icon,
  activeIcon,
  label,
  href,
  onClick,
  shortcut,
  isActive,
}: {
  icon: React.ReactNode
  activeIcon?: React.ReactNode
  label: string
  href?: string
  onClick?: () => void
  shortcut?: string
  isActive?: boolean
}) {
  const resolvedIcon = isActive && activeIcon ? activeIcon : icon
  const content = (
    <div className="flex items-center justify-center">{resolvedIcon}</div>
  )

  const className = cn(
    "menu-item-hoverable flex h-9 w-10 items-center justify-center rounded-lg",
    "cursor-pointer",
    "hover:bg-accent",
    isActive && "text-foreground",
    "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
  )

  const tooltipContent = shortcut ? `${label} ${shortcut}` : label

  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          href ? (
            <Link
              href={href}
              className={className}
              data-sidebar-item="true"
              data-active={isActive ? "true" : undefined}
              aria-current={isActive ? "page" : undefined}
            />
          ) : (
            <button
              type="button"
              onClick={onClick}
              className={className}
              data-sidebar-item="true"
              data-active={isActive ? "true" : undefined}
            />
          )
        }
      >
        {content}
      </TooltipTrigger>
      <TooltipContent side="right">{tooltipContent}</TooltipContent>
    </Tooltip>
  )
}

function SignedOutSidebarSearchPopover() {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <PopoverTrigger
        render={
          <SidebarMenuItem
            icon={<Icon icon={RiSearchLine} slotSize={20} />}
            label="Search"
            isActive={open}
            trailing={
              <KbdGroup>
                <Kbd label="Command">⌘</Kbd>
                <Kbd>K</Kbd>
              </KbdGroup>
            }
          />
        }
      />
      <PopoverContentAuth side="right" align="start" sideOffset={8} />
    </Popover>
  )
}

function SignedOutCollapsedSearchPopover({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = React.useState(false)

  const className = cn(
    "menu-item-hoverable flex h-9 w-10 items-center justify-center rounded-lg",
    "cursor-pointer",
    "hover:bg-accent",
    open && "text-foreground",
    "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
  )

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        onOpenChange?.(nextOpen)
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className={className}
            data-sidebar-item="true"
            data-active={open ? "true" : undefined}
            aria-label="Search"
            title="Search ⌘K"
          />
        }
      >
        <div className="flex items-center justify-center">
          <Icon icon={RiSearchLine} slotSize={20} />
        </div>
      </PopoverTrigger>
      <PopoverContentAuth side="right" align="start" sideOffset={8} />
    </Popover>
  )
}

/**
 * Compact user avatar for collapsed rail.
 * 24px (h-6 w-6) matching ChatGPT's pattern.
 */
function CollapsedUserAvatar({
  user,
  onSignedOutMenuOpenChange,
}: {
  user: { display_name?: string; profile_image?: string | null } | null
  onSignedOutMenuOpenChange?: (open: boolean) => void
}) {
  if (!user) {
    return (
      <SignedOutCollapsedAccountPopover
        onOpenChange={onSignedOutMenuOpenChange}
      />
    )
  }

  return <UserMenu variant="sidebar-collapsed" />
}

function SignedOutCollapsedAccountPopover({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        onOpenChange?.(nextOpen)
      }}
    >
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            role="button"
            aria-label="Open profile menu"
            aria-haspopup="menu"
            aria-expanded={open}
            data-sidebar-item="true"
            data-testid="accounts-profile-button"
            className={cn(
              "menu-item-hoverable text-primary mx-auto flex h-10 w-10 items-center justify-center rounded-xl",
              "hover:bg-accent focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
              open && "bg-accent"
            )}
          />
        }
      >
        <div className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full">
          <Icon icon={RiUserLine} slotSize={16} />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        animated={false}
        className="w-[calc(var(--sidebar-width)-12px)] max-w-xs"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <SignedOutAccountPopoverContent />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SignedOutAccountPopoverContent() {
  return (
    <>
      <SignedOutAccountDropdownItem
        icon={<Icon icon={RiSparklingLine} slotSize={20} />}
        label="See plans and pricing"
        showTrailingIcon
      />
      <SignedOutAccountDropdownItem
        icon={<Icon icon={RiSettings3Line} slotSize={20} />}
        label="Settings"
      />
      <DropdownMenuSeparator className="mx-3" />
      <SignedOutAccountDropdownItem
        icon={<Icon icon={RiQuestionLine} slotSize={20} />}
        label="Help center"
        showTrailingIcon
      />
      <SignedOutAccountDropdownItem
        icon={<Icon icon={RiQuillPenLine} slotSize={20} />}
        label="Release notes"
        showTrailingIcon
      />
      <SignedOutAccountDropdownItem
        icon={<Icon icon={RiDownloadLine} slotSize={20} />}
        label="Download apps"
        showTrailingIcon
      />
      <DropdownMenuSeparator className="mx-3" />
      <SignedOutAccountDropdownItem
        icon={<Icon icon={RiFileTextLine} slotSize={20} />}
        label="Terms of Service"
        showTrailingIcon
      />
      <SignedOutAccountDropdownItem
        icon={<Icon icon={RiInformationLine} slotSize={20} />}
        label="Privacy Policy"
        showTrailingIcon
      />
    </>
  )
}

function SignedOutAccountDropdownItem({
  icon,
  label,
  showTrailingIcon,
}: {
  icon: React.ReactNode
  label: string
  showTrailingIcon?: boolean
}) {
  return (
    <DropdownMenuItem
      closeOnClick={false}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      className="gap-1.5"
    >
      <div className="flex shrink-0 items-center justify-center">{icon}</div>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {showTrailingIcon && (
        <Icon
          icon={RiArrowRightSLine}
          slotSize={16}
          className="text-muted-foreground ml-auto shrink-0 opacity-0 group-hover/dropdown-menu-item:opacity-100 group-focus/dropdown-menu-item:opacity-100"
          aria-hidden="true"
        />
      )}
    </DropdownMenuItem>
  )
}

function SignedOutHelpPopover() {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "menu-item-hoverable group/help text-primary hover:bg-accent/80 hover:text-foreground focus-visible:ring-ring relative mx-1.5 inline-flex h-9 w-[calc(100%-var(--spacing)*3)] cursor-pointer items-center gap-(--sidebar-item-gap) rounded-lg bg-transparent px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none pointer-coarse:h-auto pointer-coarse:py-3",
              open && "bg-accent/80 text-foreground"
            )}
            data-sidebar-item="true"
            aria-label="Help"
          />
        }
      >
        <div className="flex shrink-0 items-center justify-center">
          <Icon icon={RiQuestionLine} slotSize={20} />
        </div>
        <div className="flex min-w-0 grow items-center gap-(--sidebar-item-gap)">
          <span className="truncate">Help</span>
        </div>
        <Icon
          icon={RiArrowRightSLine}
          slotSize={20}
          className={cn(
            "text-muted-foreground ml-auto size-5 shrink-0 opacity-0 transition-none group-hover/help:opacity-100",
            open && "opacity-100"
          )}
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-(--anchor-width)"
      >
        <div className="flex flex-col gap-0">
          <SignedOutPopoverItem
            icon={<Icon icon={RiQuestionLine} slotSize={20} />}
            label="Help center"
            onClick={() => setOpen(false)}
          />
          <SignedOutPopoverItem
            icon={<Icon icon={RiQuillPenLine} slotSize={20} />}
            label="Release notes"
            onClick={() => setOpen(false)}
          />
          <SignedOutPopoverItem
            icon={<Icon icon={RiDownloadLine} slotSize={20} />}
            label="Download apps"
            onClick={() => setOpen(false)}
          />
          <SignedOutPopoverSeparator />
          <SignedOutPopoverItem
            icon={<Icon icon={RiFileTextLine} slotSize={20} />}
            label="Terms of Service"
            onClick={() => setOpen(false)}
          />
          <SignedOutPopoverItem
            icon={<Icon icon={RiInformationLine} slotSize={20} />}
            label="Privacy Policy"
            onClick={() => setOpen(false)}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SignedOutPopoverSeparator() {
  return <div className="bg-border mx-2 my-1 h-px" aria-hidden="true" />
}

function SignedOutPopoverItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="menu-item-hoverable group/help-popover-item text-primary hover:bg-accent/80 hover:text-foreground focus-visible:bg-accent/80 focus-visible:text-foreground focus-visible:ring-ring inline-flex h-9 w-full cursor-pointer items-center gap-(--sidebar-item-gap) rounded-lg bg-transparent px-2.5 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset pointer-coarse:h-auto pointer-coarse:py-3"
    >
      <div className="flex shrink-0 items-center justify-center">{icon}</div>
      <div className="flex min-w-0 grow items-center gap-(--sidebar-item-gap)">
        <span className="truncate">{label}</span>
      </div>
      <div className="text-muted-foreground shrink-0 opacity-0 group-hover/help-popover-item:opacity-100 group-focus-visible/help-popover-item:opacity-100">
        <Icon icon={RiArrowRightSLine} slotSize={16} aria-hidden="true" />
      </div>
    </button>
  )
}
