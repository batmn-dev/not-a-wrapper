import { afterEach, describe, expect, it, vi } from "vitest"
import { shareTarget } from "./share-target"

const originalNavigator = globalThis.navigator

function setNavigator(value: object) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  })
  vi.restoreAllMocks()
})

describe("shareTarget", () => {
  const target = { title: "Shared conversation", url: "https://example.com" }

  it("uses the browser share sheet when the target is supported", async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const canShare = vi.fn(() => true)
    setNavigator({ canShare, share })

    await expect(shareTarget(target)).resolves.toBe("shared")
    expect(canShare).toHaveBeenCalledWith(target)
    expect(share).toHaveBeenCalledWith(target)
  })

  it("distinguishes unsupported targets, dismissal, and operational failure", async () => {
    setNavigator({ canShare: () => false, share: vi.fn() })
    await expect(shareTarget(target)).resolves.toBe("unsupported")

    setNavigator({
      share: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("cancelled"), { name: "AbortError" })
        ),
    })
    await expect(shareTarget(target)).resolves.toBe("dismissed")

    setNavigator({ share: vi.fn().mockRejectedValue(new Error("failed")) })
    await expect(shareTarget(target)).resolves.toBe("failed")
  })
})
