"use client"
import { RiMenuLine } from "@remixicon/react"

import { SIDEBAR_CONTAINER_ID, useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

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
        "pointer-events-auto inline-flex size-9 items-center justify-center rounded-md transition-colors pointer-coarse:h-10 pointer-coarse:w-10",
        "text-muted-foreground hover:bg-muted hover:text-foreground active:opacity-50",
        "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        className
      )}
      {...props}
    >
      <RiMenuLine size={20} className="size-5" aria-hidden="true" />
      <span className="sr-only">Open sidebar</span>
    </button>
  )
}
