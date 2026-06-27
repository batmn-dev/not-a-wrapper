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
import { SourcesGallery } from "./sources-gallery"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
})

describe("SourcesGallery (R8 favicon perf)", () => {
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

  it("renders exactly N lazy/async favicon imgs for N sources", () => {
    const sources = Array.from({ length: 141 }, (_, i) => ({
      href: `https://example${i}.com/page`,
      title: `Title ${i}`,
    }))

    act(() => {
      root?.render(<SourcesGallery sources={sources} />)
    })

    const imgs = Array.from(container!.querySelectorAll("img"))
    expect(imgs).toHaveLength(141)
    for (const img of imgs) {
      expect(img.getAttribute("loading")).toBe("lazy")
      expect(img.getAttribute("decoding")).toBe("async")
    }
  })

  it("does not assign unsafe schemes to source row anchors", () => {
    act(() => {
      root?.render(
        <SourcesGallery
          sources={[{ href: "javascript:alert(1)", title: "Unsafe source" }]}
        />
      )
    })

    const link = container!.querySelector("a")
    expect(link).not.toBeNull()
    expect(link?.hasAttribute("href")).toBe(false)
    expect(link?.getAttribute("target")).toBeNull()
    expect(link?.getAttribute("rel")).toBeNull()
  })
})
