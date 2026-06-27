/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"
import { SourceChipGroup } from "./source-chip-group"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
})

describe("SourceChipGroup", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

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

  it("only assigns hrefs to safe web source URLs", () => {
    act(() => {
      root?.render(
        <SourceChipGroup
          sources={[
            { href: "https://example.com/path", label: "safe" },
            { href: "javascript:alert(1)", label: "unsafe" },
          ]}
        />
      )
    })

    expect(container!.querySelectorAll("a")).toHaveLength(1)
    expect(container!.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/path"
    )
    expect(container!.querySelector('[href^="javascript:"]')).toBeNull()
    expect(container!.textContent).toContain("unsafe")
  })
})
