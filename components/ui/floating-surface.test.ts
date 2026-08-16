import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  floatingMenuContentClassName,
  floatingMenuItemClassName,
  floatingMenuLabelClassName,
  floatingMenuSeparatorClassName,
  floatingSurfaceClassName,
} from "./floating-surface"

const root = new URL("../../", import.meta.url)

function read(path: string) {
  return readFileSync(new URL(path, root), "utf8")
}

describe("floating surface contract", () => {
  it("keeps surface, menu geometry, and dividers semantic", () => {
    expect(floatingSurfaceClassName).toBe(
      "bg-floating-surface text-floating-surface-foreground shadow-floating-surface"
    )
    expect(floatingMenuContentClassName).toBe(
      "rounded-(--floating-menu-radius) py-2.5"
    )
    expect(floatingMenuItemClassName).toBe(
      "mx-2.5 h-9 rounded-(--floating-menu-item-radius) px-2 py-1.5"
    )
    expect(floatingMenuLabelClassName).toBe("mx-2.5 px-2 py-1.5")
    expect(floatingMenuSeparatorClassName).toBe(
      "bg-floating-menu-divider mx-4 my-2 h-px"
    )
  })

  it("defines the measured dark surface without changing generic popovers", () => {
    const css = read("app/globals.css")

    expect(css).toContain("--popover: oklch(0.222 0 0);")
    expect(css).toContain("--floating-surface: oklch(0.329 0 0);")
    expect(css).toContain("--floating-menu-radius: 1.25rem;")
    expect(css).toContain("--floating-menu-item-radius: 0.75rem;")
    expect(css).toContain("--floating-menu-divider: var(--border-default);")
    expect(css).toMatch(
      /--floating-surface-edge-shadow:\s*inset 0 0 1px\s*color-mix\(in oklab, var\(--foreground\) 20%, transparent\);/
    )
  })

  it.each([
    "components/ui/dropdown-menu.tsx",
    "components/ui/context-menu.tsx",
    "components/ui/select.tsx",
    "components/ui/combobox.tsx",
  ])("routes menu geometry through the shared recipe in %s", (path) => {
    const source = read(path)

    expect(source).toContain("floatingSurfaceClassName")
    expect(source).toContain("floatingMenuContentClassName")
    expect(source).toContain("floatingMenuItemClassName")
    expect(source).toContain("floatingMenuSeparatorClassName")
  })

  it("lets content popovers share the surface without inheriting menu padding", () => {
    for (const path of [
      "components/ui/popover.tsx",
      "components/ui/hover-card.tsx",
    ]) {
      const source = read(path)
      expect(source).toContain("floatingSurfaceClassName")
      expect(source).not.toContain("floatingMenuContentClassName")
    }
  })

  it("uses a menu-owned leading slot without changing glyph sizing", () => {
    const source = read("components/ui/menu-leading-icon.tsx")

    expect(source).toContain(
      'slotSize="var(--floating-menu-leading-slot-size)"'
    )
    expect(source).not.toContain("glyphSize=")
    expect(source).not.toContain("SidebarLeadingIcon")
  })

  it("derives the expanded account menu width from the sidebar", () => {
    const source = read("app/components/layout/user-menu.tsx")

    expect(source).toContain(
      'className="w-[calc(var(--sidebar-width)-0.75rem)]"'
    )
    expect(source).toContain("<MenuLeadingIcon")
    expect(source).not.toContain("<SidebarLeadingIcon")
    expect(source).not.toContain('className="gap-0"')
  })
})
