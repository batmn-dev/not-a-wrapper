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

describe("SourcesGallery favicon attrs (R8)", () => {
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

  it("sets loading=lazy + decoding=async on every gallery img and renders exactly N imgs", () => {
    const sources = Array.from({ length: 141 }, (_, i) => ({
      href: `https://example${i}.com/page`,
      title: `Title ${i}`,
    }))

    act(() => {
      root?.render(<SourcesGallery sources={sources} />)
    })

    const imgs = Array.from(container!.querySelectorAll("img"))
    expect(imgs.length).toBe(141)
    for (const img of imgs) {
      expect(img.getAttribute("loading")).toBe("lazy")
      expect(img.getAttribute("decoding")).toBe("async")
    }
  })

  it("renders the Sources heading with the count", () => {
    const sources = [
      { href: "https://example.com/a", title: "A" },
      { href: "https://example.com/b", title: "B" },
    ]

    act(() => {
      root?.render(<SourcesGallery sources={sources} />)
    })

    expect(container!.textContent).toContain("Sources")
    expect(container!.textContent).toContain("· 2")
  })
})
