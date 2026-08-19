"use client"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiArrowRightSLine } from "@remixicon/react"
import * as React from "react"

type CollapsibleSectionProps = {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  headerActions?: React.ReactNode
  defaultOpen?: boolean
  storageKey?: string
  className?: string
  variant?: "default" | "sidebar"
}

const COLLAPSIBLE_SECTION_CHEVRON_GEOMETRY = {
  default: { slotSize: 12, glyphSize: 10 },
  sidebar: { slotSize: 16, glyphSize: 14 },
} as const

export function CollapsibleSection({
  title,
  icon,
  children,
  headerActions,
  defaultOpen = true,
  storageKey,
  className,
  variant = "default",
}: CollapsibleSectionProps) {
  const [unpersistedOpen, setUnpersistedOpen] = React.useState(defaultOpen)
  const subscribeToStoredOpen = React.useCallback(
    (onStoreChange: () => void) => {
      if (!storageKey) return () => undefined

      const handleStorage = (event: StorageEvent) => {
        if (event.key === storageKey) onStoreChange()
      }
      window.addEventListener("storage", handleStorage)
      return () => window.removeEventListener("storage", handleStorage)
    },
    [storageKey]
  )
  const getStoredOpen = React.useCallback(() => {
    if (!storageKey) return defaultOpen
    const stored = localStorage.getItem(storageKey)
    return stored === null ? defaultOpen : stored === "true"
  }, [defaultOpen, storageKey])
  const getServerOpen = React.useCallback(() => defaultOpen, [defaultOpen])
  const persistedOpen = React.useSyncExternalStore(
    subscribeToStoredOpen,
    getStoredOpen,
    getServerOpen
  )
  const isOpen = storageKey ? persistedOpen : unpersistedOpen

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (storageKey) {
        localStorage.setItem(storageKey, String(open))
        window.dispatchEvent(new StorageEvent("storage", { key: storageKey }))
      } else {
        setUnpersistedOpen(open)
      }
    },
    [storageKey]
  )

  const isSidebarVariant = variant === "sidebar"
  const hasSidebarHeaderActions = isSidebarVariant && headerActions != null
  const trigger = (
    <CollapsibleTrigger
      className={cn(
        "focus-visible:ring-focus-ring flex items-center rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        isSidebarVariant
          ? [
              "w-full min-w-0 justify-start gap-[0.5px] px-4 py-1.5",
              hasSidebarHeaderActions && "rounded-none",
              "text-[var(--text-tertiary)] transition-none",
            ]
          : [
              "w-full gap-1 px-2 py-1.5",
              "text-muted-foreground hover:text-foreground",
            ]
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {hasSidebarHeaderActions ? (
        <h2 className="__menu-label text-foreground truncate text-sm leading-5 font-semibold">
          {title}
        </h2>
      ) : isSidebarVariant ? (
        <span className="__menu-label text-foreground truncate text-sm font-semibold">
          {title}
        </span>
      ) : (
        <span className="truncate">{title}</span>
      )}
      <Icon
        icon={RiArrowRightSLine}
        {...COLLAPSIBLE_SECTION_CHEVRON_GEOMETRY[variant]}
        className={cn(
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
  )

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
      {hasSidebarHeaderActions ? (
        <div className="sidebar-group-header group/sidebar-expando-section-header flex min-w-0 items-center justify-between pe-1.5">
          {trigger}
          {headerActions}
        </div>
      ) : (
        trigger
      )}

      <CollapsibleContent
        className={cn(
          "overflow-hidden",
          "data-[open]:animate-collapsible-down",
          "data-[closed]:animate-collapsible-up"
        )}
      >
        {/* The header padding is the entire gap, so sidebar items stay flush. */}
        <div className={cn(!isSidebarVariant && "pt-1")}>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
