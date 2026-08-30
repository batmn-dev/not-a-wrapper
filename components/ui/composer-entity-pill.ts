import { RI_GLOBAL_LINE_PATH } from "@/lib/icons/composer"
import type { DOMOutputSpec, Node as ProseMirrorNode } from "prosemirror-model"

/**
 * The mention-pill DOM contract is isolated from the rest of the schema so pill
 * growth (connector detail pages, previewable files) does not churn the
 * document model. `composerEntityPillToDOM` is the schema's `toDOM` for the
 * `composerEntity` node; `parseComposerEntityPill` is its `parseDOM` reader.
 */

const selectedEntityClassName =
  "data-[inline-selection-pill-selected]:bg-(--composer-selection-background) selection:bg-transparent selection:text-inherit"

function parseComposerEntityPill(node: HTMLElement | string) {
  if (!(node instanceof HTMLElement)) return false
  const id = node.dataset.id
  const label = node.dataset.keyword
  if (!id || !label) return false
  const kind = node.dataset.symbol === "skillMention" ? "tool" : "capability"
  return {
    id: kind === "capability" && id === "search" ? "web-search" : id,
    kind,
    label,
    iconUrl: node.querySelector("img")?.getAttribute("src") ?? null,
    ...(node.dataset.removable === "false" ? { removable: false } : {}),
  }
}

// Mention pill rendering contract:
// connector-style mentions render an <img> icon in a 5×5 rounded-sm
// wrapper with the raw id as data-system-hint-type, and their icon+label
// sit inside an inner anchor whose RENDERED color is primary text — the
// pill root stays accent, but `.prosemirror-parent a { color:
// var(--text-primary) }` overrides the anchor's text-inherit. We have no
// plugin detail pages, so the inner wrapper is a span carrying that
// rendered result. Built-ins (web-search) keep the flat accent layout
// with an inline glyph, and "tool" mentions carry
// data-symbol="skillMention".
function composerEntityPillToDOM(node: ProseMirrorNode): DOMOutputSpec {
  const rootAttrs = {
    class:
      "text-composer-capability-accent hover:text-composer-capability-accent not-data-[inline-selection-pill-selected]:hover:bg-transparent data-[inline-file-previewable]:cursor-pointer data-[system-hint-type=glaux]:cursor-pointer data-[system-hint-type=glaux]:rounded-md data-[system-hint-type=glaux]:transition-colors data-[system-hint-type=glaux]:not-data-[inline-selection-pill-selected]:hover:bg-interactive-hover inline-flex min-w-0 cursor-text items-center gap-1 whitespace-nowrap rounded-none bg-transparent px-1 py-0 align-baseline",
    contenteditable: "false",
    "data-id": node.attrs.id === "web-search" ? "search" : node.attrs.id,
    "data-inline-selection-pill": "",
    "data-keyword": node.attrs.label,
    "data-symbol":
      node.attrs.kind === "tool" ? "skillMention" : "ecosystemMention",
    "data-system-hint-type":
      node.attrs.id === "web-search" ? "search" : node.attrs.id,
    ...(node.attrs.removable === false ? { "data-removable": "false" } : {}),
    dir: "auto",
  }
  const labelSpec = [
    "span",
    { class: "max-w-[16rem] self-baseline truncate" },
    node.attrs.label,
  ]

  if (node.attrs.iconUrl) {
    return [
      "span",
      rootAttrs,
      [
        "span",
        {
          class:
            "text-foreground inline-flex min-w-0 items-center gap-1 rounded-sm",
        },
        [
          "span",
          {
            "aria-hidden": "true",
            // The icon wrapper uses 4px; rounded-sm is 6px, so the literal is
            // pinned deliberately.
            class:
              "relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[4px]",
          },
          [
            "img",
            {
              alt: "",
              class: "size-full object-cover",
              src: node.attrs.iconUrl,
            },
          ],
        ],
        labelSpec,
      ],
    ] as DOMOutputSpec
  }

  return [
    "span",
    rootAttrs,
    [
      "http://www.w3.org/2000/svg svg",
      {
        "aria-hidden": "true",
        class: "h-5 w-5 shrink-0",
        fill: "none",
        height: "24",
        viewBox: "0 0 24 24",
        width: "24",
      },
      [
        "path",
        {
          d: RI_GLOBAL_LINE_PATH,
          fill: "var(--web-search-icon-foreground)",
        },
      ],
    ],
    labelSpec,
  ] as DOMOutputSpec
}

export {
  composerEntityPillToDOM,
  parseComposerEntityPill,
  selectedEntityClassName,
}
