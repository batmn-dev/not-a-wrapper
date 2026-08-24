import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Kbd } from "./kbd"
import { TooltipShortcut } from "./tooltip"

describe("TooltipShortcut", () => {
  it("keeps the measured surface, timing, and accessibility contract", () => {
    const source = readFileSync(
      new URL("./tooltip.tsx", import.meta.url),
      "utf8"
    )

    expect(source).toContain("delay={0}")
    expect(source).toMatch(/\.\.\.props\}\s+delay=\{0\}/)
    expect(source).toContain('Omit<TooltipPrimitive.Provider.Props, "delay">')
    expect(source).not.toContain("delay?: number")
    expect(source).toContain("sideOffset = 6")
    expect(source).toContain("const contentId = `base-ui-${React.useId()}`")
    expect(source).toContain("<TooltipPrimitive.Portal keepMounted>")
    expect(source).toContain("role={role}")
    expect(source).toContain("aria-describedby={ariaDescribedBy ?? contentId}")
    expect(source).toContain(
      "max-w-[min(var(--container-xs),calc(100dvw-2*var(--spacing)))]"
    )
    expect(source).toContain("bg-white/25")
    expect(source).toContain("text-[var(--text-secondary)]")
  })

  it("matches the shared shortcut capsule and announces one action phrase", () => {
    const markup = renderToStaticMarkup(
      <TooltipShortcut label="Thinking effort">
        <Kbd label="Control">⌃</Kbd>
        <Kbd label="Shift">⇧</Kbd>
        <Kbd>M</Kbd>
      </TooltipShortcut>
    )

    expect(markup).toContain(
      '<span class="sr-only">Thinking effort, Control, Shift, M</span>'
    )
    expect(markup).toContain(
      '<span aria-hidden="true" class="inline-flex items-center gap-1.5 whitespace-nowrap"><span>Thinking effort</span>'
    )
    expect(markup).not.toContain(
      'data-slot="tooltip-shortcut-action" aria-label='
    )
    expect(markup).toContain("gap-1.5")
    expect(markup).toContain("h-[18px]")
    expect(markup).toContain("rounded-full")
    expect(markup).toContain("bg-white/25")
    expect(markup).toContain("px-1.5")
    expect(markup).toContain("text-[var(--text-secondary)]")
    expect(markup).toContain("-me-1.5")
    expect(markup).toContain('aria-label="Control"')
    expect(markup).toContain('aria-label="Shift"')
    expect(markup).toContain("empty:hidden")
  })

  it("lets callers provide an exact accessible action label", () => {
    const markup = renderToStaticMarkup(
      <TooltipShortcut label="Search" aria-label="Search, Command, K">
        <Kbd label="Command">⌘</Kbd>
        <Kbd>K</Kbd>
      </TooltipShortcut>
    )

    expect(markup).toContain(
      '<span class="sr-only">Search, Command, K</span>'
    )
  })

  it("preserves key names after Kbd children resolve to host elements", () => {
    const markup = renderToStaticMarkup(
      <TooltipShortcut label="Search chats">
        <kbd aria-label="Command">
          <span>⌘</span>
        </kbd>
        <kbd>
          <span>K</span>
        </kbd>
      </TooltipShortcut>
    )

    expect(markup).toContain(
      '<span class="sr-only">Search chats, Command, K</span>'
    )
  })
})
