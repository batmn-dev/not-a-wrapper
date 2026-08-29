import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  floatingMenuContentClassName,
  floatingMenuItemActiveClassName,
  floatingMenuItemClassName,
  floatingMenuLabelClassName,
  floatingMenuSeparatorClassName,
  floatingSelectSurfaceClassName,
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
    expect(floatingSelectSurfaceClassName).toBe(
      "bg-floating-surface text-floating-surface-foreground shadow-floating-select"
    )
    expect(floatingMenuContentClassName).toBe(
      "rounded-(--floating-menu-radius) py-2.5"
    )
    expect(floatingMenuItemActiveClassName).toBe(
      "hover:bg-floating-menu-item-active focus:bg-floating-menu-item-active data-highlighted:bg-floating-menu-item-active data-open:bg-floating-menu-item-active data-popup-open:bg-floating-menu-item-active data-selected:bg-floating-menu-item-active"
    )
    expect(floatingMenuItemClassName).toBe(
      `mx-2.5 h-(--floating-menu-item-height) rounded-(--floating-menu-item-radius) px-2 py-1.5 ${floatingMenuItemActiveClassName}`
    )
    expect(floatingMenuLabelClassName).toBe("mx-2.5 px-2 py-1.5")
    expect(floatingMenuSeparatorClassName).toBe(
      "bg-floating-menu-divider mx-4 my-2 h-px"
    )
  })

  it("defines the measured light and dark surface recipes", () => {
    const css = read("app/globals.css")

    expect(css).toContain("--popover: oklch(0.222 0 0);")
    expect(css).toContain("--floating-surface: oklch(1 0 0);")
    // ChatGPT's canonical dark menu surface #353535 (measured 2026-08-24).
    expect(css).toContain("--floating-surface: oklch(0.329 0 0);")
    expect(css).toContain("--modal-centered-surface: #212121;")
    expect(css).toContain("--modal-search-surface: #212121;")
    expect(css).toMatch(
      /--floating-surface-edge-shadow:\s*0 0 0 1px #0000000a, 0 2px 8px #0000000a, 0 4px 80px 8px #00000006;/
    )
    expect(css).toContain(
      "--floating-surface-edge-shadow: inset 0 0 1px rgba(255, 255, 255, 0.2);"
    )
    expect(css).toContain("--floating-menu-item-active: rgba(0, 0, 0, 0.04);")
    expect(css).toContain(
      "--floating-menu-item-active: rgba(255, 255, 255, 0.1);"
    )
    expect(css).toContain("--floating-menu-radius: 1.25rem;")
    expect(css).toContain("--floating-menu-item-radius: 0.75rem;")
    expect(css).toContain(
      "--floating-menu-item-height: calc(var(--spacing) * 9);"
    )
    expect(css).toMatch(
      /--floating-menu-max-height:\s*calc\(\s*var\(--spacing\) \* 4 \+ var\(--floating-menu-item-height\) \* 10\s*\);/
    )
    expect(css).toMatch(
      /@media \(pointer: coarse\)[\s\S]*?--floating-menu-item-height: calc\(var\(--spacing\) \* 10\);/
    )
    expect(css).toContain("--floating-menu-divider: var(--border-default);")
    expect(css).toContain(
      "--composer-capability-accent: oklch(0.626 0.188 259.456);"
    )
    expect(css).toContain(
      "--composer-capability-accent: oklch(0.72 0.137 253.307);"
    )
    expect(css).toContain(
      "--composer-selection-background: oklch(0.684 0.157 256.21 / 0.35);"
    )
    expect(css).toContain(
      "--web-search-icon-surface: oklch(0.941 0.043 218.859);"
    )
    expect(css).toContain(
      "--web-search-icon-surface: oklch(0.334 0.02 221.692);"
    )
    expect(css).toContain(
      "--modal-search-edge-shadow: 0 14px 62px rgba(0, 0, 0, 0.25);"
    )
    expect(css).toContain(
      "--tooltip-edge-shadow: 0 8px 18px rgba(15, 23, 42, 0.2);"
    )
    expect(css).toContain("--tooltip-multiline-radius: 0.75rem;")
  })

  it.each([
    "components/ui/dropdown-menu.tsx",
    "components/ui/context-menu.tsx",
    "components/ui/combobox.tsx",
  ])("routes menu geometry through the shared recipe in %s", (path) => {
    const source = read(path)

    expect(source).toContain("floatingSurfaceClassName")
    expect(source).toContain("floatingMenuContentClassName")
    expect(source).toContain("floatingMenuItemClassName")
    expect(source).toContain("floatingMenuSeparatorClassName")
  })

  it("keeps active states on custom-geometry dropdown items", () => {
    const source = read("components/ui/dropdown-menu.tsx")

    expect(source).toMatch(
      /geometry === "menu"\s*\?\s*floatingMenuItemClassName\s*:\s*floatingMenuItemActiveClassName/
    )
  })

  it("lets shared popovers anchor to a wider owning surface", () => {
    const source = read("components/ui/popover.tsx")

    expect(source).toContain('"align" | "alignOffset" | "anchor"')
    expect(source).toContain("anchor={anchor}")
    expect(source).toContain("container={portalContainer}")
  })

  it("gives select its measured stronger floating edge", () => {
    const source = read("components/ui/select.tsx")

    expect(source).toContain("floatingSelectSurfaceClassName")
    expect(source).toContain("floatingMenuContentClassName")
    expect(source).toContain("floatingMenuItemClassName")
    expect(source).toContain("floatingMenuSeparatorClassName")
  })

  it("lets popovers share the surface without inheriting menu padding", () => {
    const source = read("components/ui/popover.tsx")

    expect(source).toContain("floatingSurfaceClassName")
    expect(source).not.toContain("floatingMenuContentClassName")
  })

  it("keeps hover cards on their existing unverified edge recipe", () => {
    const source = read("components/ui/hover-card.tsx")
    const sourcePreview = read("components/ui/source.tsx")

    expect(source).toContain("shadow-border-md")
    expect(source).not.toContain("floatingSurfaceClassName")
    expect(sourcePreview).not.toContain("shadow-border-md")
  })

  it("keeps standard menu consumers on shared geometry and active states", () => {
    const composerMenu = read("app/components/chat-input/button-plus-menu.tsx")
    const composerMenuItems = read(
      "app/components/chat-input/composer-menu-items.ts"
    )
    const composerMenuRow = read(
      "app/components/chat-input/composer-menu-row.tsx"
    )
    const sidebarMenu = read("app/components/layout/sidebar/sidebar-list.tsx")
    const menubar = read("components/ui/menubar.tsx")

    expect(composerMenu).not.toContain("composerPlusMenuItemClassName")
    expect(composerMenu).not.toContain("rounded-[16px]")
    expect(composerMenuItems).toContain("composerActionRegistry")
    expect(composerMenu).toContain("actionItems.map")
    expect(composerMenu).not.toContain("<CommandInput")
    expect(composerMenu).not.toContain('heading="Actions"')
    expect(composerMenu).toContain("anchor={composerAnchor}")
    expect(composerMenu).toContain("portalContainer={overlayContainerRef}")
    expect(composerMenu).toContain("initialFocus={false}")
    expect(composerMenuRow).toContain("data-highlighted={")
    expect(composerMenu).not.toContain("focusInitialAction")
    expect(composerMenu).toContain("action.description")
    expect(composerMenuRow).toContain("aria-disabled={disabled || undefined}")
    expect(composerMenuRow).toContain("if (!disabled) onActivate(itemId)")
    expect(composerMenuRow).toContain("floatingMenuItemActiveClassName")
    expect(composerMenu).not.toContain("cursor-not-allowed opacity-50")
    expect(composerMenuRow).not.toContain("cursor-not-allowed opacity-50")
    expect(sidebarMenu).not.toContain("sidebarMenuRadioItemClassName")
    expect(sidebarMenu).not.toContain("rounded-[16px]")
    expect(menubar).not.toContain("focus:bg-interactive-selected")
    expect(menubar).not.toContain("data-open:bg-interactive-selected")
  })

  it("keeps disabled menu items visually inert across primitive state shapes", () => {
    const css = read("app/globals.css")

    expect(css).toMatch(
      /\.menu-item-hoverable:is\([\s\S]*?\[aria-disabled="true"\],[\s\S]*?\[data-disabled\][\s\S]*?\):is\([\s\S]*?:hover,[\s\S]*?:focus,[\s\S]*?\[data-highlighted\],[\s\S]*?\[data-open\],[\s\S]*?\[data-popup-open\],[\s\S]*?\[data-selected\][\s\S]*?\) \{\s*background-color: transparent;/
    )
  })

  it("uses a menu-owned leading slot without changing glyph sizing", () => {
    const source = read("components/ui/menu-leading-icon.tsx")

    expect(source).toContain(
      'slotSize="var(--floating-menu-leading-slot-size)"'
    )
    expect(source).not.toContain("glyphSize=")
    expect(source).not.toContain("SidebarLeadingIcon")
  })

  it("shares the sidebar-derived account menu width across variants", () => {
    const source = read("app/components/layout/user-menu.tsx")

    expect(source).toContain("w-[calc(var(--sidebar-width)-0.75rem)]")
    expect(source).not.toContain("sidebarFloatingSurfaceShadowClassName")
    expect(
      source.match(/className=\{sidebarAccountMenuClassName\}/g)
    ).toHaveLength(2)
    expect(source).toContain("<MenuLeadingIcon")
    expect(source).not.toContain("<SidebarLeadingIcon")
    expect(source).not.toContain('className="gap-0"')
  })

  it("routes secondary surfaces through their semantic recipes", () => {
    expect(read("components/ui/navigation-menu.tsx")).toContain(
      "shadow-floating-surface"
    )
    expect(read("components/ui/tooltip.tsx")).toContain("shadow-tooltip")
    expect(read("components/ui/dialog.tsx")).toContain("shadow-modal-centered")
    expect(read("components/ui/alert-dialog.tsx")).toContain(
      "shadow-modal-centered"
    )
    expect(read("app/components/history/desktop-search-modal.tsx")).toContain(
      "shadow-modal-search"
    )
    expect(read("components/ui/morphing-popover.tsx")).toContain(
      "floatingSurfaceClassName"
    )
  })

  it("keeps outline tooltip geometry shared, uses the popover edge, and keeps morphing popovers non-modal", () => {
    const tooltip = read("components/ui/tooltip.tsx")
    const morphingPopover = read("components/ui/morphing-popover.tsx")

    expect(tooltip).toContain("rounded-(--tooltip-radius)")
    expect(tooltip).toContain(
      "has-[[data-slot=tooltip-multiline]]:rounded-(--tooltip-multiline-radius)"
    )
    expect(tooltip).toContain("px-3 py-[5px]")
    expect(tooltip).toContain("text-sm leading-[18px]")
    expect(tooltip).toContain(
      "bg-popover text-popover-foreground shadow-floating-surface"
    )
    expect(tooltip).toContain(
      "border border-[var(--border-tooltip)] bg-[var(--bg-tooltip)]"
    )
    expect(morphingPopover).toContain('"aria-haspopup": "dialog"')
    expect(morphingPopover).toContain('role="dialog"')
    expect(morphingPopover).not.toContain('aria-modal="true"')
  })

  it("removes consumer-owned modal edge recipes", () => {
    const authModal = read("app/auth/_components/auth-modal.tsx")
    const settingsModal = read(
      "app/components/layout/settings/settings-trigger.tsx"
    )
    const searchModal = read("app/components/history/desktop-search-modal.tsx")

    expect(authModal).toContain('surface="centered"')
    expect(authModal).not.toContain("shadow-[0_18px_60px")
    expect(settingsModal).not.toContain("rounded-2xl")
    expect(searchModal).not.toContain("shadow-border-xl")
  })
})
