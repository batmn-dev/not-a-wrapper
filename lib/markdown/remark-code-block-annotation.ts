import type { Nodes, Root } from "mdast"

export const CODE_BLOCK_ATTRIBUTE = "data-code-block"

/**
 * Preserves the parser's block-code classification for custom renderers.
 * HAST code elements do not expose their parent to react-markdown components,
 * so block code must be annotated before the MDAST-to-HAST conversion.
 */
export function remarkCodeBlockAnnotation() {
  return (tree: Root) => {
    annotateCodeBlocks(tree)
  }
}

function annotateCodeBlocks(node: Nodes): void {
  if (node.type === "code") {
    node.data ??= {}
    node.data.hProperties = {
      ...node.data.hProperties,
      [CODE_BLOCK_ATTRIBUTE]: "true",
    }
  }

  if (!("children" in node)) return
  for (const child of node.children) annotateCodeBlocks(child)
}
