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

  it("keeps the collapsed frame width equal to the rail width", () => {
    // The ui/sidebar frame animates to --sidebar-width-icon while the app
    // renders its collapsed rail at --sidebar-rail-width inside it. Widths are
    // CSS-owned (no TS constants), so this equality is the whole contract.
    expect(resolvePx("--sidebar-width-icon")).toBe(
      resolvePx("--sidebar-rail-width")
    )
  })
})
