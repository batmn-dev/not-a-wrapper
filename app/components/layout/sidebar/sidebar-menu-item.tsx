"use client"

import { cn } from "@/lib/utils"
import Link from "next/link"
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type MouseEventHandler,
  type ReactNode,
  type Ref,
} from "react"

type SidebarMenuItemProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "children" | "className" | "type" | "onClick"
> & {
  /** Icon node */
  icon: ReactNode
  /** Icon node used when the item is active */
  activeIcon?: ReactNode
  /** Label text */
  label: string
  /** Navigation href - renders as Link if provided */
  href?: string
  /** Click handler - used for navigation close behavior or button actions */
  onClick?: MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>
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
  "menu-item-hoverable group/menu-item relative inline-flex w-[calc(100%-var(--spacing)*3)] items-center rounded-lg bg-transparent text-sm mx-1.5",
  // Explicit height for consistency with collapsed state (h-9 = 36px)
  "h-9 pointer-coarse:h-auto",
  // Spacing using CSS variables
  "gap-(--sidebar-item-gap) px-2.5 py-1.5 pointer-coarse:py-3",
  // Native buttons default to cursor: default; sidebar rows should feel clickable.
  "cursor-pointer",
  "disabled:cursor-not-allowed disabled:hover:bg-transparent",
  "aria-disabled:cursor-not-allowed aria-disabled:hover:bg-transparent",
  // Colors (instant hover — no transition)
  "text-foreground hover:bg-sidebar-row hover:text-foreground active:bg-sidebar-row",
  // Focus states
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
)

/**
 * Unified sidebar menu item component.
 *
 * Features:
 * - Icon wrapper pattern for consistent alignment
 * - motion-safe: transitions for reduced motion support
 * - CSS variables for spacing
 */
export const SidebarMenuItem = forwardRef<
  HTMLAnchorElement | HTMLButtonElement,
  SidebarMenuItemProps
>(function SidebarMenuItem(
  {
    icon,
    activeIcon,
    label,
    href,
    onClick,
    trailing,
    testId,
    className,
    isActive,
    ...buttonProps
  },
  ref
) {
  const hasTrailing = Boolean(trailing)
  const resolvedIcon = isActive && activeIcon ? activeIcon : icon

  const content = (
    <>
      {/* Icon wrapper for consistent alignment */}
      <div className="flex shrink-0 items-center justify-center">
        {resolvedIcon}
      </div>
      <div className="flex min-w-0 grow items-center gap-(--sidebar-item-gap)">
        <span className="truncate">{label}</span>
      </div>
      {trailing && (
        <div className="shrink-0 text-[var(--text-tertiary)] opacity-0 group-hover/menu-item:opacity-100">
          {trailing}
        </div>
      )}
    </>
  )

  const combinedClassName = cn(
    baseClassName,
    hasTrailing && "justify-between",
    isActive &&
      "bg-sidebar-row text-foreground hover:bg-sidebar-row group-data-[collapsible=icon]:bg-transparent",
    className
  )

  const itemElement = href ? (
    <Link
      ref={ref as Ref<HTMLAnchorElement>}
      href={href}
      onClick={onClick as MouseEventHandler<HTMLAnchorElement> | undefined}
      className={combinedClassName}
      data-testid={testId}
      data-sidebar-item="true"
      data-active={isActive ? "true" : undefined}
      aria-current={isActive ? "page" : undefined}
      prefetch
    >
      {content}
    </Link>
  ) : (
    <button
      {...buttonProps}
      ref={ref as Ref<HTMLButtonElement>}
      type="button"
      onClick={onClick as MouseEventHandler<HTMLButtonElement> | undefined}
      className={combinedClassName}
      data-testid={testId}
      data-sidebar-item="true"
      data-active={isActive ? "true" : undefined}
    >
      {content}
    </button>
  )

  return itemElement
})
