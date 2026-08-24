import { floatingMenuItemActiveClassName } from "@/components/ui/floating-surface"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

/**
 * The editor-owned menu row: a plain div that never takes focus away from the
 * ProseMirror editor (pointer-down is prevented; highlight is menu state, not
 * DOM focus). It deliberately does NOT use DropdownMenuItem — Base UI items
 * own focus — while sharing the floating-surface active-state vocabulary.
 *
 * `composerMenuRow` is a render factory, not a component: Tooltip and other
 * Base UI `render={...}` seams merge their props directly onto the returned
 * element, which must stay the row's real DOM node.
 */

const composerMenuRowClassName = cn(
  floatingMenuItemActiveClassName,
  "menu-item-hoverable relative mx-2 flex h-(--floating-menu-item-height) cursor-pointer items-center gap-3 rounded-(--floating-menu-item-radius) px-2 py-1.5 text-sm outline-none select-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
)

type ComposerMenuRowOptions = {
  itemId: string
  disabled: boolean
  highlighted: boolean
  onActivate: (itemId: string) => void
  onHighlight: (itemId: string) => void
  children: ReactNode
}

function composerMenuRow({
  itemId,
  disabled,
  highlighted,
  onActivate,
  onHighlight,
  children,
}: ComposerMenuRowOptions) {
  return (
    <div
      ref={(node) => {
        if (
          node &&
          highlighted &&
          typeof node.scrollIntoView === "function"
        ) {
          node.scrollIntoView({ block: "nearest" })
        }
      }}
      aria-disabled={disabled || undefined}
      data-fill=""
      data-highlighted={highlighted ? "" : undefined}
      className={composerMenuRowClassName}
      tabIndex={disabled ? -1 : 0}
      onClick={() => {
        if (!disabled) onActivate(itemId)
      }}
      onPointerDown={(event) => event.preventDefault()}
      onPointerMove={() => {
        if (!disabled) onHighlight(itemId)
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== "Enter" && event.key !== " ")) {
          return
        }
        event.preventDefault()
        onActivate(itemId)
      }}
    >
      {children}
    </div>
  )
}

export { composerMenuRow }
