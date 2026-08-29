/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { SidebarPaginationState } from "./sidebar-pagination-skeleton"

describe("SidebarPaginationState", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  function renderState(isLoadingMore: boolean, seed = 0) {
    if (!container) {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
    }

    act(() => {
      root?.render(
        <>
          <div data-chat-row="existing-1">Existing one</div>
          <div data-chat-row="existing-2">Existing two</div>
          <SidebarPaginationState isLoadingMore={isLoadingMore} seed={seed} />
        </>
      )
    })
  }

  it("appends three aria-hidden rows without replacing existing history", () => {
    renderState(true)

    expect(container?.querySelectorAll("[data-chat-row]")).toHaveLength(2)
    const skeleton = container?.querySelector(
      "[data-sidebar-pagination-skeleton]"
    )
    expect(skeleton?.getAttribute("aria-hidden")).toBe("true")
    expect(
      skeleton?.querySelectorAll("[data-sidebar-pagination-skeleton-bar]")
    ).toHaveLength(3)
    expect(skeleton?.querySelector("svg")).toBeNull()
  })

  it("removes only the pagination state when loading settles or exhausts", () => {
    renderState(true)
    renderState(false)

    expect(
      container?.querySelector("[data-sidebar-pagination-skeleton]")
    ).toBeNull()
    expect(container?.querySelectorAll("[data-chat-row]")).toHaveLength(2)
  })
})
