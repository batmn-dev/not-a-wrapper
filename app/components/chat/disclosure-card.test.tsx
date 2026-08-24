/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { DisclosureCard } from "./disclosure-card"

describe("DisclosureCard", () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("uses native disclosure semantics and preserves body identity", () => {
    act(() => {
      root.render(
        <DisclosureCard header="Sources">
          <div data-testid="body">One source</div>
        </DisclosureCard>
      )
    })

    const details = container.querySelector("details")
    const summary = container.querySelector("summary")
    const body = container.querySelector('[data-testid="body"]')

    expect(details?.open).toBe(false)
    expect(summary?.textContent).toContain("Sources")
    expect(container.querySelector("button")).toBeNull()

    act(() => summary?.click())
    expect(details?.open).toBe(true)
    expect(container.querySelector('[data-testid="body"]')).toBe(body)

    act(() => {
      root.render(
        <DisclosureCard header="Sources">
          <div data-testid="body">One source</div>
        </DisclosureCard>
      )
    })
    expect(details?.open).toBe(true)
    expect(container.querySelector('[data-testid="body"]')).toBe(body)

    act(() => summary?.click())
    expect(details?.open).toBe(false)
    expect(container.querySelector('[data-testid="body"]')).toBe(body)
  })

  it("honors the initial open state", () => {
    act(() => {
      root.render(
        <DisclosureCard defaultOpen header="Tool result">
          Result
        </DisclosureCard>
      )
    })

    expect(container.querySelector("details")?.open).toBe(true)
  })
})
