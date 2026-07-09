import { JSDOM } from "jsdom"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Markdown } from "./markdown"

function renderMarkdown(markdown: string): HTMLElement {
  const html = renderToStaticMarkup(<Markdown>{markdown}</Markdown>)
  return new JSDOM(html).window.document.body
}

function expectLiteralText(markdown: string): void {
  const body = renderMarkdown(markdown)

  expect(body.querySelector(".katex")).toBeNull()
  expect(body.textContent).toBe(markdown)
}

describe("Markdown math delimiters", () => {
  it("keeps currency prose literal instead of treating the prices as math", () => {
    expectLiteralText(
      "$300 on eBay, and a signed CGC 9.9 copy just sold for $1800"
    )
  })

  it.each(["$1.25", "$1,800", "$5–$10"])(
    "keeps %s as ordinary text",
    (currency) => {
      expectLiteralText(currency)
    }
  )

  it("renders double-dollar inline math without consuming a preceding price", () => {
    const body = renderMarkdown("Price: $300; formula: $$x^2$$")

    expect(body.textContent).toContain("Price: $300; formula: ")
    expect(body.querySelector(".katex")).not.toBeNull()
    expect(body.querySelector(".katex-display")).toBeNull()
    expect(
      body.querySelector('annotation[encoding="application/x-tex"]')
        ?.textContent
    ).toBe("x^2")
  })

  it("renders same-line double-dollar delimiters as inline math", () => {
    const body = renderMarkdown("$$x^2$$")

    expect(body.querySelector(".katex")).not.toBeNull()
    expect(body.querySelector(".katex-display")).toBeNull()
  })

  it("renders separate-line double-dollar delimiters as display math", () => {
    const body = renderMarkdown("$$\nx^2\n$$")

    expect(body.querySelector(".katex-display")).not.toBeNull()
  })

  it("does not interpret dollar signs inside inline or fenced code as math", () => {
    const body = renderMarkdown(
      "Inline: `$x$ and $$x$$`\n\n```text\n$300 and $$x^2$$\n```"
    )

    expect(body.querySelector(".katex")).toBeNull()
    expect(body.textContent).toContain("$x$ and $$x$$")
    expect(body.textContent).toContain("$300 and $$x^2$$")
  })

  it("preserves escaped dollar signs as literal text", () => {
    const body = renderMarkdown("Escaped: \\$300 and \\$1800")

    expect(body.querySelector(".katex")).toBeNull()
    expect(body.textContent).toBe("Escaped: $300 and $1800")
  })

  it("treats legacy single-dollar math syntax as literal text", () => {
    expectLiteralText("Legacy formula: $x$")
  })

  it("keeps incomplete inline delimiters literal while streaming", () => {
    expectLiteralText("Trailing $")
    expectLiteralText("Incomplete $$x^2")
  })

  it("renders an incomplete display expression as valid best-effort math", () => {
    const body = renderMarkdown("$$\nx^2")

    expect(body.querySelector(".katex-display")).not.toBeNull()
    expect(body.querySelector(".katex-error")).toBeNull()
  })
})
