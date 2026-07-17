"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ProjectsDirectoryTab = "all" | "created" | "shared"

const TABS: Array<{ id: ProjectsDirectoryTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "created", label: "Created by you" },
  { id: "shared", label: "Shared with you" },
]

type ProjectFilterTabsProps = {
  tab: ProjectsDirectoryTab
  onTabChange: (tab: ProjectsDirectoryTab) => void
}

/**
 * The directory filter pills (captured: 36px rounded-full buttons, 14px/500;
 * the active tab carries the muted pill fill, inactive tabs are transparent
 * secondary text that darkens on hover). Buttons with `aria-current`, matching
 * the reference semantics. Scrolls horizontally on narrow viewports.
 */
export function ProjectFilterTabs({ tab, onTabChange }: ProjectFilterTabsProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-0 overflow-x-auto [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
      {TABS.map(({ id, label }) => {
        const isActive = tab === id
        return (
          <Button
            key={id}
            type="button"
            variant="ghost"
            onClick={() => onTabChange(id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "h-9 min-h-9 shrink-0 rounded-full px-4 text-sm font-medium",
              isActive
                ? "bg-muted text-foreground hover:bg-muted active:bg-muted"
                : "text-muted-foreground hover:text-foreground hover:bg-transparent active:bg-transparent"
            )}
          >
            {label}
          </Button>
        )
      })}
    </div>
  )
}
