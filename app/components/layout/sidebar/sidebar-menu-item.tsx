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
  icon?: IconProps["icon"]
  activeIcon?: IconProps["icon"]
  label: string
  href?: string
  onClick?: MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>
  trailing?: ReactNode
  /**
   * Set when `trailing` is an interactive control (not a passive hint): keeps
   * it reachable by revealing on focus-within and on touch devices, where
   * hover-only reveal would make it inoperable.
   */
  trailingInteractive?: boolean
  testId?: string
  className?: string
  isActive?: boolean
}

const baseClassName = cn(
  "sidebar-menu-row sidebar-row-content menu-item-hoverable group/menu-item relative inline-flex items-center bg-transparent text-sm",
  "cursor-pointer",
  "disabled:cursor-not-allowed disabled:hover:bg-transparent",
  "aria-disabled:cursor-not-allowed aria-disabled:hover:bg-transparent",
  "text-foreground hover:bg-sidebar-row hover:text-foreground active:bg-sidebar-row",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
)

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
      {icon ? (
        <SidebarLeadingIcon
          icon={icon}
          activeIcon={activeIcon}
          isActive={isActive}
        />
      ) : null}
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
      "bg-sidebar-row text-foreground hover:bg-sidebar-row",
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
