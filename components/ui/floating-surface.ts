/**
 * Shared floating-surface recipes. Keep menu geometry here so dropdown,
 * context, menubar, select, and combobox surfaces cannot drift independently.
 * Content popovers reuse only the surface recipe because their internal layout
 * is content-owned rather than row-owned.
 */
const floatingSurfaceClassName =
  "bg-floating-surface text-floating-surface-foreground shadow-floating-surface"

const floatingSelectSurfaceClassName =
  "bg-floating-surface text-floating-surface-foreground shadow-floating-select"

const floatingMenuContentClassName = "rounded-(--floating-menu-radius) py-2.5"

/**
 * Interaction-state backgrounds are behavior, not geometry: items that opt out
 * of the shared box geometry (geometry="custom") must still highlight.
 */
const floatingMenuItemActiveClassName =
  "hover:bg-floating-menu-item-active focus:bg-floating-menu-item-active data-highlighted:bg-floating-menu-item-active data-open:bg-floating-menu-item-active data-popup-open:bg-floating-menu-item-active data-selected:bg-floating-menu-item-active"

const floatingMenuItemClassName = `mx-2.5 h-9 rounded-(--floating-menu-item-radius) px-2 py-1.5 ${floatingMenuItemActiveClassName}`

const floatingMenuLabelClassName = "mx-2.5 px-2 py-1.5"

const floatingMenuSeparatorClassName = "bg-floating-menu-divider mx-4 my-2 h-px"

export {
  floatingMenuContentClassName,
  floatingMenuItemActiveClassName,
  floatingMenuItemClassName,
  floatingMenuLabelClassName,
  floatingMenuSeparatorClassName,
  floatingSelectSurfaceClassName,
  floatingSurfaceClassName,
}
