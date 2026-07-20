import { afterEach, describe, expect, it, vi } from "vitest"

describe("feature rollout boundaries", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("keeps durable presentation off by default without changing the independent sidebar rollout", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DURABLE_RUN_PRESENTATION", "")
    vi.stubEnv("NEXT_PUBLIC_ENABLE_PAGINATED_SIDEBAR", "")
    const flags = await import("./flags")

    expect(flags.ENABLE_DURABLE_RUN_PRESENTATION).toBe(false)
    expect(flags.ENABLE_PAGINATED_SIDEBAR).toBe(true)
  })

  it("enables durable presentation only through the explicit true value", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DURABLE_RUN_PRESENTATION", "true")
    const flags = await import("./flags")
    expect(flags.ENABLE_DURABLE_RUN_PRESENTATION).toBe(true)
  })
})
