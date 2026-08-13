/**
 * Shared floating-surface recipes. Keep menu geometry here so dropdown,
 * context, menubar, select, and combobox surfaces cannot drift independently.
 * Content popovers reuse only the surface recipe because their internal layout
 * is content-owned rather than row-owned.
 */
const floatingSurfaceClassName =
  "bg-floating-surface text-floating-surface-foreground shadow-floating-surface"

const floatingMenuContentClassName = "rounded-(--floating-menu-radius) py-2.5"

const floatingMenuItemClassName =
  "mx-2.5 h-9 rounded-(--floating-menu-item-radius) px-2 py-1.5"

const floatingMenuLabelClassName = "mx-2.5 px-2 py-1.5"

const floatingMenuSeparatorClassName = "bg-floating-menu-divider mx-4 my-2 h-px"

export {
  floatingMenuContentClassName,
  floatingMenuItemClassName,
  floatingMenuLabelClassName,
  floatingMenuSeparatorClassName,
  floatingSurfaceClassName,
}
