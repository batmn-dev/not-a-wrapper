# Icon Renders at 16px Despite `size={N}` Prop

## Symptom

A Remix icon renders at 16×16px even though the `size` prop is set to a larger value (e.g., `size={20}`, `size={24}`). The icon appears visually smaller than intended.

## Cause

Shadcn's `buttonVariants` (used by `Button`, `DropdownMenuTrigger` with button render, and any component built on `buttonVariants`) applies this CSS rule:

```css
[&_svg:not([class*='size-'])]:size-4
```

This selector targets any child SVG element whose `class` attribute does **not** contain the string `size-`. When matched, it forces `width: 1rem; height: 1rem` (16px), which overrides the HTML `width`/`height` attributes set by the `size` prop.

The `size` prop on Remix icon components sets HTML attributes, not CSS. CSS always wins over HTML attributes for sizing.

## Fix

Add the corresponding Tailwind `size-*` class to the icon's `className`:

```tsx
// Before — broken inside Button
<RiSearchLine size={20} />

// After — works everywhere
<RiSearchLine size={20} className="size-5" />
```

Keep the `size` prop for correct SVG intrinsic dimensions. The Tailwind class handles CSS sizing.

### Pixel-to-Tailwind Mapping

| `size` prop | Tailwind class                             |
| ----------- | ------------------------------------------ |
| 8           | `size-2`                                   |
| 10          | `size-2.5`                                 |
| 12          | `size-3`                                   |
| 14          | `size-3.5`                                 |
| 16          | `size-4` (Shadcn default — class optional) |
| 20          | `size-5`                                   |
| 24          | `size-6`                                   |
| 32          | `size-8`                                   |
| 48          | `size-12`                                  |

## Scope

Affects any SVG inside a component using `buttonVariants`, including:

- `Button` (`components/ui/button.tsx`)
- `DropdownMenuTrigger` when rendered as a button
- `Toggle`, `ToggleGroupItem`
- Any custom component that applies `buttonVariants()`

Also applies universally as a project convention — all non-default-sized icons should have Tailwind classes regardless of their current parent, to prevent future breakage when components are moved or refactored.

## Related

- Cursor rule: `.cursor/rules/090-icon-sizing.mdc`
