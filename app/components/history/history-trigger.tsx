"use client"

import { headerActionButtonClassName } from "@/app/components/layout/header-action-button"
import { Icon } from "@/components/ui/icon"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { cn } from "@/lib/utils"
import { RiSearchLine } from "@remixicon/react"
import {
  cloneElement,
  isValidElement,
  type MouseEvent,
  type ReactElement,
} from "react"
import { useHistorySearch } from "./history-search-provider"

type HistoryTriggerElementProps = {
  onClick?: (event: MouseEvent<HTMLElement>) => void
  "aria-label"?: string
  tabIndex?: number
}

type HistoryTriggerProps = {
  hasSidebar: boolean
  trigger?: ReactElement<HistoryTriggerElementProps>
  classNameTrigger?: string
  icon?: React.ReactNode
  label?: React.ReactNode | string
  trailing?: React.ReactNode
  hasPopover?: boolean
}

export function HistoryTrigger({
  hasSidebar,
  trigger,
  classNameTrigger,
  icon,
  label,
  trailing,
}: HistoryTriggerProps) {
  const isMobile = useBreakpoint(768)
  const { openHistory } = useHistorySearch()
  const hasCustomTriggerClass = !!classNameTrigger
  const defaultTrigger =
    trigger && isValidElement(trigger) ? (
      cloneElement(trigger, {
        onClick: (event: MouseEvent<HTMLElement>) => {
          if (typeof trigger.props.onClick === "function") {
            trigger.props.onClick(event)
          }
          openHistory()
        },
        "aria-label": trigger.props["aria-label"] ?? "Search",
        tabIndex: isMobile ? -1 : trigger.props.tabIndex,
      })
    ) : (
      <button
        className={cn(
          !hasCustomTriggerClass &&
            `${headerActionButtonClassName} pointer-events-auto p-1.5`,
          hasSidebar ? "hidden" : "block",
          classNameTrigger
        )}
        type="button"
        onClick={openHistory}
        aria-label="Search"
        tabIndex={isMobile ? -1 : 0}
      >
        {icon || <Icon icon={RiSearchLine} slotSize={24} />}
        {label}
        {trailing}
      </button>
    )
  return defaultTrigger
}
