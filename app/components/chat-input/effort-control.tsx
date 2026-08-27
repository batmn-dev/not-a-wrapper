"use client"

import { ComposerControl } from "@/components/ui/composer-control"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ModelReasoningEffort } from "@/lib/models/types"
import {
  isReasoningEffortControlEnabled,
  REASONING_EFFORT_LABELS,
} from "@/lib/reasoning-effort"
import { cn } from "@/lib/utils"
import { RiBrainLine, RiCheckLine } from "@remixicon/react"
import { useState } from "react"

type EffortControlProps = {
  /** The selected model's level menu (logical union across routes). */
  levels: readonly ModelReasoningEffort[]
  /** Effective per-turn effort; undefined = Default. */
  value: ModelReasoningEffort | undefined
  /** The model's own default level, shown on the Default row when known. */
  defaultLevel?: ModelReasoningEffort
  onChange: (effort: ModelReasoningEffort | undefined) => void
  onSelectionCommitted?: () => void
}

function EffortRow({
  label,
  selected,
  onSelect,
}: {
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem
      onClick={onSelect}
      aria-checked={selected}
      role="menuitemradio"
    >
      <span className="flex-1 truncate">{label}</span>
      <Icon
        inert={true}
        icon={RiCheckLine}
        slotSize={20}
        glyphSize={16}
        className={cn(selected ? "opacity-100" : "opacity-0")}
      />
    </DropdownMenuItem>
  )
}

/**
 * Per-turn thinking-effort selector (ADR-0026), right of the model button.
 * Renders only for models whose catalog declares effort levels; the menu is
 * the model's real level list, never a fixed vocabulary. Selection applies
 * to the next message (and retries) and is remembered per model.
 */
function EffortControl({
  levels,
  value,
  defaultLevel,
  onChange,
  onSelectionCommitted,
}: EffortControlProps) {
  const [isOpen, setIsOpen] = useState(false)

  if (!isReasoningEffortControlEnabled() || levels.length === 0) return null

  const selectedLabel =
    value !== undefined ? REASONING_EFFORT_LABELS[value] : undefined
  const defaultRowLabel =
    defaultLevel !== undefined
      ? `Default · ${REASONING_EFFORT_LABELS[defaultLevel]}`
      : "Default"

  const select = (effort: ModelReasoningEffort | undefined) => {
    onChange(effort)
    setIsOpen(false)
    onSelectionCommitted?.()
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal>
      <Tooltip disabled={isOpen}>
        <TooltipTrigger render={<span className="inline-flex min-w-0" />}>
          <DropdownMenuTrigger
            render={
              <ComposerControl
                type="button"
                data-effort-control=""
                aria-label={
                  selectedLabel
                    ? `Thinking effort: ${selectedLabel}`
                    : "Thinking effort"
                }
                aria-expanded={isOpen}
                className={cn(
                  "h-9 shrink-0 gap-1.5 py-0 ps-2 text-sm/5 font-normal",
                  selectedLabel ? "pe-3" : "pe-2",
                  value !== undefined
                    ? "text-[var(--composer-capability-accent)]"
                    : "text-[var(--text-tertiary)]"
                )}
              />
            }
          >
            <Icon inert={true} icon={RiBrainLine} slotSize={20} />
            {selectedLabel ? (
              <span className="max-w-24 truncate max-[520px]:sr-only">
                {selectedLabel}
              </span>
            ) : null}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" hideArrow>
          Thinking effort
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" className="min-w-44">
        <EffortRow
          label={defaultRowLabel}
          selected={value === undefined}
          onSelect={() => select(undefined)}
        />
        {levels.map((level) => (
          <EffortRow
            key={level}
            label={REASONING_EFFORT_LABELS[level]}
            selected={value === level}
            onSelect={() => select(level)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { EffortControl }
