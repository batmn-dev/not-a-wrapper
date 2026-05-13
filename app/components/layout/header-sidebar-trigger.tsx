"use client"
import { RiMenuLine } from "@remixicon/react"

import { useSidebar } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type HeaderSidebarTriggerProps = React.HTMLAttributes<HTMLButtonElement>

export function HeaderSidebarTrigger({
  className,
  ...props
}: HeaderSidebarTriggerProps) {
  const { toggleSidebar, open } = useSidebar()

  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(
              "pointer-events-auto",
              "text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors",
              "inline-flex size-9 items-center justify-center focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
              className
            )}
            {...props}
          />
        }
      >
        <RiMenuLine size={20} className="size-5" />
        <span className="sr-only">Toggle sidebar</span>
      </TooltipTrigger>
      <TooltipContent>
        {open
          ? "Close sidebar ⇧⌘S"
          : "Open sidebar ⇧⌘S"}
      </TooltipContent>
    </Tooltip>
  )
}
