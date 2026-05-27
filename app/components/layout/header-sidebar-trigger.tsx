"use client"

import { Icon } from "@/components/ui/icon"
import { SIDEBAR_CONTAINER_ID, useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { RiMenuLine } from "@remixicon/react"
import { headerActionButtonClassName } from "./header-action-button"

type HeaderSidebarTriggerProps = React.HTMLAttributes<HTMLButtonElement>

export function HeaderSidebarTrigger({
  className,
  ...props
}: HeaderSidebarTriggerProps) {
  const { toggleSidebar, openMobile } = useSidebar()

  return (
    <button
      type="button"
      data-testid="open-sidebar-button"
      aria-expanded={openMobile}
      aria-controls={SIDEBAR_CONTAINER_ID}
      onClick={toggleSidebar}
      className={cn(
        "pointer-events-auto inline-flex size-9 items-center justify-center pointer-coarse:h-10 pointer-coarse:w-10",
        headerActionButtonClassName,
        "active:opacity-50",
        "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        className
      )}
      {...props}
    >
      <Icon icon={RiMenuLine} slotSize={20} aria-hidden="true" />
      <span className="sr-only">Open sidebar</span>
    </button>
  )
}
