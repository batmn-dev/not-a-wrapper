import { fetchQuery } from "convex/nextjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { decryptSecret } from "./encryption"
import { getProviderStrategy } from "./openproviders/provider-strategy"
import { getEffectiveApiKey, getEffectiveProviderApiKey } from "./user-keys"

vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn() }))
vi.mock("./encryption", () => ({ decryptSecret: vi.fn() }))
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
      encryptedKey: "ciphertext",
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

  it("keeps the legacy key-only accessor compatible", async () => {
    vi.stubEnv("OPENAI_API_KEY", "platform-key")

    await expect(getEffectiveApiKey("openai")).resolves.toBe("platform-key")
  })
})
