"use client"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { RiSideBarLine } from "@remixicon/react"
import * as React from "react"

/**
 * Sidebar state/shell layer: provider (collapse state, persistence, keyboard
 * shortcut), the desktop frame, and the toggle trigger.
 *
 * This file deliberately owns NO row/menu vocabulary. The canonical sidebar
 * rows are the components in `app/components/layout/sidebar/`
 * (`SidebarMenuItem`, `SidebarRow`, `SidebarLeadingIcon`, …), styled by the
 * `--sidebar-*` token contract in `app/globals.css` and pinned by
 * `sidebar-geometry.test.ts`. Do not reintroduce a parallel menu system here.
 *
 * Widths are owned by `app/globals.css` (`--sidebar-width`,
 * `--sidebar-width-icon`), not by TS constants, so the frame and the app's
 * collapsed rail derive from one source.
 */

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_KEYBOARD_SHORTCUT = "s"
const SIDEBAR_CONTAINER_ID = "sidebar-container"

function getSidebarStateFromCookie(): boolean | undefined {
  if (typeof document === "undefined") return undefined
  const match = document.cookie.match(
    new RegExp(`${SIDEBAR_COOKIE_NAME}=([^;]+)`)
  )
  if (match) return match[1] === "true"
  return undefined
}

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
  /** See useSidebarShortcutScope — consumers don't call this directly. */
  registerShortcutScope: () => () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open

  React.useEffect(() => {
    const cookieValue = getSidebarStateFromCookie()
    if (cookieValue !== undefined && cookieValue !== _open) {
      _setOpen(cookieValue)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time cookie sync on mount; getSidebarStateFromCookie reads document.cookie (unavailable during SSR)
  }, [])
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // ⌘⇧S shortcut scope. The provider is mounted once at the root layout, but
  // the shortcut (and the cookie write toggling triggers) must not fire on
  // routes whose sidebar ignores collapse state (e.g. /design-system, whose
  // sidebar is `collapsible="none"` — toggling there would silently rewrite
  // the persisted state the app sidebar restores). Surfaces that respond to
  // the toggle register a scope via useSidebarShortcutScope; the listener
  // attaches only while at least one scope is mounted.
  const shortcutScopes = React.useRef(0)
  const [shortcutEnabled, setShortcutEnabled] = React.useState(false)
  const registerShortcutScope = React.useCallback(() => {
    shortcutScopes.current += 1
    setShortcutEnabled(true)
    return () => {
      shortcutScopes.current -= 1
      if (shortcutScopes.current === 0) setShortcutEnabled(false)
    }
  }, [])

  React.useEffect(() => {
    if (!shortcutEnabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.shiftKey &&
        event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [shortcutEnabled, toggleSidebar])

  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
      registerShortcutScope,
    }),
    [
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
      registerShortcutScope,
    ]
  )

  // No TooltipProvider here: the root layout already mounts one (delay 0)
  // above this provider.
  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={style}
        className={cn("group/sidebar-wrapper flex min-h-svh w-full", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

/**
 * Enables the ⌘⇧S toggle shortcut while the calling surface is mounted. The
 * app sidebar calls this; a surface whose sidebar ignores collapse state
 * (the design-system registry) doesn't, keeping the shortcut inert there.
 */
function useSidebarShortcutScope() {
  const { registerShortcutScope } = useSidebar()

  React.useEffect(() => registerShortcutScope(), [registerShortcutScope])
}

/**
 * The sidebar frame. `collapsible="icon"` renders the desktop shell that
 * animates between `--sidebar-width` and `--sidebar-width-icon`;
 * `collapsible="none"` renders a static full-width column (used by the
 * design-system registry chrome). Mobile presentation is owned by the
 * consumer (the app renders its own Sheet drawer); this frame renders
 * `hidden md:block` and has no mobile branch.
 */
function Sidebar({
  collapsible = "icon",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  collapsible?: "icon" | "none"
}) {
  const { state } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "bg-sidebar text-sidebar-foreground flex h-full w-(--sidebar-width) flex-col",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-slot="sidebar"
    >
      {/* The gap and fixed container must use identical motion so both width
          owners stay in lockstep. */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-(--sidebar-width) bg-transparent motion-safe:transition-[width] motion-safe:duration-[450ms] motion-safe:ease-[linear(0,0.126,0.3555,0.5713,0.7361,0.8485,0.9191,0.9603,0.9828,0.9941,0.9992,1.0011,1.0015,1.0013,1.001,1.0007,1.0004,1.0002,1.0001)]",
          "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
        )}
      />
      <div
        id={SIDEBAR_CONTAINER_ID}
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 left-0 z-10 hidden h-svh w-(--sidebar-width) overflow-hidden motion-safe:transition-[left,right,width,background-color] motion-safe:duration-[450ms] motion-safe:ease-[linear(0,0.126,0.3555,0.5713,0.7361,0.8485,0.9191,0.9603,0.9828,0.9941,0.9992,1.0011,1.0015,1.0013,1.001,1.0007,1.0004,1.0002,1.0001)] md:flex",
          "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex h-full w-full flex-col"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar, state, open } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      aria-expanded={open}
      aria-controls={SIDEBAR_CONTAINER_ID}
      className={cn(
        "size-9 rounded-md",
        state === "collapsed"
          ? "cursor-e-resize rtl:cursor-w-resize"
          : "cursor-w-resize rtl:cursor-e-resize",
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <Icon
        icon={RiSideBarLine}
        slotSize={20}
        glyphInset={0}
        className="group-hover/button:text-foreground size-5 text-[var(--text-tertiary)]"
      />
      <span className="sr-only">{open ? "Close sidebar" : "Open sidebar"}</span>
    </Button>
  )
}

export {
  Sidebar,
  SIDEBAR_CONTAINER_ID,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
  useSidebarShortcutScope,
}
