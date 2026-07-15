import type {
  Definition,
  Link,
  LinkReference,
  Nodes,
  PhrasingContent,
  Root,
} from "mdast"

type MarkdownLink = Link | LinkReference
type TransparentWrapper = Extract<
  PhrasingContent,
  { type: "delete" | "emphasis" | "strong" }
>

export function isExternalHttpHref(href: string): boolean {
  try {
    const url = new URL(href.startsWith("//") ? `https:${href}` : href)
    return (
      ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname)
    )
  } catch {
    return false
  }
}

function meaningfulChildren(
  children: PhrasingContent[]
): PhrasingContent[] {
  return children.filter(
    (child) => child.type !== "text" || child.value.trim().length > 0
  )
}

function findOnlyLink(node: PhrasingContent): MarkdownLink | null {
  if (node.type === "link" || node.type === "linkReference") return node

  if (
    node.type !== "emphasis" &&
    node.type !== "strong" &&
    node.type !== "delete"
  ) {
    return null
  }

  const children = meaningfulChildren((node as TransparentWrapper).children)
  return children.length === 1 ? findOnlyLink(children[0]) : null
}

function readableText(node: PhrasingContent): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value
  if (node.type === "image" || node.type === "imageReference") return ""
  if ("children" in node) return node.children.map(readableText).join("")
  return ""
}

function getLinkHref(
  link: MarkdownLink,
  definitions: ReadonlyMap<string, string>
): string | undefined {
  if (link.type === "link") return link.url
  return definitions.get(link.identifier.toLowerCase())
}

function markAsPill(link: MarkdownLink): void {
  link.data ??= {}
  link.data.hProperties = {
    ...link.data.hProperties,
    "data-link-presentation": "pill",
  }
}

function markTerminalParenthesizedCitation(
  children: PhrasingContent[],
  definitions: ReadonlyMap<string, string>
): void {
  for (let index = 1; index < children.length - 1; index++) {
    const previous = children[index - 1]
    const current = children[index]
    const next = children[index + 1]

    if (
      previous.type !== "text" ||
      current.type !== "link" ||
      next.type !== "text" ||
      !/\(\s*$/.test(previous.value)
    ) {
      continue
    }

    const closingParenthesis = next.value.match(/^\s*\)/)
    if (!closingParenthesis) continue

    const trailingText = next.value.slice(closingParenthesis[0].length)
    if (
      trailingText.trim().length > 0 ||
      meaningfulChildren(children.slice(index + 2)).length > 0
    ) {
      continue
    }

    const href = getLinkHref(current, definitions)
    if (href && isExternalHttpHref(href)) markAsPill(current)
  }
}

/**
 * Annotates eligible top-level standalone links and terminal parenthesized
 * citations for contextual presentation. Other nested and prose links retain
 * ordinary inline semantics.
 */
export function remarkLinkPresentation() {
  return (tree: Root) => {
    const definitions = new Map<string, string>()

    for (const child of tree.children) {
      if (child.type === "definition") {
        const definition = child as Definition
        definitions.set(definition.identifier.toLowerCase(), definition.url)
      }
    }

    for (const child of tree.children) {
      if ("children" in child) {
        markTerminalCitationsInDescendants(child, definitions)
      }

      if (child.type !== "paragraph") continue

      const children = meaningfulChildren(child.children)
      if (children.length !== 1) continue

      const link = findOnlyLink(children[0])
      if (!link || readableText(link).trim().length === 0) continue

      const href = getLinkHref(link, definitions)
      if (!href || !isExternalHttpHref(href)) continue

      markAsPill(link)
    }
  }
}

function markTerminalCitationsInDescendants(
  node: Nodes,
  definitions: ReadonlyMap<string, string>
): void {
  if (node.type === "paragraph") {
    markTerminalParenthesizedCitation(node.children, definitions)
  }

  if (!("children" in node)) return
  for (const child of node.children) {
    markTerminalCitationsInDescendants(child, definitions)
  }
}
