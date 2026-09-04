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

  it("shows title, description, and published date when all are present", () => {
    act(() => {
      root?.render(
        <SourcesGallery
          sources={[
            {
              sourceId: "full-source",
              href: "https://example.com/post",
              title: "A researched headline",
              siteName: "Example",
              description: "A result snippet preserved from tool output.",
              publishedDate: "2024-01-15",
            },
          ]}
        />
      )
    })

    const link = container!.querySelector("a")
    expect(link?.textContent).toContain("Example · Jan 15, 2024")
    expect(link?.querySelector(".font-semibold")?.textContent).toBe(
      "A researched headline"
    )
    expect(link?.querySelector(".leading-snug")?.textContent).toBe(
      "A result snippet preserved from tool output."
    )
  })

  it("formats ISO timestamps as UTC calendar dates", () => {
    act(() => {
      root?.render(
        <SourcesGallery
          sources={[
            {
              sourceId: "iso-source",
              href: "https://example.com/post",
              title: "A researched headline",
              siteName: "Example",
              publishedDate: "2024-01-15T00:00:00Z",
            },
          ]}
        />
      )
    })

    expect(container!.querySelector("a")?.textContent).toContain(
      "Example · Jan 15, 2024"
    )
  })

  it("shows a readable URL as the headline for a URL-only source", () => {
    act(() => {
      root?.render(
        <SourcesGallery
          sources={[
            {
              sourceId: "url-only",
              href: "https://www.example.com/path/",
            },
          ]}
        />
      )
    })

    const link = container!.querySelector("a")
    expect(link?.querySelector(".font-semibold")?.textContent).toBe(
      "example.com/path"
    )
    expect(link?.querySelector(".leading-snug")).toBeNull()
  })

  it("does not treat a domain title as a headline", () => {
    act(() => {
      root?.render(
        <SourcesGallery
          sources={[
            {
              sourceId: "domain-title",
              href: "https://apnews.com/article/example",
              title: "apnews.com",
            },
          ]}
        />
      )
    })

    expect(container!.querySelector(".font-semibold")?.textContent).toBe(
      "apnews.com/article/example"
    )
  })

  it("does not treat a www or mixed-case domain title as a headline", () => {
    act(() => {
      root?.render(
        <SourcesGallery
          sources={[
            {
              sourceId: "www-domain-title",
              href: "https://example.com/article",
              title: "www.Example.com",
            },
          ]}
        />
      )
    })

    expect(container!.querySelector(".font-semibold")?.textContent).toBe(
      "example.com/article"
    )
  })

  it("keeps query slashes in a URL-only headline", () => {
    act(() => {
      root?.render(
        <SourcesGallery
          sources={[
            {
              sourceId: "query-slash",
              href: "https://example.com/search?q=/",
            },
          ]}
        />
      )
    })

    expect(container!.querySelector(".font-semibold")?.textContent).toBe(
      "example.com/search?q=/"
    )
  })

  it("does not mount a description slot when description is absent", () => {
    act(() => {
      root?.render(
        <SourcesGallery
          sources={[
            {
              sourceId: "title-only",
              href: "https://example.com/page",
              title: "A real headline",
              siteName: "Example",
            },
          ]}
        />
      )
    })

    const link = container!.querySelector("a")
    expect(link?.querySelector(".font-semibold")?.textContent).toBe(
      "A real headline"
    )
    expect(link?.querySelector(".leading-snug")).toBeNull()
  })
})
