import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "@/components/ui/toast"
import { clearAllIndexedDBStores } from "@/lib/chat-store/persist"
import {
  isNextRedirectError,
  signOutAndClearLocalState,
} from "./sign-out"

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
}))

vi.mock("@/lib/chat-store/persist", () => ({
  clearAllIndexedDBStores: vi.fn(),
}))

const mockClearAllIndexedDBStores = clearAllIndexedDBStores as ReturnType<
  typeof vi.fn
>

function createOptions() {
  return {
    resetChats: vi.fn().mockResolvedValue(undefined),
    resetMessages: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
  }
}

describe("signOutAndClearLocalState", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClearAllIndexedDBStores.mockResolvedValue(undefined)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("does not show a failure toast for Next redirect completion", async () => {
    const options = createOptions()
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;push;/;303;",
    })
    options.signOut.mockRejectedValueOnce(redirectError)

    await signOutAndClearLocalState(options)

    expect(options.resetMessages).toHaveBeenCalledOnce()
    expect(options.resetChats).toHaveBeenCalledOnce()
    expect(clearAllIndexedDBStores).toHaveBeenCalledOnce()
    expect(options.signOut).toHaveBeenCalledWith({ returnTo: "/" })
    expect(toast).not.toHaveBeenCalled()
  })

  it("shows a failure toast when sign-out fails without redirecting", async () => {
    const options = createOptions()
    options.signOut.mockRejectedValueOnce(new Error("network failed"))

    await signOutAndClearLocalState(options)

    expect(toast).toHaveBeenCalledWith({
      title: "Failed to sign out",
      status: "error",
    })
  })

  it("continues sign-out when local cleanup fails", async () => {
    const options = createOptions()
    options.resetMessages.mockRejectedValueOnce(new Error("cleanup failed"))

    await signOutAndClearLocalState(options)

    expect(options.resetChats).toHaveBeenCalledOnce()
    expect(clearAllIndexedDBStores).toHaveBeenCalledOnce()
    expect(options.signOut).toHaveBeenCalledWith({ returnTo: "/" })
    expect(toast).not.toHaveBeenCalled()
  })
})

describe("isNextRedirectError", () => {
  it("matches Next redirect error digests", () => {
    expect(
      isNextRedirectError({
        digest: "NEXT_REDIRECT;replace;/signed-out;303;",
      })
    ).toBe(true)
  })

  it("rejects non-redirect errors", () => {
    expect(isNextRedirectError(new Error("network failed"))).toBe(false)
  })
})
