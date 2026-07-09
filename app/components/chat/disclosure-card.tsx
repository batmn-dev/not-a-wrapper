"use client"

import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiArrowDownSLine } from "@remixicon/react"
import { AnimatePresence, motion } from "motion/react"
import { useState, type ReactNode } from "react"

const TRANSITION = {
  type: "spring",
  duration: 0.2,
  bounce: 0,
} as const

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
 * a bordered box + hover header + rotating chevron + framer height reveal.
 * Replaces three hand-rolled copies (each re-declaring the same spring
 * TRANSITION) with one header slot + body.
 */
export function DisclosureCard({
  header,
  children,
  defaultOpen = false,
  className,
}: DisclosureCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultOpen)

  return (
    <div
      className={cn(
        "border-border flex flex-col gap-0 overflow-hidden rounded-md border",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        aria-expanded={isExpanded}
        className="hover:bg-accent flex w-full flex-row items-center rounded-t-md px-3 py-2 transition-colors"
      >
        <div className="flex flex-1 flex-row items-center gap-2 text-left text-sm">
          {header}
        </div>
        <Icon
          icon={RiArrowDownSLine}
          slotSize={16}
          className={cn(
            "h-4 w-4 transition-transform",
            isExpanded ? "rotate-180 transform" : ""
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={TRANSITION}
            className="overflow-hidden"
          >
            <div className="px-3 pt-3 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
