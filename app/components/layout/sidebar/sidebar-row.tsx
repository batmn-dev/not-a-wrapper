"use client"

import type { IconProps } from "@/components/ui/icon"
import { InlineRenameInput } from "@/components/ui/inline-rename-input"
import { useSidebar } from "@/components/ui/sidebar"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { useInlineRename } from "@/hooks/use-inline-rename"
import { markChatNavigationIntent } from "@/lib/observability/chat-performance-client"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useCallback, useMemo, type ReactNode } from "react"
import { SidebarLeadingIcon } from "./sidebar-leading-icon"

type SidebarRowInteraction = { kind: "link"; href: string }

type SidebarRowProps = {
  interaction: SidebarRowInteraction
  /** Drives the active tint + `aria-current`. Editing forces the tint on too. */
  isActive: boolean
  /** Truncating label; also the rename seed. */
  title: string
  /** Optional inline provenance shown after the primary title. */
  secondaryLabel?: string
  /** Accessible name when visible provenance needs to be announced. */
  ariaLabel?: string
  /** Current persisted label the inline rename edits from. */
  renameValue: string
  /** Accessible name for the title editor on this row type. */
  renameLabel: string
  /** Persist + error handling live here — the shell only owns the edit UX. */
  onRename: (next: string) => void | Promise<void>
  /** Optional leading glyph, rendered through the shared slot in every state. */
  leadingIcon?: IconProps["icon"]
  /** Optional active-state glyph swap; the shared slot keeps its geometry fixed. */
  activeLeadingIcon?: IconProps["icon"]
  /**
   * Trailing actions. A render prop, not a plain slot: the menu it returns must
   * be able to launch inline rename (`startRename`) while `useInlineRename`
   * stays owned by the shell.
   */
  trailing?: (controls: { startRename: () => void }) => ReactNode
}

/**
 * The single editable/navigable compact row the sidebar's chat and project
 * lists render through (the **Sidebar row** module). It owns the structural
 * invariants both lists otherwise copy: the editing⇄resting swap, inline
 * rename, and the click-outside-commit container. Chat and project rows use a
 * full-row primary link with its trailing action cluster. Domain glue stays in
 * the thin caller adapters.
 */
export function SidebarRow({
  interaction,
  isActive,
  title,
  secondaryLabel,
  ariaLabel,
  renameValue,
  renameLabel,
  onRename,
  leadingIcon,
  activeLeadingIcon,
  trailing,
}: SidebarRowProps) {
  const { setOpenMobile } = useSidebar()
  const isMobile = useBreakpoint(768)

  const { isEditing, start, containerRef, inputProps, onContainerClick } =
    useInlineRename(renameValue, onRename)

  const handleLinkClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      // Chat-switch responsiveness anchor: the user's navigation
      // intent, marked before Next.js routing commits. Content-free no-op
      // unless instrumentation is enabled.
      markChatNavigationIntent()
      if (isMobile) setOpenMobile(false)
    },
    [isMobile, setOpenMobile]
  )

  // Hover, selected, and menu-open use one translucent token. Editing pins it.
  // The trailing reveal keys off `.sidebar-row`, so a single `group/row` scope
  // is enough (the old per-row group/chat·group/project names were vestigial).
  const containerClassName = useMemo(
    () =>
      cn(
        "sidebar-row sidebar-menu-row sidebar-row-shell menu-item-hoverable text-foreground hover:bg-[var(--sidebar-row-active-background)] hover:text-foreground group/row relative flex items-center text-sm",
        (isActive || isEditing) &&
          "bg-[var(--sidebar-row-active-background)] hover:bg-[var(--sidebar-row-active-background)]"
      ),
    [isActive, isEditing]
  )
  const leading = leadingIcon ? (
    <SidebarLeadingIcon
      icon={leadingIcon}
      activeIcon={activeLeadingIcon}
      isActive={isActive}
    />
  ) : null

  // Rename mode keeps the plain <div> container (it needs containerRef for
  // click-outside-commits and swaps the whole row for an input).
  if (isEditing) {
    return (
      <div
        className={containerClassName}
        onClick={onContainerClick}
        ref={containerRef}
      >
        <div className="sidebar-row-content flex h-full w-full items-center">
          {leading}
          <InlineRenameInput
            {...inputProps}
            aria-label={renameLabel}
            className="max-h-full w-full"
          />
        </div>
      </div>
    )
  }

  const rowContent = (
    <div className="flex min-w-0 grow items-center">
      {leading}
      <div className="flex min-w-0 grow items-center gap-2">
        <span className="min-w-0 truncate" dir="auto">
          {title}
        </span>
        {secondaryLabel ? (
          <span
            className="min-w-0 shrink truncate text-[var(--text-tertiary)]"
            dir="auto"
          >
            {secondaryLabel}
          </span>
        ) : null}
      </div>
    </div>
  )

  // The title lane and trailing controls share one full-row anchor. At rest
  // the trailing item is visually clipped and absolutely
  // positioned; on hover/focus/menu-open it returns to flex flow, contributing
  // 44px plus the row's 8px gap. Short labels therefore remain unchanged while
  // only labels wider than the remaining lane truncate earlier.
  return (
    <Link
      href={interaction.href}
      className={cn(
        containerClassName,
        "sidebar-row-content sidebar-row-primary-control gap-(--sidebar-row-action-content-gap) focus-visible:outline-none"
      )}
      prefetch
      draggable={false}
      onClick={handleLinkClick}
      aria-current={isActive ? "page" : undefined}
      aria-label={ariaLabel}
      data-sidebar-item="true"
      data-active={isActive ? "" : undefined}
    >
      {rowContent}
      {trailing?.({ startRename: start })}
    </Link>
  )
}
