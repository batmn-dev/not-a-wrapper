"use client"

import { AuthModalTrigger } from "@/app/auth/_components/auth-modal"
import { useProjectPinning } from "@/app/components/projects/use-project-pinning"
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
import { Icon, type IconProps } from "@/components/ui/icon"
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
  useSidebar,
  useSidebarShortcutScope,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/convex/_generated/api"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { useUser } from "@/lib/user-store/provider"
import { cn } from "@/lib/utils"
import {
  RiAddCircleFill,
  RiAddCircleLine,
  RiArrowRightSLine,
  RiChat3Line,
  RiCloseLine,
  RiDownloadLine,
  RiFileTextLine,
  RiInformationLine,
  RiPushpinLine,
  RiQuestionLine,
  RiQuillPenLine,
  RiSearchLine,
  RiSettings3Line,
  RiSideBarLine,
  RiSparklingLine,
  RiUserLine,
} from "@remixicon/react"
import Link from "next/link"
import React, { useMemo, useRef } from "react"
import { PopoverContentAuth } from "../../chat-input/popover-content-auth"
import { useHistorySearch } from "../../history/history-search-provider"
import { HistoryTrigger } from "../../history/history-trigger"
import { useInfiniteScroll } from "../../history/use-history-view"
import { UserMenu } from "../user-menu"
import { useChatOrganization } from "./chat-organization"
import {
  deriveSidebarComposition,
  deriveSidebarSelection,
} from "./sidebar-composition"
import { SidebarItem } from "./sidebar-item"
import { SidebarLeadingIcon } from "./sidebar-leading-icon"
import { SidebarList } from "./sidebar-list"
import { SidebarMenuItem } from "./sidebar-menu-item"
import { SidebarPaginationState } from "./sidebar-pagination-skeleton"
import { SidebarProject } from "./sidebar-project"
import { SidebarProjectItem } from "./sidebar-project-item"

export function AppSidebar() {
  const { isMobile } = useSidebar()
  // This sidebar responds to ⌘⇧S (desktop collapse / mobile drawer), so it
  // enables the provider's shortcut while mounted.
  useSidebarShortcutScope()

  if (isMobile) {
    return <MobileAppSidebarDrawer />
  }

  return <DesktopAppSidebar />
}

const sidebarHeaderActionClassName =
  "text-[var(--text-tertiary)] hover:bg-black/[0.07] active:bg-black/[0.07] dark:hover:bg-white/10 dark:active:bg-white/10 inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"

const sidebarHeaderActionOpenClassName = "bg-black/[0.07] dark:bg-white/10"

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
      className="bg-sidebar border-sidebar-border border-r"
    >
      {/*
        Dual-layer structure:
        - Collapsed rail: Always rendered, visible when collapsed
        - Expanded content: Always rendered, visible when expanded
        Both use opacity transitions for smooth crossfade.
        Paint order is load-bearing: the rail must have no
        z-index so that mid-fade (opacity < 1) the DOM-later expanded layer
        becomes a stacking context and its opaque bg masks/reveals the rail.
        A z-index on the rail would put it on top of the crossfade instead.
      */}

      <nav
        aria-label="Sidebar"
        className={cn(
          "group/tiny-bar absolute inset-y-0 left-0 flex h-full w-(--sidebar-rail-width) flex-col items-start",
          "cursor-e-resize bg-transparent pb-(--sidebar-footer-inset) rtl:cursor-w-resize",
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
        <div className="flex h-(--sidebar-header-height) w-full items-center justify-center">
          <CollapsedHeaderToggle />
        </div>

        <div className="mt-(--sidebar-section-first-margin-top) flex w-full flex-col items-start gap-0 px-(--sidebar-row-outer-inset)">
          <CollapsedMenuItem
            icon={RiAddCircleLine}
            activeIcon={RiAddCircleFill}
            label="New chat"
            href="/"
            compact
            shortcut={
              <>
                <Kbd label="Shift">⇧</Kbd>
                <Kbd label="Command">⌘</Kbd>
                <Kbd>O</Kbd>
              </>
            }
            isActive={sidebarData.isNewChatActive}
          />
          {sidebarData.isLoggedIn ? (
            <HistoryTrigger
              hasSidebar={false}
              trigger={
                <CollapsedMenuItem
                  icon={RiSearchLine}
                  label="Search"
                  shortcut={
                    <>
                      <Kbd label="Command">⌘</Kbd>
                      <Kbd>K</Kbd>
                    </>
                  }
                  isActive={sidebarData.isHistoryOpen}
                />
              }
              hasPopover={false}
            />
          ) : (
            <SignedOutCollapsedSearchPopover onOpenChange={setRailPopupOpen} />
          )}
          {sidebarData.isLoggedIn &&
          (sidebarData.composition.pinnedChats.length > 0 ||
            sidebarData.composition.pinnedProjects.length > 0) ? (
            <CollapsedSectionMenu
              data={sidebarData}
              icon={RiPushpinLine}
              label="Pinned"
              onOpenChange={setRailPopupOpen}
              section="pinned"
            />
          ) : null}
          {sidebarData.isLoggedIn &&
          sidebarData.composition.historyChats.length > 0 ? (
            <CollapsedSectionMenu
              data={sidebarData}
              icon={RiChat3Line}
              label="Recents"
              onOpenChange={setRailPopupOpen}
              section="recents"
            />
          ) : null}
        </div>

        <div className="pointer-events-none flex-grow" />

        {/* Footer. Bottom margin is the derived compensator for the expanded
            footer row being taller than this button — see the footer avatar
            placement contract in globals.css. */}
        <div className="mb-(--sidebar-rail-footer-margin-bottom) w-full px-1.5">
          <CollapsedUserAvatar
            user={sidebarData.user}
            onSignedOutMenuOpenChange={setRailPopupOpen}
          />
        </div>
      </nav>

      {/*
        Scroll model: Single <nav> with overflow-y-auto.
        Header, actions, and footer are sticky children inside the scroll container.
        Scroll state tracked via data attributes (zero re-renders) for CSS-only indicators.
      */}
      <div
        className={cn(
          "h-full",
          "w-(--sidebar-width) overflow-x-clip text-clip whitespace-nowrap",
          // Opaque bg so the crossfade masks the rail beneath (see paint-order
          // note above); the container's own bg makes this invisible at rest.
          "bg-sidebar",
          // Linear crossfade in both directions
          "motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-linear",
          // Visibility based on state
          isCollapsed
            ? "pointer-events-none opacity-0"
            : "pointer-events-auto opacity-100"
        )}
        // `inert` prevents focus/interaction when hidden
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
        overlayClassName="bg-scrim-sidebar supports-backdrop-filter:backdrop-blur-none"
        className="bg-sidebar text-sidebar-foreground h-full min-w-0 gap-0 overflow-hidden p-0"
        style={{ width: "var(--sidebar-width)", maxWidth: "100dvw" }}
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
  const { isHistoryOpen, openHistory } = useHistorySearch()
  const { chats, isLoading, isLoadingMore, loadMore, canLoadMore } = useChats()
  const { chatId, isNewChatSurface } = useChatSession()
  const { user } = useUser()
  const isLoggedIn = !!user
  const { currentChatId, isNewChatActive } = deriveSidebarSelection({
    chats,
    isNewChatSurface,
    sessionChatId: chatId,
  })
  const [chatOrganization, setChatOrganization, isOrganizationHydrated] =
    useChatOrganization()
  const { data: projectDocs } = usePerUserQuery(api.projects.getForCurrentUser)
  const { isPinned, isPinPending, togglePinned } = useProjectPinning()
  const projects = useMemo(
    () =>
      (projectDocs ?? []).map((project) => ({
        ...project,
        pinned: isPinned(project),
      })),
    [isPinned, projectDocs]
  )
  const composition = useMemo(
    () =>
      deriveSidebarComposition({
        chats,
        projects,
        organization: chatOrganization,
      }),
    [chatOrganization, chats, projects]
  )

  return {
    chatOrganization,
    composition,
    currentChatId,
    isHistoryOpen,
    isLoading:
      !isOrganizationHydrated ||
      isLoading ||
      (isLoggedIn && projectDocs === undefined),
    isLoadingMore,
    isLoggedIn,
    isNewChatActive,
    isProjectPinPending: isPinPending,
    openHistory,
    setChatOrganization,
    toggleProjectPinned: togglePinned,
    user,
    loadMore,
    canLoadMore,
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

  // Bounded sidebar (ADR-0005): load more window pages as the user nears the
  // bottom.
  const { canLoadMore, loadMore } = data
  useInfiniteScroll(scrollRef, canLoadMore, loadMore)

  return (
    <>
      <h2 className="sr-only">Chat history</h2>

      <nav
        ref={scrollRef}
        className="group/scrollport relative flex h-full w-full min-w-0 flex-1 flex-col overflow-y-auto"
        aria-label="Chat history"
      >
        {/* The action-group mask below owns the header seam. */}
        <div className="bg-sidebar sticky top-0 z-30">
          <div className="px-2">
            <div className="flex h-(--sidebar-header-height) items-center justify-between">
              <Link
                href="/"
                onClick={onMobileClose}
                className="focus-visible:ring-focus-ring flex h-9 w-auto items-center justify-center rounded-[8px] px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                data-sidebar-item="true"
                aria-label="Home"
              >
                <span className="text-[18px] leading-[26px] font-semibold whitespace-nowrap">
                  Wrapper
                </span>
              </Link>
              <div className="flex items-center gap-0">
                {data.isLoggedIn ? (
                  <SidebarHeaderSearchAction
                    isActive={data.isHistoryOpen}
                    onClick={data.openHistory}
                  />
                ) : (
                  <SignedOutSidebarHeaderSearchPopover />
                )}
                {onMobileClose ? (
                  <button
                    type="button"
                    onClick={onMobileClose}
                    className={sidebarHeaderActionClassName}
                    aria-label="Close sidebar"
                  >
                    <Icon icon={RiCloseLine} slotSize={20} glyphInset={0} />
                  </button>
                ) : (
                  <ExpandedSidebarToggle />
                )}
              </div>
            </div>
          </div>
        </div>

        <aside
          className={cn(
            "bg-sidebar z-20 px-0 pt-(--sidebar-section-first-margin-top)",
            "tall:sticky tall:top-(--sidebar-header-height)",
            "not-tall:relative",
            "[--sticky-spacer:6px]"
          )}
        >
          <div className="flex w-full flex-col items-start gap-0">
            <SidebarMenuItem
              icon={RiAddCircleLine}
              activeIcon={RiAddCircleFill}
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
          </div>
          {/* On tall viewports the mask gains a hairline after scrolling. */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 -bottom-(--sticky-spacer) h-(--sticky-spacer)",
              "bg-sidebar",
              "tall:[box-shadow:var(--sharp-edge-top-shadow-placeholder)]",
              "tall:group-data-[scrolled-from-top]/scrollport:[box-shadow:var(--sharp-edge-top-shadow)]",
              "opacity-0 will-change-[opacity]",
              "group-data-[scrolled-from-top]/scrollport:opacity-100"
            )}
            aria-hidden="true"
          />
        </aside>

        <div className="px-0">
          {/* Project and chat lists. The one-list Projects nav row extends the
              action cluster (flush, no margin); all section spacing below is
              owned by the section-stack tokens on the shared stack container,
              so both organizer modes share one rhythm. */}
          {data.chatOrganization === "one-list" ? (
            <SidebarProject
              isAuthenticated={data.isLoggedIn}
              organization={data.chatOrganization}
              projects={[]}
              isPinPending={data.isProjectPinPending}
              onTogglePinned={data.toggleProjectPinned}
              onOrganizationChange={data.setChatOrganization}
            />
          ) : null}
          {data.isLoading ? (
            <div className="h-full" />
          ) : data.isLoggedIn ? (
            <>
              <div className="sidebar-section-stack">
                {(data.composition.pinnedChats.length > 0 ||
                  data.composition.pinnedProjects.length > 0) && (
                  <SidebarList
                    key="pinned"
                    title="Pinned"
                    items={data.composition.pinnedChats}
                    presentation={{
                      kind: "pinned",
                      projectNames: data.composition.projectNames,
                    }}
                    beforeItems={data.composition.pinnedProjects.map(
                      (project) => (
                        <SidebarProjectItem
                          key={project._id}
                          project={project}
                          isPinPending={data.isProjectPinPending(project._id)}
                          onTogglePinned={() =>
                            data.toggleProjectPinned(project)
                          }
                        />
                      )
                    )}
                    currentChatId={data.currentChatId}
                    storageKey="sidebar-section-pinned"
                  />
                )}
                {data.chatOrganization === "by-project" ? (
                  <SidebarProject
                    isAuthenticated={data.isLoggedIn}
                    organization={data.chatOrganization}
                    projects={data.composition.sectionProjects}
                    isPinPending={data.isProjectPinPending}
                    onTogglePinned={data.toggleProjectPinned}
                    onOrganizationChange={data.setChatOrganization}
                  />
                ) : null}
                <SidebarList
                  title={
                    data.chatOrganization === "one-list" ? "Recents" : "Chats"
                  }
                  items={data.composition.historyChats}
                  presentation={
                    data.chatOrganization === "one-list"
                      ? {
                          kind: "history",
                          projectNames: data.composition.projectNames,
                        }
                      : undefined
                  }
                  currentChatId={data.currentChatId}
                  storageKey="sidebar-section-your-chats"
                  showHeaderActions
                  organization={data.chatOrganization}
                  onOrganizationChange={data.setChatOrganization}
                  onNewChat={onMobileClose}
                />
              </div>
              <SidebarPaginationState
                isLoadingMore={data.isLoadingMore}
                seed={data.composition.historyChats.length}
              />
            </>
          ) : null}
        </div>

        {/* Grow spacer — pushes footer to bottom when content is short */}
        <div className="grow" />

        {!data.isLoggedIn && (
          <div className="bg-sidebar z-20 flex w-full flex-col items-start gap-0 px-0 pb-3">
            <SidebarMenuItem
              aria-disabled="true"
              disabled
              icon={RiSparklingLine}
              label="See plans and pricing"
            />
            <SidebarMenuItem
              aria-disabled="true"
              disabled
              icon={RiSettings3Line}
              label="Settings"
            />
            <SignedOutHelpPopover />
          </div>
        )}

        {/* Scroll seam, mirroring the sticky action group's top seam: a 5%
            hairline appears above the footer only while more history sits below
            (scrolled-from-end), and clears at the bottom. Same sharp-edge line
            as the header/actions, flipped to the footer's top edge. */}
        {data.isLoggedIn ? (
          <div
            className={cn(
              "bg-sidebar sticky bottom-0 z-30 px-2 py-(--sidebar-footer-inset) empty:hidden",
              "[box-shadow:var(--sharp-edge-bottom-shadow-placeholder)]",
              "group-data-[scrolled-from-end]/scrollport:[box-shadow:var(--sharp-edge-bottom-shadow)]"
            )}
          >
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

function SidebarHeaderSearchAction({
  isActive,
  onClick,
}: {
  isActive: boolean
  onClick: () => void
}) {
  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            className={cn(
              sidebarHeaderActionClassName,
              isActive && sidebarHeaderActionOpenClassName
            )}
            aria-label="Search"
          />
        }
      >
        <Icon icon={RiSearchLine} slotSize={20} glyphInset={0} />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center">
        <TooltipShortcut label="Search">
          <Kbd label="Command">⌘</Kbd>
          <Kbd>K</Kbd>
        </TooltipShortcut>
      </TooltipContent>
    </Tooltip>
  )
}

function ExpandedSidebarToggle() {
  const { toggleSidebar } = useSidebar()

  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(
              sidebarHeaderActionClassName,
              "cursor-w-resize rtl:cursor-e-resize"
            )}
            aria-label="Close sidebar"
            aria-expanded={true}
            aria-controls={SIDEBAR_CONTAINER_ID}
          />
        }
      >
        <Icon icon={RiSideBarLine} slotSize={20} glyphInset={0} />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center">
        <TooltipShortcut label="Close sidebar">
          <Kbd label="Shift">⇧</Kbd>
          <Kbd label="Command">⌘</Kbd>
          <Kbd>S</Kbd>
        </TooltipShortcut>
      </TooltipContent>
    </Tooltip>
  )
}

function SignedOutSidebarHeaderSearchPopover() {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip disableHoverablePopup>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    sidebarHeaderActionClassName,
                    open && sidebarHeaderActionOpenClassName
                  )}
                  aria-label="Search"
                />
              }
            />
          }
        >
          <Icon icon={RiSearchLine} slotSize={20} glyphInset={0} />
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center">
          <TooltipShortcut label="Search">
            <Kbd label="Command">⌘</Kbd>
            <Kbd>K</Kbd>
          </TooltipShortcut>
        </TooltipContent>
      </Tooltip>
      <PopoverContentAuth side="right" align="start" sideOffset={8} />
    </Popover>
  )
}

function CollapsedHeaderToggle() {
  const { toggleSidebar } = useSidebar()

  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={toggleSidebar}
            className="group/open-sidebar text-foreground focus-visible:ring-focus-ring relative flex h-9 w-9 cursor-e-resize items-center justify-center rounded-[8px] hover:bg-black/[0.07] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:bg-black/[0.07] rtl:cursor-w-resize dark:hover:bg-white/10 dark:active:bg-white/10"
            aria-label="Open sidebar"
            aria-expanded={false}
            aria-controls={SIDEBAR_CONTAINER_ID}
          />
        }
      >
        <NawIcon className="absolute inset-0 m-auto size-5 opacity-100 transition-opacity delay-0 duration-[1ms] group-hover/tiny-bar:opacity-0 group-hover/tiny-bar:delay-150 group-focus-visible/open-sidebar:opacity-0 group-focus-visible/open-sidebar:delay-0" />
        <Icon
          icon={RiSideBarLine}
          slotSize={20}
          glyphInset={0}
          className="absolute inset-0 m-auto opacity-0 transition-opacity delay-0 duration-[1ms] group-hover/tiny-bar:opacity-100 group-hover/tiny-bar:delay-150 group-focus-visible/open-sidebar:opacity-100 group-focus-visible/open-sidebar:delay-0"
        />
      </TooltipTrigger>
      <TooltipContent side="right">Open sidebar</TooltipContent>
    </Tooltip>
  )
}

/**
 * Menu item for collapsed rail.
 * Follows the icon wrapper pattern for alignment.
 */
function CollapsedMenuItem({
  icon,
  activeIcon,
  label,
  href,
  onClick,
  shortcut,
  isActive,
  compact = false,
}: {
  icon: IconProps["icon"]
  activeIcon?: IconProps["icon"]
  label: string
  href?: string
  onClick?: () => void
  shortcut?: React.ReactNode
  isActive?: boolean
  compact?: boolean
}) {
  const content = (
    <SidebarLeadingIcon
      icon={icon}
      activeIcon={activeIcon}
      isActive={isActive}
      labelSpacing={false}
    />
  )

  const className = cn(
    "menu-item-hoverable flex h-9 items-center justify-center rounded-[10px]",
    compact ? "mx-auto w-9" : "w-(--sidebar-collapsed-item-width)",
    "cursor-pointer",
    "hover:bg-sidebar-row active:bg-sidebar-row",
    isActive && "text-foreground",
    "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
  )

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
              aria-label={label}
            />
          ) : (
            <button
              type="button"
              onClick={onClick}
              className={className}
              data-sidebar-item="true"
              data-active={isActive ? "true" : undefined}
              aria-label={label}
            />
          )
        }
      >
        {content}
      </TooltipTrigger>
      <TooltipContent side="right">
        {shortcut ? (
          <TooltipShortcut label={label}>{shortcut}</TooltipShortcut>
        ) : (
          label
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function CollapsedSectionMenu({
  data,
  icon,
  label,
  onOpenChange,
  section,
}: {
  data: AppSidebarData
  icon: IconProps["icon"]
  label: "Pinned" | "Recents"
  onOpenChange?: (open: boolean) => void
  section: "pinned" | "recents"
}) {
  const [open, setOpen] = React.useState(false)
  const recentChats = data.composition.historyChats.slice(0, 10)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  const handleContentClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element) || target.closest("button")) return
    if (target.closest("a[data-sidebar-item]")) handleOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <Tooltip disableHoverablePopup>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    "menu-item-hoverable text-foreground flex h-9 w-full items-center justify-center rounded-[10px]",
                    "hover:bg-sidebar-row active:bg-sidebar-row focus-visible:ring-focus-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                    open && "bg-sidebar-row"
                  )}
                  data-sidebar-item="true"
                  data-sidebar-keep-open="true"
                  aria-label={label}
                />
              }
            />
          }
        >
          <SidebarLeadingIcon icon={icon} labelSpacing={false} />
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="right"
        sideOffset={-4}
        align="start"
        alignOffset={-5}
        initialFocus={(openType) => openType === "keyboard"}
        className={cn(
          "max-h-[calc(100dvh-1rem)] w-(--sidebar-width) min-w-(--sidebar-width) gap-0 rounded-[20px] p-0 py-2.5"
        )}
      >
        <div
          className="max-w-(--sidebar-width) overflow-x-auto"
          // SidebarRow stops click propagation after marking navigation intent,
          // so close the rail menu during capture before that handler runs.
          onClickCapture={handleContentClick}
        >
          <div className="w-(--sidebar-width)">
            <div className="mx-1.5 h-9 px-2.5 py-2 text-sm leading-5 font-normal text-[var(--text-tertiary)]">
              {label}
            </div>
            {section === "pinned" ? (
              <>
                {data.composition.pinnedProjects.map((project) => (
                  <SidebarProjectItem
                    key={project._id}
                    project={project}
                    isPinPending={data.isProjectPinPending(project._id)}
                    onTogglePinned={() => data.toggleProjectPinned(project)}
                  />
                ))}
                {data.composition.pinnedChats.map((chat) => (
                  <SidebarItem
                    key={chat.id}
                    chat={chat}
                    currentChatId={data.currentChatId}
                    presentation={{
                      kind: "pinned",
                      projectName: chat.project_id
                        ? data.composition.projectNames.get(chat.project_id)
                        : undefined,
                    }}
                  />
                ))}
              </>
            ) : (
              recentChats.map((chat) => {
                const projectName = chat.project_id
                  ? data.composition.projectNames.get(chat.project_id)
                  : undefined

                return (
                  <SidebarItem
                    key={chat.id}
                    chat={chat}
                    currentChatId={data.currentChatId}
                    presentation={
                      projectName
                        ? { kind: "recent-project", projectName }
                        : { kind: "history" }
                    }
                  />
                )
              })
            )}
          </div>
        </div>
      </PopoverContent>
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
    "menu-item-hoverable flex h-9 w-(--sidebar-collapsed-item-width) items-center justify-center rounded-lg",
    "cursor-pointer",
    "hover:bg-sidebar-row active:bg-sidebar-row",
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
      <Tooltip disableHoverablePopup>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={className}
                  data-sidebar-item="true"
                  data-active={open ? "true" : undefined}
                  aria-label="Search"
                />
              }
            />
          }
        >
          <SidebarLeadingIcon icon={RiSearchLine} labelSpacing={false} />
        </TooltipTrigger>
        <TooltipContent side="right">
          <TooltipShortcut label="Search">
            <Kbd label="Command">⌘</Kbd>
            <Kbd>K</Kbd>
          </TooltipShortcut>
        </TooltipContent>
      </Tooltip>
      <PopoverContentAuth side="right" align="start" sideOffset={8} />
    </Popover>
  )
}

/**
 * Compact user avatar for collapsed rail.
 * 24px (h-6 w-6) matching the sidebar icon pattern.
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
              "menu-item-hoverable text-foreground mx-auto flex h-10 w-10 items-center justify-center rounded-[10px]",
              "hover:bg-sidebar-row active:bg-sidebar-row focus-visible:ring-focus-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
              open && "bg-sidebar-row"
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
        className="w-[calc(var(--sidebar-width)-0.75rem)] max-w-xs"
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
      <DropdownMenuSeparator />
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
      <DropdownMenuSeparator />
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
              "menu-item-hoverable group/help text-foreground hover:bg-sidebar-row hover:text-foreground active:bg-sidebar-row focus-visible:ring-focus-ring relative mx-1.5 inline-flex h-9 w-[calc(100%-var(--spacing)*3)] cursor-pointer items-center rounded-lg bg-transparent px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
              open && "bg-sidebar-row text-foreground"
            )}
            data-sidebar-item="true"
            aria-label="Help"
          />
        }
      >
        <SidebarLeadingIcon icon={RiQuestionLine} />
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
      className="menu-item-hoverable group/help-popover-item text-foreground hover:bg-sidebar-row hover:text-foreground active:bg-sidebar-row focus-visible:bg-sidebar-row focus-visible:text-foreground focus-visible:ring-focus-ring inline-flex h-9 w-full cursor-pointer items-center gap-(--sidebar-item-gap) rounded-lg bg-transparent px-2.5 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
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
