import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * The collapsed rail and the expanded panel are separate layers that crossfade;
 * their leading icons only stay put because both derive placement from the same
 * geometry tokens. These tests pin that derivation so an axis-coupled "inner"
 * padding token (the original 1px drift) cannot come back unnoticed.
 */

const css = readFileSync(
  new URL("../../../globals.css", import.meta.url),
  "utf8"
)

// First declaration wins: theme blocks later in the file only override colors.
const declarations = new Map<string, string>()
for (const match of css
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
  const [, name, value] = match
  if (!declarations.has(name)) declarations.set(name, value.trim())
}

function evaluate(expression: string): number {
  const normalized = expression
    .replaceAll("calc(", "(")
    .replace(/(-?\d*\.?\d+)rem/g, (_, n: string) => String(Number(n) * 16))
    .replace(/(-?\d*\.?\d+)px/g, "$1")
  if (!/^[\d\s+\-*/().]+$/.test(normalized)) {
    throw new Error(`Unresolvable token expression: ${expression}`)
  }
  return Function(`"use strict"; return (${normalized})`)() as number
}

function resolvePx(name: string, seen: readonly string[] = []): number {
  if (seen.includes(name)) {
    throw new Error(`Token cycle: ${[...seen, name].join(" -> ")}`)
  }
  const raw = declarations.get(name)
  if (raw === undefined) throw new Error(`Missing token: ${name}`)
  const substituted = raw.replace(
    /var\((--[\w-]+)\)/g,
    (_, ref: string) => `${resolvePx(ref, [...seen, name])}px`
  )
  return evaluate(substituted)
}

describe("sidebar leading-icon placement contract", () => {
  it("gives both sidebar layers the same icon center", () => {
    const railCenter = resolvePx("--sidebar-rail-width") / 2
    const expandedIconCenter =
      resolvePx("--sidebar-row-outer-inset") +
      resolvePx("--sidebar-row-content-inline") +
      resolvePx("--sidebar-leading-slot-size") / 2
    expect(expandedIconCenter).toBe(railCenter)
  })

  it("keeps the ChatGPT-parity absolute values", () => {
    expect(resolvePx("--sidebar-leading-slot-size")).toBe(20)
    expect(resolvePx("--sidebar-collapsed-item-width")).toBe(40)
    expect(resolvePx("--sidebar-rail-width")).toBe(52)
    expect(resolvePx("--sidebar-width")).toBe(260)
  })

  it("keeps the collapsed frame width equal to the rail width", () => {
    // The ui/sidebar frame animates to --sidebar-width-icon while the app
    // renders its collapsed rail at --sidebar-rail-width inside it. Widths are
    // CSS-owned (no TS constants), so this equality is the whole contract.
    expect(resolvePx("--sidebar-width-icon")).toBe(
      resolvePx("--sidebar-rail-width")
    )
  })

  it("gives both organizer modes one section-stack rhythm", () => {
    // Cluster -> first section, and section -> section. Both "In one list" and
    // "By project" flow through the single stack container in app-sidebar.tsx;
    // these pins keep the rhythm from being re-derived per mode.
    expect(resolvePx("--sidebar-section-stack-margin-top")).toBe(20)
    expect(resolvePx("--sidebar-section-stack-gap")).toBe(16)
  })

  it("compensates the row border on the block axis only", () => {
    expect(
      resolvePx("--sidebar-row-inner-content-block") +
        resolvePx("--sidebar-row-separator-size")
    ).toBe(resolvePx("--sidebar-row-content-block"))
    // The row draws border-block only, so inline padding must be the shared
    // token — an "inner" inline variant would re-introduce the 1px icon drift.
    expect(declarations.has("--sidebar-row-inner-content-inline")).toBe(false)
  })

  it("matches ChatGPT's trailing-action reflow geometry", () => {
    const actionContribution =
      resolvePx("--sidebar-row-action-width") -
      resolvePx("--sidebar-row-action-margin-inline-start") -
      resolvePx("--sidebar-row-action-margin-inline-end")
    const trailingCenterInset =
      resolvePx("--sidebar-row-action-width") / 2 -
      resolvePx("--sidebar-row-action-margin-inline-end")
    const twoActionRail =
      2 * actionContribution + resolvePx("--sidebar-row-action-gap")

    expect(resolvePx("--sidebar-row-action-width")).toBe(34)
    expect(resolvePx("--sidebar-row-action-gap")).toBe(4)
    expect(resolvePx("--sidebar-row-action-content-gap")).toBe(8)
    expect(actionContribution).toBe(20)
    expect(trailingCenterInset).toBe(7)
    expect(twoActionRail).toBe(44)
    expect(resolvePx("--sidebar-row-action-rail-width")).toBe(twoActionRail)
    expect(css).toContain(
      '.sidebar-row-status-slot[data-sidebar-row-status-slot="compact"]'
    )
  })
})
