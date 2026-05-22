import { RiPhoneLine, RiSearchLine } from "@remixicon/react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Icon } from "./icon"

describe("Icon", () => {
  it("keeps the layout slot stable when glyphSize scales the SVG", () => {
    const markup = renderToStaticMarkup(
      <Icon icon={RiPhoneLine} slotSize={20} glyphSize={24} />
    )

    expect(markup).toContain("--icon-slot-size:20px")
    expect(markup).toContain("--icon-glyph-size:24px")
  })

  it("uses inset-based glyph sizing by default", () => {
    const markup = renderToStaticMarkup(
      <Icon icon={RiSearchLine} slotSize={20} />
    )

    expect(markup).toContain("--icon-slot-size:20px")
    expect(markup).toContain(
      "--icon-glyph-size:calc(var(--icon-slot-size) - var(--icon-glyph-inset))"
    )
  })

  it("supports custom glyph insets", () => {
    const markup = renderToStaticMarkup(
      <Icon icon={RiSearchLine} slotSize={20} glyphInset={2} />
    )

    expect(markup).toContain("--icon-slot-size:20px")
    expect(markup).toContain("--icon-glyph-inset:2px")
    expect(markup).toContain(
      "--icon-glyph-size:calc(var(--icon-slot-size) - var(--icon-glyph-inset))"
    )
  })
})
