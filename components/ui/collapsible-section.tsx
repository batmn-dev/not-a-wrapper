"use client"

import { Icon } from "@/components/ui/icon"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { RiArrowRightSLine } from "@remixicon/react"
import * as React from "react"

type CollapsibleSectionProps = {
  /** Section title */
  title: string
  /** Optional icon before title */
  icon?: React.ReactNode
  /** Section content */
  children: React.ReactNode
  /** Initial expanded state */
  defaultOpen?: boolean
  /** localStorage key for persistence */
  storageKey?: string
  /** Additional className for the container */
  className?: string
  /** Visual style variant */
  variant?: "default" | "sidebar"
}

export function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = true,
  storageKey,
  className,
  variant = "default",
}: CollapsibleSectionProps) {
  // Initialize with defaultOpen to match SSR
  const [isOpen, setIsOpen] = React.useState(defaultOpen)

  // Sync from localStorage on mount (client-only) to avoid hydration mismatch
  React.useEffect(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey)
      if (stored !== null) {
        setIsOpen(stored === "true")
      }
    }
  }, [storageKey])

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      setIsOpen(open)
      if (storageKey) {
        localStorage.setItem(storageKey, String(open))
      }
    },
    [storageKey]
  )

  const isSidebarVariant = variant === "sidebar"

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        "group/collapsible-section",
        isSidebarVariant && "group/sidebar-expando-section",
        className
      )}
    >
      <CollapsibleTrigger
        className={cn(
          "focus-visible:ring-ring flex items-center rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          isSidebarVariant
            ? [
                "w-full justify-start gap-0.5 px-4 py-1.5",
                "text-foreground transition-none",
              ]
            : [
                "w-full gap-1 px-2 py-1.5",
                "text-muted-foreground hover:text-foreground",
              ]
        )}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        {isSidebarVariant ? (
          <span className="__menu-label truncate text-sm font-medium">
            {title}
          </span>
        ) : (
          <span className="truncate">{title}</span>
        )}
        <Icon
          icon={RiArrowRightSLine}
          slotSize={isSidebarVariant ? 16 : 12}
          className={cn(
            isSidebarVariant ? "size-4" : "size-3",
            "shrink-0",
            isSidebarVariant
              ? "transition-none"
              : "duration-150 motion-safe:transition-all",
            isOpen
              ? "rotate-90 opacity-0 group-hover/collapsible-section:opacity-100 group-hover/sidebar-expando-section:opacity-100"
              : "opacity-100"
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent
        className={cn(
          "overflow-hidden",
          "data-[open]:animate-collapsible-down",
          "data-[closed]:animate-collapsible-up"
        )}
      >
        <div className={cn(isSidebarVariant ? "pt-0.5" : "pt-1")}>
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
