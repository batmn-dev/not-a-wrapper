"use client"

import type { IconProps } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import Link from "next/link"
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type MouseEventHandler,
  type ReactNode,
  type Ref,
} from "react"
import { SidebarLeadingIcon } from "./sidebar-leading-icon"

type SidebarMenuItemProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "children" | "className" | "type" | "onClick"
> & {
  /** Icon rendered through the shared sidebar leading slot. */
  icon: IconProps["icon"]
  /** Icon used when active; the shared slot keeps its geometry fixed. */
  activeIcon?: IconProps["icon"]
  /** Label text */
  label: string
  /** Navigation href - renders as Link if provided */
  href?: string
  /** Click handler - used for navigation close behavior or button actions */
  onClick?: MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>
  /** Trailing content (keyboard shortcuts, badges, etc.) */
  trailing?: ReactNode
  /**
   * Set when `trailing` is an interactive control (not a passive hint): keeps
   * it reachable by revealing on focus-within and on touch devices, where
   * hover-only reveal would make it inoperable.
   */
  trailingInteractive?: boolean
  /** Test ID for e2e testing */
  testId?: string
  /** Additional className */
  className?: string
  /** Whether item is currently active */
  isActive?: boolean
}

const baseClassName = cn(
  "sidebar-menu-row sidebar-row-content menu-item-hoverable group/menu-item relative inline-flex items-center bg-transparent text-sm",
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
    trailingInteractive,
    testId,
    className,
    isActive,
    ...buttonProps
  },
  ref
) {
  const hasTrailing = Boolean(trailing)
  const primaryContent = (
    <>
      <SidebarLeadingIcon
        icon={icon}
        activeIcon={activeIcon}
        isActive={isActive}
      />
      <div className="flex min-w-0 grow items-center gap-(--sidebar-item-gap)">
        <span className="truncate">{label}</span>
      </div>
    </>
  )

  const trailingContent = trailing ? (
    <div
      className={cn(
        "shrink-0 text-[var(--text-tertiary)] opacity-0 group-hover/menu-item:opacity-100",
        trailingInteractive &&
          "relative z-10 group-focus-within/menu-item:opacity-100 pointer-coarse:opacity-100"
      )}
    >
      {trailing}
    </div>
  ) : null

  const combinedClassName = cn(
    baseClassName,
    hasTrailing && "justify-between",
    isActive &&
      "bg-sidebar-row text-foreground hover:bg-sidebar-row group-data-[collapsible=icon]:bg-transparent",
    className
  )

  if (href && trailingInteractive) {
    return (
      <div
        className={cn(combinedClassName, "gap-0")}
        data-active={isActive ? "true" : undefined}
      >
        <Link
          ref={ref as Ref<HTMLAnchorElement>}
          href={href}
          onClick={onClick as MouseEventHandler<HTMLAnchorElement> | undefined}
          className="sidebar-row-primary-control after:absolute after:inset-0 flex h-full min-w-0 grow items-center rounded-lg focus-visible:outline-none"
          data-testid={testId}
          data-sidebar-item="true"
          data-active={isActive ? "true" : undefined}
          aria-current={isActive ? "page" : undefined}
          prefetch
        >
          {primaryContent}
        </Link>
        {trailingContent}
      </div>
    )
  }

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
      {primaryContent}
      {trailingContent}
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
      {primaryContent}
      {trailingContent}
    </button>
  )

  return itemElement
})
