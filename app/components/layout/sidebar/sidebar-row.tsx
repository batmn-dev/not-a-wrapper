"use client"

import { InlineRenameInput } from "@/components/ui/inline-rename-input"
import { useSidebar } from "@/components/ui/sidebar"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { useInlineRename } from "@/hooks/use-inline-rename"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useCallback, useMemo, type ReactNode } from "react"

type SidebarRowInteraction =
  | { kind: "link"; href: string }
  | {
      kind: "disclosure"
      expanded: boolean
      controls: string
      onToggle: () => void
    }

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
  /** Optional leading glyph, rendered in both resting and editing modes. */
  leading?: ReactNode
  /**
   * Trailing actions. A render prop, not a plain slot: the menu it returns must
   * be able to launch inline rename (`startRename`) while `useInlineRename`
   * stays owned by the shell.
   */
  trailing?: (controls: { startRename: () => void }) => ReactNode
  /** Stable geometry variant rather than a caller-owned padding correction. */
  indentation?: "standard" | "nested"
}

/**
 * The single editable/navigable compact row the sidebar's chat and project
 * lists render through (the **Sidebar row** module). It owns the structural
 * invariants both lists otherwise copy: the editing⇄resting swap, inline
 * rename, and the click-outside-commit container. Chat rows use the
 * primary link with sibling actions; expandable project rows use a primary
 * button with sibling navigation/actions so neither row type nests interactive
 * controls. Domain glue stays in the thin caller adapters.
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
  leading,
  trailing,
  indentation = "standard",
}: SidebarRowProps) {
  const { setOpenMobile } = useSidebar()
  const isMobile = useBreakpoint(768)

  const { isEditing, start, containerRef, inputProps, onContainerClick } =
    useInlineRename(renameValue, onRename)

  const handleLinkClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isMobile) setOpenMobile(false)
    },
    [isMobile, setOpenMobile]
  )

  // hover == selected == menu-open, all driven off the one translucent
  // --sidebar-row-active-background token (ChatGPT uses the same value for every
  // state — no stronger active tint, no /80 hover). Editing pins the tint on.
  // The trailing reveal keys off `.sidebar-row`, so a single `group/row` scope
  // is enough (the old per-row group/chat·group/project names were vestigial).
  const containerClassName = useMemo(
    () =>
      cn(
        "sidebar-row sidebar-menu-row sidebar-row-shell menu-item-hoverable text-foreground hover:bg-[var(--sidebar-row-active-background)] hover:text-foreground group/row relative flex items-center text-sm",
        indentation === "nested" && "sidebar-row-nested",
        (isActive || isEditing) &&
          "bg-[var(--sidebar-row-active-background)] hover:bg-[var(--sidebar-row-active-background)] group-data-[collapsible=icon]:bg-transparent"
      ),
    [indentation, isActive, isEditing]
  )

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
          {leading && (
            <span className="mr-2 flex shrink-0 items-center">{leading}</span>
          )}
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
    <div className="flex min-w-0 grow items-center gap-(--sidebar-row-leading-gap)">
      {leading ? <span className="shrink-0">{leading}</span> : null}
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

  if (interaction.kind === "disclosure") {
    return (
      <div className={containerClassName}>
        <button
          type="button"
          className="sidebar-row-content sidebar-row-primary-control sidebar-project-row-primary flex h-full min-w-0 grow items-center text-start outline-none"
          onClick={interaction.onToggle}
          aria-expanded={interaction.expanded}
          aria-controls={interaction.controls}
          aria-label={ariaLabel}
          data-sidebar-item="true"
          data-active={isActive ? "" : undefined}
        >
          {rowContent}
        </button>
        {trailing?.({ startRename: start })}
      </div>
    )
  }

  // Resting/nav mode keeps the primary link and its trailing controls as
  // siblings. The link grows across every unclaimed pixel; revealing the
  // in-flow action slot shrinks it without introducing nested interactive HTML.
  return (
    <div className={containerClassName}>
      <Link
        href={interaction.href}
        className="sidebar-row-content sidebar-row-primary-control flex h-full min-w-0 grow items-center focus-visible:outline-none"
        prefetch
        draggable={false}
        onClick={handleLinkClick}
        aria-current={isActive ? "page" : undefined}
        aria-label={ariaLabel}
        data-sidebar-item="true"
        data-active={isActive ? "" : undefined}
      >
        {rowContent}
      </Link>
      {trailing?.({ startRename: start })}
    </div>
  )
}
