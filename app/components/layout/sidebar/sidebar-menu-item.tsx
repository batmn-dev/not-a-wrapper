"use client"

import { cn } from "@/lib/utils"
import Link from "next/link"
import { forwardRef, type ReactNode, type Ref } from "react"

type SidebarMenuItemProps = {
  /** Icon node */
  icon: ReactNode
  /** Label text */
  label: string
  /** Navigation href - renders as Link if provided */
  href?: string
  /** Click handler - used when no href (e.g., opens modal) */
  onClick?: () => void
  /** Trailing content (keyboard shortcuts, badges, etc.) */
  trailing?: ReactNode
  /** Test ID for e2e testing */
  testId?: string
  /** Additional className */
  className?: string
  /** Whether item is currently active */
  isActive?: boolean
}

const baseClassName = cn(
  "group/menu-item relative inline-flex w-[calc(100%-var(--spacing)*3)] items-center rounded-lg bg-transparent text-sm mx-1.5",
  // Explicit height for consistency with collapsed state (h-9 = 36px)
  "h-9 pointer-coarse:h-auto",
  // Spacing using CSS variables
  "gap-(--sidebar-item-gap) px-2.5 py-1.5 pointer-coarse:py-3",
  // Native buttons default to cursor: default; sidebar rows should feel clickable.
  "cursor-pointer",
  // Colors (instant hover — no transition)
  "text-primary hover:bg-accent/80 hover:text-foreground",
  // Focus states
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
)

/**
 * Unified sidebar menu item component.
 *
 * Features:
 * - Icon wrapper pattern (ChatGPT style) for consistent alignment
 * - motion-safe: transitions for reduced motion support
 * - CSS variables for spacing
 */
export const SidebarMenuItem = forwardRef<
  HTMLAnchorElement | HTMLButtonElement,
  SidebarMenuItemProps
>(function SidebarMenuItem(
  { icon, label, href, onClick, trailing, testId, className, isActive },
  ref
) {
  const hasTrailing = Boolean(trailing)

  const content = (
    <>
      {/* Icon wrapper (ChatGPT pattern) for consistent alignment */}
      <div className="flex shrink-0 items-center justify-center">{icon}</div>
      <div className="flex min-w-0 grow items-center gap-(--sidebar-item-gap)">
        <span className="truncate">{label}</span>
      </div>
      {trailing && (
        <div className="text-muted-foreground shrink-0 opacity-0 group-hover/menu-item:opacity-100">
          {trailing}
        </div>
      )}
    </>
  )

  const combinedClassName = cn(
    baseClassName,
    hasTrailing && "justify-between",
    isActive && "bg-accent",
    className
  )

  const itemElement = href ? (
    <Link
      ref={ref as Ref<HTMLAnchorElement>}
      href={href}
      className={combinedClassName}
      data-testid={testId}
      data-sidebar-item="true"
      prefetch
    >
      {content}
    </Link>
  ) : (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type="button"
      onClick={onClick}
      className={combinedClassName}
      data-testid={testId}
      data-sidebar-item="true"
    >
      {content}
    </button>
  )

  return itemElement
})
