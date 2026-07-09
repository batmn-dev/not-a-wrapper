"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { Icon } from "@/components/ui/icon"
import { useSidebar } from "@/components/ui/sidebar"
import { useInlineRename } from "@/hooks/use-inline-rename"
import { cn } from "@/lib/utils"
import { RiCheckLine, RiCloseLine } from "@remixicon/react"
import Link from "next/link"
import { useCallback, useMemo, type ReactNode } from "react"

type SidebarRowProps = {
  /** Navigation target for the resting row (the whole row is this `<Link>`). */
  href: string
  /** Drives the active tint + `aria-current`. Editing forces the tint on too. */
  isActive: boolean
  /** Truncating label; also the rename seed. */
  title: string
  /** Current persisted label the inline rename edits from. */
  renameValue: string
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
}

/**
 * The single editable/navigable compact row the sidebar's chat and project
 * lists render through (the **Sidebar row** module). It owns the structural
 * invariants both lists otherwise copy: the editing⇄resting swap, inline
 * rename, the click-outside-commit container, and the single-`<Link>`
 * nested-anchor recipe (trailing actions nest inside the anchor; the nested
 * trigger stops propagation so it opens without navigating — the "dead corners"
 * fix). Domain glue (which mutation, which active predicate, which menu) stays
 * in the thin caller adapters.
 */
export function SidebarRow({
  href,
  isActive,
  title,
  renameValue,
  onRename,
  leading,
  trailing,
}: SidebarRowProps) {
  const { setOpenMobile } = useSidebar()
  const isMobile = useBreakpoint(768)

  const {
    isEditing,
    start,
    inputRef,
    containerRef,
    inputProps,
    onContainerClick,
    onSaveClick,
    onCancelClick,
  } = useInlineRename(renameValue, onRename)

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
        "sidebar-row menu-item-hoverable hover:bg-[var(--sidebar-row-active-background)] hover:text-foreground group/row relative mx-1.5 flex h-9 w-[calc(100%-var(--spacing)*3)] items-center rounded-lg pointer-coarse:h-auto",
        (isActive || isEditing) &&
          "bg-[var(--sidebar-row-active-background)] hover:bg-[var(--sidebar-row-active-background)] text-foreground group-data-[collapsible=icon]:bg-transparent"
      ),
    [isActive, isEditing]
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
        <div className="flex h-full w-full items-center rounded-lg py-[3px] pr-1 pl-2">
          {leading && (
            <span className="mr-2 flex shrink-0 items-center">{leading}</span>
          )}
          <input
            ref={inputRef}
            {...inputProps}
            className="text-primary max-h-full w-full bg-transparent text-base focus:outline-none"
          />
          <div className="flex gap-0.5">
            <button
              onClick={onSaveClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-7 cursor-pointer items-center justify-center rounded-lg p-1"
              type="button"
              aria-label="Save rename"
            >
              <Icon icon={RiCheckLine} slotSize={16} />
            </button>
            <button
              onClick={onCancelClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-7 cursor-pointer items-center justify-center rounded-lg p-1"
              type="button"
              aria-label="Cancel rename"
            >
              <Icon icon={RiCloseLine} slotSize={16} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Resting/nav mode: the <Link> IS the whole row (ChatGPT's single `<a>`), with
  // the leading glyph, title, and the trailing actions nested INSIDE it. This is
  // the structural fix for the dead corners: `border-radius` clips pointer
  // hit-testing, so a trailing button's rounded-corner cutouts fall through to
  // the navigable Link instead of a non-navigable wrapper. The nested trigger
  // stops propagation, so activating it opens the menu without navigating.
  return (
    <Link
      href={href}
      className={cn(
        containerClassName,
        // ChatGPT's `.__menu-item` <a> box: symmetric 10px inline / 6px block
        // padding, so the title truncates 10px from the row edge. The trailing
        // button overflows this padding back to the edge via a hover-only
        // negative end-margin (see `.sidebar-row-action` in globals.css).
        "text-primary px-2.5 py-1.5 text-sm focus-visible:outline-none pointer-coarse:py-3"
      )}
      prefetch
      draggable={false}
      onClick={handleLinkClick}
      aria-current={isActive ? "page" : undefined}
    >
      <div className="flex min-w-0 grow items-center gap-2">
        {leading}
        <span className="min-w-0 grow truncate" dir="auto">
          {title}
        </span>
      </div>

      {trailing?.({ startRename: start })}
    </Link>
  )
}
