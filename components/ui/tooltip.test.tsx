import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Kbd } from "./kbd"
import { TooltipShortcut } from "./tooltip"

describe("TooltipShortcut", () => {
  it("announces the action and key names once", () => {
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
    expect(markup).toContain('aria-hidden="true"')
  })

  it("honors an exact label and names resolved host keys", () => {
    const exactMarkup = renderToStaticMarkup(
      <TooltipShortcut label="Search" aria-label="Search, Command, K">
        <Kbd label="Command">⌘</Kbd>
        <Kbd>K</Kbd>
      </TooltipShortcut>
    )
    const resolvedMarkup = renderToStaticMarkup(
      <TooltipShortcut label="Search chats">
        <kbd aria-label="Command">
          <span>⌘</span>
        </kbd>
        <kbd>
          <span>K</span>
        </kbd>
      </TooltipShortcut>
    )

    expect(exactMarkup).toContain(
      '<span class="sr-only">Search, Command, K</span>'
    )
    expect(resolvedMarkup).toContain(
      '<span class="sr-only">Search chats, Command, K</span>'
    )
  })
})
