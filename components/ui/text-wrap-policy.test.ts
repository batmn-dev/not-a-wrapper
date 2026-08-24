import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")

describe("UI copy wrapping policy", () => {
  it("balances headings and prettifies ordinary UI paragraphs", () => {
    expect(css).toMatch(
      /:is\(h1, h2, h3, h4, h5, h6, \[role="heading"\]\)[\s\S]*?text-wrap: balance;/
    )
    expect(css).toMatch(/:is\(p\):where\([\s\S]*?text-wrap: pretty;/)
  })

  it("excludes authored messages, editors, and explicit truncation", () => {
    for (const selector of [
      ".markdown *",
      "[data-message-author-role] *",
      "[contenteditable] *",
      '[role="textbox"] *',
      '[class*="line-clamp-"]',
      ".truncate",
      ".whitespace-nowrap",
    ]) {
      expect(css).toContain(selector)
    }
    expect(css).toMatch(
      /\.prose :is\(h1, h2, h3, h4, h5, h6\),[\s\S]*?\.prose\.prose-static li \{\s*text-wrap: wrap;/
    )
  })
})
