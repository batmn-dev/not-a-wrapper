import type { Nodes, Root, RootContent } from "mdast"
import type { Plugin } from "unified"

export type ParsedMarkdownBlock = {
  source: string
  node: RootContent
}

function hasDocumentContext(node: Nodes): boolean {
  return (
    node.type === "definition" ||
    node.type === "linkReference" ||
    node.type === "imageReference" ||
    node.type === "footnoteDefinition" ||
    node.type === "footnoteReference" ||
    node.type === "html" ||
    ("children" in node && node.children.some(hasDocumentContext))
  )
}

export function canReuseParsedMarkdownWindow(root: Root): boolean {
  // Definitions can affect sibling parsing even when the sibling has no reference node.
  return !root.children.some(hasDocumentContext)
}

export function retainParsedMarkdownBlock(
  node: RootContent,
  source: string,
  previous: RootContent | undefined
): ParsedMarkdownBlock | undefined {
  if (
    node.position?.start.column !== 1 ||
    /^[ \t]/.test(source) ||
    hasDocumentContext(node) ||
    previous?.type === "code" ||
    previous?.type === "footnoteDefinition" ||
    previous?.type === "definition" ||
    (previous?.position?.end.offset ?? 0) > (node.position.start.offset ?? 0)
  )
    return
  return { source, node }
}

/** Reuse syntax only; the renderer's normal remark/rehype transforms still run. */
export const remarkParsedBlock: Plugin<[ParsedMarkdownBlock], string, Root> =
  function (block) {
    const parse = this.parser
    this.parser = (source, file) => {
      if (source !== block.source) {
        if (!parse) throw new Error("Markdown parser is unavailable")
        return parse(source, file) as Root
      }
      // Transforms annotate nodes. Never let them mutate the retained projection.
      const node = structuredClone(block.node)
      const origin = { ...node.position!.start }
      const rebase = (current: Nodes) => {
        if (current.position) {
          for (const point of [current.position.start, current.position.end]) {
            point.line -= origin.line - 1
            if (point.offset !== undefined) point.offset -= origin.offset ?? 0
          }
        }
        if ("children" in current) current.children.forEach(rebase)
      }
      rebase(node)
      return {
        type: "root",
        children: [node],
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { ...node.position!.end },
        },
      }
    }
  }
