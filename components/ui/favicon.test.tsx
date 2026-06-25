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
  return markup.match(/<img\b[^>]*\bsrc="([^"]*)"/)?.[1].replaceAll(
    "&amp;",
    "&"
  ) ?? null
}

describe("Favicon", () => {
  it("builds favicon URLs from web URLs and bare hostnames", () => {
    expect(renderFaviconSrc("https://www.example.com/path?private=true")).toBe(
      "https://www.google.com/s2/favicons?domain=www.example.com&sz=64"
    )
    expect(renderFaviconSrc("http://docs.example.com")).toBe(
      "https://www.google.com/s2/favicons?domain=docs.example.com&sz=64"
    )
    expect(renderFaviconSrc("example.com")).toBe(
      "https://www.google.com/s2/favicons?domain=example.com&sz=64"
    )
  })

  it("does not request favicons for non-web URL schemes", () => {
    expect(renderFaviconSrc("mailto:support@example.com")).toBeNull()
    expect(renderFaviconSrc("data:text/plain,hello")).toBeNull()
    expect(renderFaviconSrc("ftp://example.com/file")).toBeNull()
  })
})
