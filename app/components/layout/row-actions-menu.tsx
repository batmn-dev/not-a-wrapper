"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { RiLoader4Line, RiMoreFill } from "@remixicon/react"
import { Fragment, type ReactElement, type ReactNode } from "react"
import {
  trailingIconButtonClassName,
  TrailingIconChip,
} from "./sidebar/trailing-icon-button"

export type RowActionItem = {
  key: string
  /** Rendered as-is (an <Icon/> or a lucide glyph); replaced by a spinner while `loading`. */
  icon: ReactNode
  label: string
  onSelect: () => void
  variant?: "default" | "destructive"
  loading?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

type RowActionsMenuProps = {
  items: RowActionItem[]
  /** Custom trigger; falls back to the shared ⋯ chip. */
  trigger?: ReactElement
  triggerAriaLabel?: string
  contentAlign?: "start" | "center" | "end"
  contentSide?: "top" | "right" | "bottom" | "left"
  onOpenChange?: (open: boolean) => void
}

/**
 * The single row-actions dropdown both the chat and project row menus run
 * through: the shared ⋯ trigger chip, the mobile-safe dropdown shell, and
 * config-driven items. Callers pass their item set and own their own
 * confirmation dialogs (the "Delete" item just fires `onSelect`).
 */
export function RowActionsMenu({
  items,
  trigger,
  triggerAriaLabel,
  contentAlign = "start",
  contentSide = "bottom",
  onOpenChange,
}: RowActionsMenuProps) {
  const isMobile = useBreakpoint(768)

  const defaultTrigger = (
    <button
      type="button"
      // ChatGPT's __menu-item-trailing-btn: a 34×36 hit area with NO background —
      // only the icon color shifts (tertiary→foreground); the keyboard focus ring
      // lives on the inner chip (TrailingIconChip). Nested inside the row's
      // <Link>, so a bare click would navigate — preventDefault cancels the nav
      // (and tells Next's Link to skip), stopPropagation keeps it off the row.
      className={trailingIconButtonClassName}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      aria-label={triggerAriaLabel ?? "Open actions"}
    />
  )

  return (
    <DropdownMenu
      // shadcn/ui pointer-events-none issue on mobile
      modal={isMobile ? true : false}
      onOpenChange={onOpenChange}
    >
      <DropdownMenuTrigger render={trigger ?? defaultTrigger}>
        {/* No color class: the glyph inherits the trigger's currentColor so it
            tracks the tertiary→foreground hover shift. Only rendered for the
            default trigger; a custom trigger brings its own content. */}
        {!trigger && (
          <TrailingIconChip>
            <Icon icon={RiMoreFill} slotSize={20} />
          </TrailingIconChip>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={contentSide}
        align={contentAlign}
        className="w-40"
        animated={false}
      >
        {items.map((item) => (
          <Fragment key={item.key}>
            {item.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant={item.variant}
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation()
                item.onSelect()
              }}
            >
              {item.loading ? (
                <Icon
                  icon={RiLoader4Line}
                  slotSize={20}
                  className="animate-spin"
                />
              ) : (
                item.icon
              )}
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
