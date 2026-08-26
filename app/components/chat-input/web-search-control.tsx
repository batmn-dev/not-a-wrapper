"use client"

import { ComposerControl } from "@/components/ui/composer-control"
import { Icon } from "@/components/ui/icon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { SearchMode } from "@/lib/models/types"
import { cn } from "@/lib/utils"
import { RiCloseLine, RiGlobalOffLine } from "@remixicon/react"
import { ComposerGlobeIcon } from "./composer-menu-icons"

type WebSearchControlProps = {
  enabled: boolean
  mode: SearchMode
  onEnabledChange: (enabled: boolean) => void
}

function getWebSearchControlState({
  enabled,
  mode,
}: Pick<WebSearchControlProps, "enabled" | "mode">) {
  if (mode === "always-on") {
    return {
      active: true,
      toggleable: false,
      tooltip: "Search is always on for this model",
    }
  }

  if (mode === "unsupported") {
    return {
      active: false,
      toggleable: false,
      tooltip: "This model doesn’t support web search",
    }
  }

  return {
    active: enabled,
    toggleable: true,
    tooltip: enabled ? "Click to disable search" : "Click to enable search",
  }
}

/** Expanded Composer search affordance. Search state never enters the draft. */
function WebSearchControl({
  enabled,
  mode,
  onEnabledChange,
}: WebSearchControlProps) {
  const { active, toggleable, tooltip } = getWebSearchControlState({
    enabled,
    mode,
  })
  const ariaLabel = toggleable
    ? `Search, ${tooltip.toLocaleLowerCase()}`
    : tooltip

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
            data-web-search-control=""
            data-search-toggleable={toggleable ? "" : undefined}
            visuallyDisabled={!toggleable}
            className={cn(
              "web-search-control hidden h-9 gap-1.5 py-0 ps-2 pe-3 text-sm/5 font-normal group-data-expanded/composer:inline-flex max-sm:inline-flex @max-[520px]/main:inline-flex data-[visually-disabled]:opacity-100",
              active
                ? "text-[var(--composer-capability-accent)]"
                : "text-[var(--text-tertiary)]"
            )}
            onClick={() => onEnabledChange(!active)}
          >
            <span className="relative size-5 shrink-0" aria-hidden="true">
              <Icon
                data-search-enabled-icon=""
                icon={active ? ComposerGlobeIcon : RiGlobalOffLine}
                slotSize={20}
                glyphInset={0}
              />
              {active && toggleable ? (
                <Icon
                  data-search-disable-icon=""
                  className="absolute inset-0 hidden"
                  icon={RiCloseLine}
                  slotSize={20}
                  glyphSize={16}
                />
              ) : null}
            </span>
            <span className="max-w-40 truncate">Search</span>
          </ComposerControl>
        }
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export { WebSearchControl }
