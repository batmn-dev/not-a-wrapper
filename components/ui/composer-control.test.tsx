/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { ComposerControl } from "./composer-control"

describe("ComposerControl", () => {
  it("owns the complete secondary composer interaction contract", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(<ComposerControl aria-expanded>Model</ComposerControl>)
    })

    const button = container.querySelector("button") as HTMLButtonElement
    expect(button.hasAttribute("data-composer-control")).toBe(true)
    expect(button.className).toContain("composer-btn")
    expect(button.className).toContain("text-foreground")
    expect(button.className).toContain("press-motion")
    expect(button.className).not.toContain("hover:bg-interactive-hover")
    expect(button.getAttribute("aria-expanded")).toBe("true")

    act(() => root.unmount())
    container.remove()
  })
})
