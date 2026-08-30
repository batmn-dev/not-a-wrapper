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
  vi,
} from "vitest"
import { SourcesGallery } from "./sources-gallery"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("SourcesGallery favicon sharing", () => {
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

  it("renders one shared favicon for each source", () => {
    const sources = Array.from({ length: 3 }, (_, i) => ({
      sourceId: `source-${i}`,
      href: `https://example${i}.com/page`,
      title: `Title ${i}`,
    }))

    act(() => {
      root?.render(<SourcesGallery sources={sources} />)
    })

    expect(container!.querySelectorAll('[data-slot="avatar"]')).toHaveLength(3)
  })

  it("does not assign unsafe schemes to source row anchors", () => {
    act(() => {
      root?.render(
        <SourcesGallery
          sources={[
            {
              sourceId: "unsafe-source",
              href: "javascript:alert(1)",
              title: "Unsafe source",
            },
          ]}
        />
      )
    })

    const link = container!.querySelector("a")
    expect(link).not.toBeNull()
    expect(link?.hasAttribute("href")).toBe(false)
    expect(link?.getAttribute("target")).toBeNull()
    expect(link?.getAttribute("rel")).toBeNull()
  })

  it("keys duplicate source URLs by source identity", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      act(() => {
        root?.render(
          <SourcesGallery
            sources={[
              {
                sourceId: "source-a",
                href: "https://example.com/reused",
                title: "First citation title",
              },
              {
                sourceId: "source-b",
                href: "https://example.com/reused",
                title: "Second citation title",
              },
            ]}
          />
        )
      })

      expect(container?.textContent).toContain("First citation title")
      expect(container?.textContent).toContain("Second citation title")
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it("renders normalized source snippets", () => {
    act(() => {
      root?.render(
        <SourcesGallery
          sources={[
            {
              sourceId: "source-with-description",
              href: "https://example.com/activity",
              title: "Activity reference",
              siteName: "Example",
              description: "A result snippet preserved from tool output.",
            },
          ]}
        />
      )
    })

    const link = container!.querySelector("a")
    expect(link?.textContent).toContain("A result snippet preserved")
  })
})
