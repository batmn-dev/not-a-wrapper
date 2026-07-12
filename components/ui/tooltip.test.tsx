import { Kbd } from "@/components/ui/kbd"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TooltipShortcut } from "./tooltip"

describe("TooltipShortcut", () => {
  it("composes ChatGPT-style unboxed shortcut keys from shared primitives", () => {
    const markup = renderToStaticMarkup(
      <TooltipShortcut label="Select model">
        <Kbd label="Control">⌃</Kbd>
        <Kbd label="Shift">⇧</Kbd>
        <Kbd>M</Kbd>
      </TooltipShortcut>
    )

    expect(markup).toContain('data-slot="tooltip-shortcut"')
    expect(markup).toContain('data-slot="tooltip-shortcut-action"')
    expect(markup).toContain('data-slot="tooltip-shortcut-keys"')
    // No detail slot without a detail prop: the root's gap-2 would turn an
    // empty span into 8px of phantom trailing space inside the tooltip.
    expect(markup).not.toContain('data-slot="tooltip-shortcut-detail"')
    expect(markup).toContain("text-[var(--text-tertiary)]")
    expect(markup).toContain("[text-box:trim-both_text]")
    expect(markup).toContain("[&amp;_kbd]:text-xs")
    expect(markup.match(/data-slot="kbd"/g)).toHaveLength(3)
    expect(markup).toContain('aria-label="Control"')
    expect(markup).toContain('aria-label="Shift"')
  })

  it("renders the detail slot when a detail is provided", () => {
    const markup = renderToStaticMarkup(
      <TooltipShortcut label="Try again" detail="Using Sonnet 5">
        <Kbd>R</Kbd>
      </TooltipShortcut>
    )

    expect(markup).toContain('data-slot="tooltip-shortcut-detail"')
    expect(markup).toContain("Using Sonnet 5")
  })
})
