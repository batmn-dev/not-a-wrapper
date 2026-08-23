import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const globalCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")

describe("shared interaction surface CSS", () => {
  it("routes keyboard focus through the root modality attribute", () => {
    expect(globalCss).toContain("@custom-variant keyboard-focused")
    expect(globalCss).toContain(
      '&:is(html[data-focus-mode="keyboard"] :focus-visible)'
    )
  })

  it("routes opted-in scroll surfaces through theme and hover tokens", () => {
    expect(globalCss).toContain("--scrollbar-color: #0000001a;")
    expect(globalCss).toContain("--scrollbar-color: #ffffff1a;")
    expect(globalCss).toContain(
      "scrollbar-color: var(--scrollbar-color) transparent;"
    )
    expect(globalCss).toContain(
      "scrollbar-color: var(--scrollbar-color-hover) transparent;"
    )
  })
})
