/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { GenerationStatsLine } from "./generation-stats"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("GenerationStatsLine", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    const rootToUnmount = root
    if (rootToUnmount) {
      act(() => {
        rootToUnmount.unmount()
      })
    }
    container?.remove()
    root = null
    container = null
  })

  it("renders the tooltip trigger as a keyboard-focusable button", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(<GenerationStatsLine stats={{ outputTokens: 12 }} />)
    })

    const trigger = container.querySelector('[data-testid="generation-stats"]')
    expect(trigger).toBeInstanceOf(HTMLButtonElement)
    expect(trigger?.getAttribute("type")).toBe("button")
    expect(trigger?.textContent).toBe("12 tokens")

    act(() => {
      ;(trigger as HTMLButtonElement).focus()
    })
    expect(document.activeElement).toBe(trigger)
    expect(trigger?.className).toContain("keyboard-focused:outline-[1.5px]")
  })
})
