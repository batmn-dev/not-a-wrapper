/**
 * Remark plugin that strips parentheses wrapping around link nodes.
 *
 * AI models commonly emit `([text](url))` where the outer `( )` are
 * presentation artifacts. This plugin operates on the parsed mdast so
 * fenced/inline code is naturally excluded and URLs with special characters
 * are already resolved by the parser.
 */
import type { Nodes, Root, RootContent } from "mdast"

export function remarkUnwrapLinkParens() {
  return (tree: Root) => {
    walkParents(tree)
  }
}

function walkParents(node: Nodes): void {
  if (!("children" in node)) return
  unwrapLinksInPlace(node.children)
  for (const child of node.children) {
    walkParents(child)
  }
}

/**
 * Scan a children array (backwards, to tolerate splices) for the pattern:
 *   text ending with `(`  →  link  →  text starting with `)`
 * and strip only the wrapper parens + their immediately adjacent whitespace.
 */
function unwrapLinksInPlace(children: RootContent[]): void {
  for (let i = children.length - 2; i >= 1; i--) {
    const prev = children[i - 1]
    const curr = children[i]
    const next = children[i + 1]

    if (prev.type === "text" && curr.type === "link" && next.type === "text") {
      const openMatch = prev.value.match(/\(\s*$/)
      const closeMatch = next.value.match(/^\s*\)/)
      if (!openMatch || !closeMatch) continue

      prev.value = prev.value.slice(0, -openMatch[0].length)
      next.value = next.value.slice(closeMatch[0].length)

      if (!next.value) children.splice(i + 1, 1)
      if (!prev.value) children.splice(i - 1, 1)
    }
  }
}
