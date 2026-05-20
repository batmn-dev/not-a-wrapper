---
name: dropdown-popover-styling
description: Use when styling or reviewing dropdown menus, popovers, menu items, menubar items, or chat plus-menu controls in this repo. Captures local visual defaults for shared menu/popover primitives, including radius, padding, item height, icon sizing, and avoiding one-off spacing overrides.
---

# Dropdown And Popover Styling

Use this skill before changing menu or popover styling in `not-a-wrapper`, especially `components/ui/dropdown-menu.tsx`, `components/ui/popover.tsx`, `components/ui/menubar.tsx`, and chat input menus.

## Defaults

- `PopoverContent` is the visual reference for shared menu surfaces: `rounded-2xl` and `p-1.5`.
- `DropdownMenuContent` should match `PopoverContent`: `rounded-2xl` and `p-1.5`.
- Inner dropdown item primitives should use `rounded-lg`.
- Dropdown item default height should be `h-9` (36px).
- Dropdown and menubar item default icon size should be 20px. For raw SVG descendants, use `size-5`.
- When a menu item uses the repo `Icon` component, raw SVG defaults do not apply. Set `slotSize={20}` unless that icon is intentionally smaller for a specific non-menu control.
- Do not add icon spacing classes like `mr-2` inside dropdown or menubar item icons. The item primitive owns icon/text spacing through `gap-2`.

## Chat Plus Menu

- The logged-in chat plus menu uses `DropdownMenuContent`, not `PopoverContent`.
- Keep the logged-in plus menu width content-sized with `className="w-max"` unless the user explicitly asks for a fixed width.
- Do not add local padding or rounding overrides to the plus menu content; let `DropdownMenuContent` provide the shared padding and radius.
- The signed-out/auth path uses `PopoverContentAuth`, which wraps `PopoverContent`; match shared popover rounding unless the user explicitly asks for a different auth-card shape.

## Before Editing

- Check whether the surface is a `PopoverContent` or `DropdownMenuContent`; they are separate primitives.
- Prefer changing shared primitives when the requested behavior is a general default.
- Prefer a narrow local override only when the request is specific to one menu, such as plus-menu width.
- If an item looks too widely spaced, inspect both the primitive `gap-*` and icon-local margin classes before changing dimensions.
