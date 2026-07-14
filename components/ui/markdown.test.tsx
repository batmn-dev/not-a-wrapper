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

describe("Markdown response controls and semantics", () => {
  it("keeps inline code semantic without leaking the parser node", () => {
    const body = renderMarkdown("Use `src/components/Button.tsx:42`.")
    const code = body.querySelector("code")

    expect(code?.textContent).toBe("src/components/Button.tsx:42")
    expect(code?.hasAttribute("node")).toBe(false)
  })

  it("renders a standalone labeled external link as a favicon pill", () => {
    const body = renderMarkdown("[Visit Example](https://example.com)")
    const link = body.querySelector("a")

    expect(link?.textContent).toBe("Visit Example")
    expect(link?.getAttribute("href")).toBe("https://example.com")
    expect(link?.getAttribute("target")).toBe("_blank")
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer")
    expect(link?.dataset.linkPresentation).toBe("pill")
    expect(link?.dataset.external).toBe("true")
    expect(link?.hasAttribute("node")).toBe(false)
    expect(link?.querySelector('[data-slot="external-link-icon"]')).toBeNull()
    expect(
      link?.querySelector('[data-slot="favicon-placeholder"]')
    ).not.toBeNull()

    expect(link?.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it("renders a standalone autolink as a pill with the clean domain", () => {
    const body = renderMarkdown("https://www.example.com/a/long/path")
    const link = body.querySelector("a")

    expect(link?.dataset.linkPresentation).toBe("pill")
    expect(link?.textContent).toBe("example.com")
    expect(link?.getAttribute("href")).toBe(
      "https://www.example.com/a/long/path"
    )
  })

  it("renders an external link embedded in prose as inline text with a decorative icon", () => {
    const body = renderMarkdown(
      "A sample factual statement. [Example Source](https://example.com/source)"
    )
    const link = body.querySelector("a")
    const icon = link?.querySelector('[data-slot="external-link-icon"]')

    expect(body.querySelector("p")?.textContent).toBe(
      "A sample factual statement. Example Source"
    )
    expect(link?.dataset.linkPresentation).toBe("inline")
    expect(link?.dataset.external).toBe("true")
    expect(link?.getAttribute("target")).toBe("_blank")
    expect(icon?.getAttribute("aria-hidden")).toBe("true")
    expect(icon?.querySelector("svg")?.getAttribute("focusable")).toBe("false")
  })

  it("preserves surrounding text and punctuation for inline external links", () => {
    const body = renderMarkdown(
      "Before [Example](https://example.com), during, and after."
    )

    expect(body.querySelector("p")?.textContent).toBe(
      "Before Example, during, and after."
    )
    expect(body.querySelector("a")?.dataset.linkPresentation).toBe("inline")
  })

  it("treats a link followed by a period as inline", () => {
    const body = renderMarkdown("[Example](https://example.com).")

    expect(body.querySelector("a")?.dataset.linkPresentation).toBe("inline")
    expect(body.querySelector("p")?.textContent).toBe("Example.")
  })

  it("treats two links in one paragraph as inline", () => {
    const body = renderMarkdown(
      "[One](https://one.example) [Two](https://two.example)"
    )
    const links = Array.from(body.querySelectorAll<HTMLAnchorElement>("a"))

    expect(links).toHaveLength(2)
    expect(links.every((link) => link.dataset.linkPresentation === "inline"))
      .toBe(true)
    expect(
      links.every((link) =>
        link.querySelector('[data-slot="external-link-icon"]')
      )
    ).toBe(true)
  })

  it("renders a terminal parenthesized citation in a list item as a pill", () => {
    const body = renderMarkdown(
      "- U.S. military activity raised wider regional concerns. ([apnews.com](https://apnews.com/article/example))"
    )
    const link = body.querySelector<HTMLAnchorElement>("li a")

    expect(body.querySelector("li")?.textContent).toBe(
      "U.S. military activity raised wider regional concerns. apnews.com"
    )
    expect(link?.dataset.linkPresentation).toBe("pill")
    expect(link?.querySelector('[data-slot="external-link-icon"]')).toBeNull()
    expect(link?.querySelector('[data-slot="favicon-placeholder"]')).not.toBeNull()
  })

  it("keeps a parenthesized external link within prose inline", () => {
    const body = renderMarkdown(
      "See ([the documentation](https://example.com/docs)) for details."
    )
    const link = body.querySelector("a")

    expect(body.querySelector("p")?.textContent).toBe(
      "See the documentation for details."
    )
    expect(link?.dataset.linkPresentation).toBe("inline")
    expect(
      link?.querySelector('[data-slot="external-link-icon"]')
    ).not.toBeNull()
  })

  it("keeps a standalone relative internal link inline and same-tab", () => {
    const body = renderMarkdown("[Settings](/settings)")
    const link = body.querySelector("a")

    expect(link?.dataset.linkPresentation).toBe("inline")
    expect(link?.hasAttribute("data-external")).toBe(false)
    expect(link?.hasAttribute("target")).toBe(false)
    expect(link?.hasAttribute("rel")).toBe(false)
    expect(link?.querySelector('[data-slot="external-link-icon"]')).toBeNull()
  })

  it.each([
    ["hash", "[Section](#section)"],
    ["query-only", "[Billing](?tab=billing)"],
    ["mailto", "[Email](mailto:hello@example.com)"],
    ["tel", "[Call](tel:+15551234567)"],
  ])("keeps %s links inline without an external icon", (_, markdown) => {
    const body = renderMarkdown(markdown)
    const link = body.querySelector("a")

    expect(link?.dataset.linkPresentation).toBe("inline")
    expect(link?.querySelector('[data-slot="external-link-icon"]')).toBeNull()
    expect(link?.hasAttribute("target")).toBe(false)
  })

  it("treats a protocol-relative web link as external", () => {
    const body = renderMarkdown("See [Example](//example.com/source) here.")
    const link = body.querySelector("a")

    expect(link?.dataset.linkPresentation).toBe("inline")
    expect(link?.dataset.external).toBe("true")
    expect(link?.getAttribute("target")).toBe("_blank")
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer")
    expect(
      link?.querySelector('[data-slot="external-link-icon"]')
    ).not.toBeNull()
  })

  it.each([
    ["list item", "- [Example](https://example.com)", "li"],
    ["heading", "## [Example](https://example.com)", "h2"],
    ["blockquote", "> [Example](https://example.com)", "blockquote"],
    [
      "table cell",
      "| Source |\n| --- |\n| [Example](https://example.com) |",
      "td",
    ],
  ])("keeps a link inside a %s inline", (_, markdown, container) => {
    const body = renderMarkdown(markdown)
    const link = body.querySelector<HTMLAnchorElement>(`${container} a`)

    expect(link?.dataset.linkPresentation).toBe("inline")
    expect(
      link?.querySelector('[data-slot="external-link-icon"]')
    ).not.toBeNull()
  })

  it("does not convert an image-only link into a text pill", () => {
    const body = renderMarkdown(
      "[![Example logo](https://example.com/logo.png)](https://example.com)"
    )
    const link = body.querySelector("a")

    expect(link?.dataset.linkPresentation).toBe("inline")
    expect(link?.querySelector("img")?.getAttribute("alt")).toBe(
      "Example logo"
    )
  })

  it("preserves nested formatting inside an inline link", () => {
    const body = renderMarkdown(
      "Read [the **important** `documentation`](https://example.com/docs) now."
    )
    const link = body.querySelector("a")

    expect(link?.dataset.linkPresentation).toBe("inline")
    expect(link?.querySelector("strong")?.textContent).toBe("important")
    expect(link?.querySelector("code")?.textContent).toBe("documentation")
  })

  it.each([
    "*[Visit Example](https://example.com)*",
    "**[Visit Example](https://example.com)**",
    "~~[Visit Example](https://example.com)~~",
  ])("classifies a standalone link through transparent formatting: %s", (md) => {
    const body = renderMarkdown(md)

    expect(body.querySelector("a")?.dataset.linkPresentation).toBe("pill")
    expect(body.querySelector("a")?.textContent).toBe("Visit Example")
  })

  it("renders incomplete streaming Markdown without throwing", () => {
    expect(() => renderMarkdown("See [Example](https://example.com")).not.toThrow()
    expect(() => renderMarkdown("Trailing [Example](")).not.toThrow()
  })

  it("preserves heading hierarchy and native GFM task-list semantics", () => {
    const body = renderMarkdown(
      "##### Heading 5\n\n###### Heading 6\n\n- [x] Done\n- [ ] Pending"
    )
    const checkboxes = body.querySelectorAll<HTMLInputElement>(
      '.contains-task-list input[type="checkbox"]'
    )

    expect(body.querySelector("h5")?.textContent).toBe("Heading 5")
    expect(body.querySelector("h6")?.textContent).toBe("Heading 6")
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]?.checked).toBe(true)
    expect(checkboxes[1]?.checked).toBe(false)
    expect(Array.from(checkboxes).every((input) => input.disabled)).toBe(true)
  })

  it("adds an accessible copy action to tables", () => {
    const body = renderMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |")
    const table = body.querySelector("table")

    expect(table).not.toBeNull()
    expect(table?.hasAttribute("node")).toBe(false)
    expect(body.querySelector('button[aria-label="Copy table"]')).not.toBeNull()
  })

  it("uses friendly code language labels and hides plaintext labels", () => {
    const syntax = renderMarkdown("```javascript\nconst ready = true\n```")
    const plaintext = renderMarkdown("```text\nReady\n```")

    expect(syntax.textContent).toContain("JavaScript")
    expect(plaintext.textContent).not.toContain("plaintext")
    expect(plaintext.textContent).not.toContain("textCopy")
  })
})
