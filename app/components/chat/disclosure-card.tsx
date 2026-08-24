"use client"

import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiArrowDownSLine } from "@remixicon/react"
import type { ReactNode } from "react"

type DisclosureCardProps = {
  /** Header content, left of the chevron (icon, title, badges, favicons…). */
  header: ReactNode
  /** Body, revealed on expand. The card owns the px-3 pt-3 pb-3 padding. */
  children: ReactNode
  defaultOpen?: boolean
  /** Extra classes on the bordered box. */
  className?: string
}

/**
 * The single collapsible card the chat surface uses for tool steps and sources:
 * a bordered box + native summary + rotating chevron + CSS-native details
 * reveal. The body remains mounted so disclosure does not change its DOM
 * identity when it opens or closes.
 */
export function DisclosureCard({
  header,
  children,
  defaultOpen = false,
  className,
}: DisclosureCardProps) {
  return (
    <details
      open={defaultOpen || undefined}
      data-slot="disclosure-card"
      className={cn(
        "chat-disclosure border-border group/disclosure overflow-hidden rounded-md border",
        className
      )}
    >
      <summary
        data-slot="disclosure-card-trigger"
        className="hover:bg-interactive-hover active:bg-interactive-pressed flex w-full cursor-pointer list-none flex-row items-center rounded-t-md px-3 py-2 transition-colors [&::-webkit-details-marker]:hidden"
      >
        <div className="flex flex-1 flex-row items-center gap-2 text-left text-sm">
          {header}
        </div>
        <Icon
          icon={RiArrowDownSLine}
          slotSize={16}
          className="h-4 w-4 transition-transform group-open/disclosure:rotate-180"
        />
      </summary>
      <div className="min-h-0 overflow-hidden">
        <div className="px-3 pt-3 pb-3">{children}</div>
      </div>
    </details>
  )
}
