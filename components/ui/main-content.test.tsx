/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { MainContent } from "./main-content"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("MainContent", () => {
  let container: HTMLDivElement | null = null
  let root: ReturnType<typeof createRoot> | null = null

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  it("is a programmatically focusable skip-link destination", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => root?.render(<MainContent id="main" />))

    const main = container.querySelector("main")
    act(() => main?.focus())

    expect(main?.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(main)
  })
})
