"use client"
import { RiArrowRightSLine } from "@remixicon/react"

import * as React from "react"
import { Collapsible } from "@base-ui/react/collapsible"
import { cn } from "@/lib/utils"

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
    <Collapsible.Root
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        "group/collapsible-section",
        isSidebarVariant && "group/sidebar-expando-section",
        className
      )}
    >
      <Collapsible.Trigger
        className={cn(
          "flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isSidebarVariant
            ? [
                "w-full justify-start gap-0.5 px-4 py-1.5",
                "text-sidebar-foreground/50 hover:text-sidebar-foreground/70",
              ]
            : [
                "w-full gap-1 px-2 py-1.5",
                "text-muted-foreground hover:text-foreground",
              ]
        )}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        {isSidebarVariant ? (
          <span className="__menu-label truncate text-sm font-medium">{title}</span>
        ) : (
          <span className="truncate">{title}</span>
        )}
        <RiArrowRightSLine
          size={12}
          className={cn(
            "h-3 w-3 shrink-0 motion-safe:transition-all duration-150",
            isOpen
              ? "rotate-90 opacity-0 group-hover/collapsible-section:opacity-100 group-hover/sidebar-expando-section:opacity-100"
              : "opacity-100"
          )}
        />
      </Collapsible.Trigger>

      <Collapsible.Panel
        className={cn(
          "overflow-hidden",
          "data-[open]:animate-collapsible-down",
          "data-[closed]:animate-collapsible-up"
        )}
      >
        <div className={cn(isSidebarVariant ? "pt-0.5" : "pt-1")}>{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
