"use client"

import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiCloseLine, RiSearchLine } from "@remixicon/react"
import { useRef } from "react"

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
  const inputRef = useRef<HTMLInputElement | null>(null)

  const clearSearch = () => {
    onValueChange("")
    inputRef.current?.focus()
  }

  return (
    <div className="relative w-full">
      <Icon
        icon={RiSearchLine}
        slotSize={16}
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
      />
      <input
        ref={inputRef}
        id="projects-page-search"
        type="text"
        placeholder="Search projects"
        autoComplete="off"
        aria-label="Search projects"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          "text-foreground border-input-border focus:border-border-strong keyboard-focused:outline-foreground keyboard-focused:outline-[1.5px] keyboard-focused:outline-offset-[2.5px] keyboard-focused:[outline-style:solid] h-9 w-full rounded-full border bg-[var(--projects-control-surface)] py-2 ps-9 pe-3 text-sm/5 outline-none placeholder:text-[var(--text-tertiary)] motion-reduce:transition-none",
          value && "pe-8"
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clearSearch}
          className="focus-visible:outline-foreground absolute end-0.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-linear-to-r from-transparent via-[var(--projects-control-surface)] via-50% to-transparent text-[var(--text-tertiary)] outline-none hover:bg-[var(--projects-control-fill)] focus-visible:bg-[var(--projects-control-fill)] focus-visible:outline-[1.5px] focus-visible:outline-offset-[2.5px] focus-visible:[outline-style:solid] motion-reduce:transition-none"
        >
          <Icon icon={RiCloseLine} slotSize={18} glyphInset={0} />
        </button>
      ) : null}
    </div>
  )
}
