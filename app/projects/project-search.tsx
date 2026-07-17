"use client"

import { Icon } from "@/components/ui/icon"
import { RiSearchLine } from "@remixicon/react"

type ProjectSearchProps = {
  value: string
  onValueChange: (value: string) => void
}

/**
 * The directory's pill search field (captured: 36px, rounded-full, 14px/20px,
 * default border stepping up to the strong border on focus, keyboard-only focus
 * ring). Styled directly rather than through the `Input` primitive, which pins
 * a 16px font size the reference control doesn't use.
 */
export function ProjectSearch({ value, onValueChange }: ProjectSearchProps) {
  return (
    <div className="relative w-full">
      <Icon
        icon={RiSearchLine}
        slotSize={16}
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
      />
      <input
        id="projects-page-search"
        type="text"
        placeholder="Search projects"
        autoComplete="off"
        aria-label="Search projects"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="text-foreground border-input-border focus:border-border-strong bg-[var(--projects-control-surface)] placeholder:text-[var(--text-tertiary)] focus-visible:ring-focus-ring h-9 w-full rounded-full border py-2 ps-9 pe-3 text-sm/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none"
      />
    </div>
  )
}
