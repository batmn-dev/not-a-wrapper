/** @vitest-environment jsdom */

import Link from "next/link"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { SidebarCollection, SidebarCollectionItem } from "./sidebar-collection"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("SidebarCollection", () => {
  let container: HTMLDivElement | null = null
  let root: ReturnType<typeof createRoot> | null = null

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  it("renders navigation rows as a semantic list", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <SidebarCollection>
          <SidebarCollectionItem>
            <Link href="/c/one">One</Link>
          </SidebarCollectionItem>
          <SidebarCollectionItem>
            <Link href="/c/two">Two</Link>
          </SidebarCollectionItem>
        </SidebarCollection>
      )
    })

    const list = container.querySelector("ul")
    const items = list?.querySelectorAll(":scope > li")

    expect(list?.getAttribute("data-slot")).toBe("sidebar-collection")
    expect(items).toHaveLength(2)
    expect(items?.[0]?.querySelector("a")?.getAttribute("href")).toBe("/c/one")
  })
})
