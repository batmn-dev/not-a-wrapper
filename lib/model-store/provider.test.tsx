/** @vitest-environment jsdom */

import React, { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { ModelProvider, useModel } from "./provider"

vi.mock("@/lib/convex/use-per-user-query", () => ({
  usePerUserQuery: () => ({
    data: undefined,
    isAuthReady: false,
    isLoading: true,
  }),
}))
const userState = vi.hoisted(() => ({
  user: null as { id: string; favorite_models: string[] } | null,
}))
vi.mock("@/lib/user-store/provider", () => ({
  useUser: () => ({ user: userState.user }),
}))

const GEMMA = "openrouter:google/gemma-4-26b-a4b-it:free"
const BYOK_ONLY = "gpt-5.6-sol"
const seen: Array<string | null> = []
let byokOnlyAccessible: boolean | undefined

function Probe() {
  const { lastUsedModel, models } = useModel()
  useEffect(() => {
    seen.push(lastUsedModel)
    byokOnlyAccessible = models.find((m) => m.id === BYOK_ONLY)?.accessible
  })
  return null
}

let root: Root | null = null

function mount(shellHint: { modelId: string; effort?: "high" } | null) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <ModelProvider shellHint={shellHint}>
        <Probe />
      </ModelProvider>
    )
  })
}

describe("ModelProvider shell hint seeding", () => {
  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    const values = new Map<string, string>()
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    })
  })
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    seen.length = 0
    userState.user = null
    window.localStorage.clear()
    document.cookie = "composer_shell=; Max-Age=0; Path=/"
  })

  it("adopts the seed without a flip when device memory agrees, else device memory wins and the cookie re-syncs", () => {
    window.localStorage.setItem("lastUsedModel", GEMMA)
    window.localStorage.setItem(
      "lastUsedEffortByModel",
      JSON.stringify({ [GEMMA]: "high" })
    )
    mount({ modelId: GEMMA, effort: "high" })
    // One committed value, no second commit for the hydration read.
    expect(seen).toEqual([GEMMA])
    expect(document.cookie).toBe("")

    act(() => root?.unmount())
    seen.length = 0
    window.localStorage.setItem("lastUsedModel", "gpt-5-mini")
    mount({ modelId: GEMMA, effort: "high" })
    expect(seen.at(-1)).toBe("gpt-5-mini")
    expect(decodeURIComponent(document.cookie)).toBe(
      'composer_shell={"m":"gpt-5-mini"}'
    )
  })

  it("keeps a signed-in device's key-backed last-used model presentable while key status loads", () => {
    window.localStorage.setItem("lastUsedModel", BYOK_ONLY)
    mount({ modelId: BYOK_ONLY })
    expect(byokOnlyAccessible).toBe(false)

    act(() => root?.unmount())
    userState.user = { id: "u1", favorite_models: [] }
    mount({ modelId: BYOK_ONLY })
    expect(byokOnlyAccessible).toBe(true)
  })
})
