import { afterEach, describe, expect, it, vi } from "vitest"
import { sharePublishedChat } from "./public-chat-share"

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

describe("sharePublishedChat", () => {
  it("publishes before native sharing and keeps dismissal terminal", async () => {
    const order: string[] = []
    setNavigator({
      share: vi.fn(async () => {
        order.push("share")
        throw Object.assign(new Error("cancelled"), { name: "AbortError" })
      }),
    })
    const openFallback = vi.fn()

    await expect(
      sharePublishedChat({
        chatId: "chat-a",
        publish: async () => {
          order.push("publish")
        },
        openFallback,
      })
    ).resolves.toBe("dismissed")

    expect(order).toEqual(["publish", "share"])
    expect(openFallback).not.toHaveBeenCalled()
  })

  it("opens the custom surface only when native sharing cannot complete", async () => {
    setNavigator({})
    const openFallback = vi.fn()

    await expect(
      sharePublishedChat({
        chatId: "chat-a",
        publish: async () => undefined,
        openFallback,
      })
    ).resolves.toBe("unsupported")

    expect(openFallback).toHaveBeenCalledOnce()
  })
})
