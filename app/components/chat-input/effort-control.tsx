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
import { RiCheckLine } from "@remixicon/react"
import { useState } from "react"

type EffortControlProps = {
  /** The selected model's level menu (logical union across routes). */
  levels: readonly ModelReasoningEffort[]
  /** Effective per-turn effort; undefined = Default. */
  value: ModelReasoningEffort | undefined
  /** The model's default level: reads as selected while the user has no
   * override, and picking it clears the override. */
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
 * the model's real level list, never a fixed vocabulary — no separate
 * "Default" row: the model's own default level reads as selected until the
 * user overrides, and re-picking it clears the override (state stays
 * `undefined`, so the wire still sends nothing and the provider decides).
 * Selection applies to the next message (and retries) and is remembered per
 * model.
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

  // What the menu shows as checked (and the trigger as label): the explicit
  // override, else the model's default level when the union menu carries it.
  const effectiveLevel =
    value ??
    (defaultLevel !== undefined && levels.includes(defaultLevel)
      ? defaultLevel
      : undefined)
  const effectiveLabel =
    effectiveLevel !== undefined
      ? REASONING_EFFORT_LABELS[effectiveLevel]
      : undefined

  const select = (level: ModelReasoningEffort) => {
    // Picking the model's own default is "no override": keep the canonical
    // absent state so Default semantics (send nothing) stay representable.
    onChange(level === defaultLevel ? undefined : level)
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
                  effectiveLabel
                    ? `Thinking effort: ${effectiveLabel}`
                    : "Thinking effort"
                }
                aria-expanded={isOpen}
                // Geometry and type mirror the composer model trigger. This
                // pill always renders joined flush to the model trigger as
                // one segmented control: tight facing padding and a squared
                // inner corner on the shared edge (the model trigger mirrors
                // both when this control is present). No hover bridge — the
                // seam has no gap to cover, and an extended hit area would
                // steal the model trigger's trailing clicks. Always the quiet
                // tertiary grey — an override changes the label, not the
                // color.
                // Both radii are FINITE (18px trailing = half the height, so
                // it reads as the pill's full round): pairing a finite corner
                // with rounded-full's near-infinite radius triggers the CSS
                // corner-overlap reduction, which scales all radii by one
                // shared factor and paints the finite corner square.
                className="text-[var(--text-tertiary)] h-9 shrink-0 overflow-visible rounded-s-md rounded-e-2xl ps-0.5 pe-3 py-0 text-base leading-[26px] font-normal"
              />
            }
          >
            {effectiveLabel ? (
              <span className="max-w-24 truncate">{effectiveLabel}</span>
            ) : null}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" hideArrow>
          Thinking effort
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" className="min-w-44">
        {levels.map((level) => (
          <EffortRow
            key={level}
            label={REASONING_EFFORT_LABELS[level]}
            selected={level === effectiveLevel}
            onSelect={() => select(level)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { EffortControl }
