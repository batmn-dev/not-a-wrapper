import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8")

function getRuleBody(selector: string): string {
  const selectorStart = css.indexOf(`${selector} {`)
  expect(selectorStart, `Missing ${selector} rule`).toBeGreaterThanOrEqual(0)

  const bodyStart = css.indexOf("{", selectorStart) + 1
  let depth = 1

  for (let index = bodyStart; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1
    if (css[index] === "}") depth -= 1

    if (depth === 0) return css.slice(bodyStart, index)
  }

  throw new Error(`Unclosed ${selector} rule`)
}

const root = getRuleBody(":root")
const dark = getRuleBody(".dark")

const themedTokens = [
  "background",
  "foreground",
  "card",
  "popover",
  "text-primary",
  "text-secondary",
  "text-tertiary",
  "text-disabled",
  "link",
  "link-hover",
  "primary-bg-hover",
  "secondary-bg-hover",
  "interactive-bg-hover",
  "interactive-bg-selected",
  "interactive-bg-pressed",
  "sidebar-row-bg",
  "sidebar-border",
  "activity-panel-surface",
  "activity-panel-border",
  "activity-panel-raised-surface",
  "popover-bg-hover",
  "muted-bg-hover",
  "input-bg",
  "input-bg-hover",
  "input-border",
  "control-track-bg",
  "user-message-bg",
  "border-subtle",
  "border-default",
  "border-strong",
  "focus-ring",
  "scrim-modal",
  "scrim-sidebar",
  "status-success-bg",
  "status-success-foreground",
  "drawer-handle-bg",
] as const

const tailwindMappings = [
  "primary-bg-hover",
  "secondary-bg-hover",
  "input-bg",
  "input-bg-hover",
  "input-border",
  "popover-bg-hover",
  "muted-bg-hover",
  "control-track",
  "border-subtle",
  "border-default",
  "border-strong",
  "status-success-bg",
  "status-success-foreground",
  "link",
  "link-hover",
  "disabled-foreground",
  "interactive-hover",
  "interactive-selected",
  "interactive-pressed",
  "sidebar-row",
  "activity-panel-border",
  "user-message",
  "focus-ring",
  "scrim-modal",
  "scrim-sidebar",
] as const

describe("color token contract", () => {
  it.each(themedTokens)("defines --%s in both themes", (token) => {
    expect(root).toContain(`--${token}:`)
    expect(dark).toContain(`--${token}:`)
  })

  it.each(tailwindMappings)(
    "maps --color-%s for Tailwind consumers",
    (token) => {
      expect(css).toContain(`--color-${token}:`)
    }
  )

  it("keeps compatibility aliases connected to the semantic roles", () => {
    expect(root).toContain("--border: var(--border-subtle);")
    expect(root).toContain("--input: var(--input-border);")
    expect(root).toContain("--ring: var(--focus-ring);")
    expect(root).toContain("--accent: var(--interactive-bg-selected);")
    expect(dark).toContain("--border: var(--border-subtle);")
    expect(dark).toContain("--input: var(--input-border);")
    expect(dark).toContain("--ring: var(--focus-ring);")
    expect(dark).toContain("--accent: var(--interactive-bg-selected);")
  })

  it("keeps the dark link hover color accessible on raised surfaces", () => {
    expect(dark).toContain("--link-hover: var(--link);")
  })

  it("keeps the sidebar divider aligned to each theme's optical edge", () => {
    expect(root).toContain("--sidebar-border: var(--border-subtle);")
    expect(dark).toContain("--sidebar-border: oklch(1 0 0 / 0.1);")
  })

  it("keeps the dark activity panel on the canvas with an opaque optical edge", () => {
    expect(dark).toContain("--activity-panel-surface: var(--background);")
    expect(dark).toContain("--activity-panel-border: oklch(0.248 0 0);")
    expect(dark).toContain("--activity-panel-raised-surface: var(--card);")
  })

  it("exposes disabled text only through the semantic utility name", () => {
    expect(css).toContain("--color-disabled-foreground: var(--text-disabled);")
    expect(css).not.toContain("--color-text-disabled:")
  })
})
