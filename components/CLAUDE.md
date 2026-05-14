# Components Context

Reusable UI lives here. Prefer existing components and variants before creating new surface area.

## Current Structure

- `components/ui/`: Base UI-backed primitives and shadcn-derived components.
- `components/common/`: shared app components.
- `components/icons/`: custom provider and brand icons.
- `components/motion-primitives/`: reusable animation helpers.

## Rules

- Use Base UI patterns for primitives. Triggers and slot-style composition use the `render` prop.
- Use Tailwind classes and existing `cva` variants for styling.
- Use Remix Icons from `@remixicon/react` for UI glyphs.
- Use `components/icons/README.md` for custom brand icon conventions.
- Keep interactive components keyboard accessible.

## Shadcn Notes

`components.json` uses the Base UI style. The project icon convention is Remix Icons, so generated shadcn examples may need icon imports converted before use.

Run the shadcn CLI only when explicitly approved, because it can rewrite tracked component files.
