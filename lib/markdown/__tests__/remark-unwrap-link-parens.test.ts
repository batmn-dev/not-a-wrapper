import type { Code, InlineCode, Link, Paragraph, Root, Text } from "mdast"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"
import { describe, expect, it } from "vitest"
import { remarkUnwrapLinkParens } from "../remark-unwrap-link-parens"

function process(md: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkUnwrapLinkParens)
  const tree = processor.parse(md)
  processor.runSync(tree)
  return tree as Root
}

function paragraphAt(tree: Root, index = 0): Paragraph {
  return tree.children[index] as Paragraph
}

describe("remarkUnwrapLinkParens", () => {
  it("strips wrapper parens from ([text](url))", () => {
    const para = paragraphAt(process("([apnews.com](https://apnews.com/path))"))
    expect(para.children).toHaveLength(1)
    expect(para.children[0].type).toBe("link")
    expect((para.children[0] as Link).url).toBe("https://apnews.com/path")
  })

  it("strips wrapper parens with inner whitespace: ( [text](url) )", () => {
    const para = paragraphAt(process("( [React docs](https://react.dev) )"))
    expect(para.children).toHaveLength(1)
    expect(para.children[0].type).toBe("link")
  })

  it("leaves normal parenthesised text unchanged", () => {
    const para = paragraphAt(process("Normal text with (parentheses) here"))
    expect(para.children).toHaveLength(1)
    expect(para.children[0].type).toBe("text")
    expect((para.children[0] as Text).value).toBe(
      "Normal text with (parentheses) here"
    )
  })

  it("preserves URLs containing balanced parentheses", () => {
    const para = paragraphAt(
      process("([Fish](https://en.wikipedia.org/wiki/Fish_(animal)))")
    )
    const link = para.children.find((c) => c.type === "link") as Link
    expect(link).toBeDefined()
    expect(link.url).toBe("https://en.wikipedia.org/wiki/Fish_(animal)")
  })

  it("does not modify fenced code blocks", () => {
    const tree = process("```\n([x](y))\n```")
    const code = tree.children[0] as Code
    expect(code.type).toBe("code")
    expect(code.value).toBe("([x](y))")
  })

  it("does not modify inline code", () => {
    const para = paragraphAt(process("`([x](y))`"))
    const node = para.children[0] as InlineCode
    expect(node.type).toBe("inlineCode")
    expect(node.value).toBe("([x](y))")
  })

  it("does not strip non-paren punctuation around links", () => {
    const para = paragraphAt(process('"[link](https://example.com)"'))
    const texts = para.children.filter((c) => c.type === "text") as Text[]
    expect(texts.some((t) => t.value.includes('"'))).toBe(true)
  })

  it("handles multiple wrapped links in one paragraph", () => {
    const para = paragraphAt(
      process("([a](https://a.com)) and ([b](https://b.com))")
    )
    const links = para.children.filter((c) => c.type === "link")
    expect(links).toHaveLength(2)
    const texts = para.children.filter((c) => c.type === "text") as Text[]
    expect(texts).toHaveLength(1)
    expect(texts[0].value).toBe(" and ")
  })

  it("preserves surrounding text when stripping", () => {
    const para = paragraphAt(
      process("See ([docs](https://docs.dev)) for details.")
    )
    const texts = para.children.filter((c) => c.type === "text") as Text[]
    expect(texts.map((t) => t.value)).toEqual(["See ", " for details."])
    expect(para.children.filter((c) => c.type === "link")).toHaveLength(1)
  })

  it("strips only one layer from double-wrapped links", () => {
    const para = paragraphAt(process("(([link](https://x.com)))"))
    const texts = para.children.filter((c) => c.type === "text") as Text[]
    const parens = texts.map((t) => t.value).join("")
    expect(parens).toBe("()")
  })
})
