import fs from "node:fs"

import { describe, expect, it } from "vitest"

const css = fs.readFileSync(new URL("../../globals.css", import.meta.url), {
  encoding: "utf8",
})

describe("composer geometry tokens", () => {
  it("publishes ChatGPT's fallback-aware geometry on the shared parent", () => {
    expect(css).toContain(
      "--composer-footer_height: var(--composer-bar_footer-current-height, 32px)"
    )
    expect(css).toContain(
      "--composer-bar_height: var(--composer-bar_current-height, 52px)"
    )
    expect(css).toContain(
      "--composer-bar_width: var(--composer-bar_current-width, 768px)"
    )
  })
})
