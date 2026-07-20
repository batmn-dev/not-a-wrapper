import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { Favicon } from "./favicon"

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({
    children,
    ...props
  }: React.ComponentProps<"span"> & { children?: React.ReactNode }) =>
    React.createElement("span", props, children),
  AvatarImage: (props: React.ComponentProps<"img">) =>
    React.createElement("img", props),
  AvatarFallback: (props: React.ComponentProps<"span">) =>
    React.createElement("span", props),
}))

function renderFaviconSrc(url: string): string | null {
  const markup = renderToStaticMarkup(<Favicon url={url} alt="site icon" />)
  return (
    markup.match(/<img\b[^>]*\bsrc="([^"]*)"/)?.[1].replaceAll("&amp;", "&") ??
    null
  )
}

describe("Favicon", () => {
  it("builds same-origin favicon URLs from web URLs and bare hostnames", () => {
    expect(renderFaviconSrc("https://www.example.com/path?private=true")).toBe(
      "/api/favicon?domain=www.example.com"
    )
    expect(renderFaviconSrc("http://docs.example.com")).toBe(
      "/api/favicon?domain=docs.example.com"
    )
    expect(renderFaviconSrc("example.com")).toBe(
      "/api/favicon?domain=example.com"
    )
  })

  it("does not request favicons for non-web URL schemes", () => {
    expect(renderFaviconSrc("mailto:support@example.com")).toBeNull()
    expect(renderFaviconSrc("data:text/plain,hello")).toBeNull()
    expect(renderFaviconSrc("ftp://example.com/file")).toBeNull()
  })

  it("owns the global-line fallback for every caller", () => {
    const markup = renderToStaticMarkup(
      <Favicon url="https://example.com/path" />
    )

    expect(markup).toContain('src="/api/favicon?domain=example.com"')
    expect(markup).toContain('data-slot="favicon-placeholder"')
  })

  it("forwards image loading hints", () => {
    const markup = renderToStaticMarkup(
      <Favicon url="https://example.com/path" loading="lazy" decoding="async" />
    )

    expect(markup).toContain('loading="lazy"')
    expect(markup).toContain('decoding="async"')
  })
})
