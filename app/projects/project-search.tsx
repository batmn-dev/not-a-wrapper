"use client"

import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiCloseLine, RiSearchLine } from "@remixicon/react"
import { useCallback, useRef, useState } from "react"

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
  const lastModalityRef = useRef<"keyboard" | "pointer">("pointer")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [hasKeyboardFocus, setHasKeyboardFocus] = useState(false)

  // Text inputs match :focus-visible after a mouse click in Chromium, so that
  // pseudo-class cannot express ChatGPT's keyboard-only outline. Track the
  // modality that led into focus, but do not promote an already pointer-focused
  // input when the user starts typing.
  const attachModalityListeners = useCallback(
    (node: HTMLInputElement | null) => {
      if (!node) return
      inputRef.current = node

      const markKeyboard = () => {
        lastModalityRef.current = "keyboard"
      }
      const markPointer = () => {
        lastModalityRef.current = "pointer"
      }

      document.addEventListener("keydown", markKeyboard, true)
      document.addEventListener("pointerdown", markPointer, true)
      return () => {
        if (inputRef.current === node) inputRef.current = null
        document.removeEventListener("keydown", markKeyboard, true)
        document.removeEventListener("pointerdown", markPointer, true)
      }
    },
    []
  )

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
        ref={attachModalityListeners}
        id="projects-page-search"
        type="text"
        placeholder="Search projects"
        autoComplete="off"
        aria-label="Search projects"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onFocus={() =>
          setHasKeyboardFocus(lastModalityRef.current === "keyboard")
        }
        onBlur={() => setHasKeyboardFocus(false)}
        data-keyboard-focused={hasKeyboardFocus || undefined}
        style={
          hasKeyboardFocus
            ? {
                outline: "1.5px solid var(--foreground)",
                outlineOffset: "2.5px",
              }
            : undefined
        }
        className={cn(
          "text-foreground border-input-border focus:border-border-strong bg-[var(--projects-control-surface)] placeholder:text-[var(--text-tertiary)] h-9 w-full rounded-full border py-2 ps-9 pe-3 text-sm/5 outline-none motion-reduce:transition-none",
          value && "pe-8"
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clearSearch}
          className="hover:bg-[var(--projects-control-fill)] focus-visible:bg-[var(--projects-control-fill)] absolute end-0.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-linear-to-r from-transparent via-[var(--projects-control-surface)] via-50% to-transparent text-[var(--text-tertiary)] outline-none focus-visible:outline-[1.5px] focus-visible:outline-offset-[2.5px] focus-visible:outline-foreground focus-visible:[outline-style:solid] motion-reduce:transition-none"
        >
          <Icon icon={RiCloseLine} slotSize={18} glyphInset={0} />
        </button>
      ) : null}
    </div>
  )
}
