import { fetchQuery } from "convex/nextjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { decryptSecret } from "./encryption"
import { getProviderStrategy } from "./openproviders/provider-strategy"
import {
  getEffectiveApiKey,
  getEffectiveProviderApiKey,
  getUserKeyFromConvex,
  hasUserKey,
} from "./user-keys"

vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn() }))
// Keep isSupportedCiphertext real — the stale-row behavior under test hinges
// on the actual format check — and stub only the crypto.
vi.mock("./encryption", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./encryption")>()),
  decryptSecret: vi.fn(),
}))
vi.mock("./openproviders/provider-strategy", () => ({
  getProviderStrategy: vi.fn(),
}))

describe("provider API key resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProviderStrategy).mockReturnValue({
      envVarName: "OPENAI_API_KEY",
    } as ReturnType<typeof getProviderStrategy>)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns user BYOK provenance before a configured platform key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "platform-key")
    vi.mocked(fetchQuery).mockResolvedValue({
      encryptedKey: "v3:deadbeef:cafef00d",
      iv: "iv",
      ownerId: "user-1",
    } as never)
    vi.mocked(decryptSecret).mockReturnValue("user-key")

    await expect(
      getEffectiveProviderApiKey("openai", "convex-token")
    ).resolves.toEqual({ apiKey: "user-key", source: "byok" })
  })

  it("returns platform provenance when no usable user key exists", async () => {
    vi.stubEnv("OPENAI_API_KEY", "platform-key")
    vi.mocked(fetchQuery).mockResolvedValue(null)

    await expect(
      getEffectiveProviderApiKey("openai", "convex-token")
    ).resolves.toEqual({ apiKey: "platform-key", source: "platform" })
  })

  it("returns an empty resolution when neither source is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "")
    vi.mocked(fetchQuery).mockResolvedValue(null)

    await expect(getEffectiveProviderApiKey("openai")).resolves.toEqual({
      apiKey: undefined,
      source: undefined,
    })
  })

  it("treats a pre-v3 (stale-format) row as a clean miss, without error logs", async () => {
    vi.stubEnv("OPENAI_API_KEY", "platform-key")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(fetchQuery).mockResolvedValue({
      encryptedKey: "deadbeef:cafef00d", // unversioned pre-ADR-0010 envelope
      iv: "iv",
      ownerId: "user-1",
    } as never)

    await expect(
      getEffectiveProviderApiKey("openai", "convex-token")
    ).resolves.toEqual({ apiKey: "platform-key", source: "platform" })
    await expect(hasUserKey("openai", "convex-token")).resolves.toBe(false)

    expect(decryptSecret).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    // Warn-once dedupe: two stale reads for the same provider, one warning.
    expect(warnSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it("treats a current-format row without an IV as unusable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(fetchQuery).mockResolvedValue({
      encryptedKey: "v3:deadbeef:cafef00d",
      iv: "",
      ownerId: "user-1",
    } as never)

    await expect(hasUserKey("anthropic", "convex-token")).resolves.toBe(false)
    await expect(
      getUserKeyFromConvex("anthropic", "convex-token")
    ).resolves.toBeNull()

    expect(decryptSecret).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it("keeps the legacy key-only accessor compatible", async () => {
    vi.stubEnv("OPENAI_API_KEY", "platform-key")

    await expect(getEffectiveApiKey("openai")).resolves.toBe("platform-key")
  })
})
