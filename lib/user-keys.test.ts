import { fetchQuery } from "convex/nextjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { decryptSecret } from "./encryption"
import { getProviderStrategy } from "./openproviders/provider-strategy"
import {
  getEffectiveProviderApiKey,
  getUserKeyFromConvex,
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
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("resolves one provider-bound credential with essential outcomes and exact read counts", async () => {
    vi.stubEnv("OPENAI_API_KEY", "platform-key")
    vi.spyOn(console, "error").mockImplementation(() => {})
    const currentRow = {
      encryptedKey: "v3:deadbeef:cafef00d",
      iv: "iv",
      ownerId: "user-1",
    }
    const cases = [
      {
        name: "valid BYOK",
        token: "convex-token",
        row: currentRow,
        decrypted: "user-key",
        expected: {
          provider: "openai",
          apiKey: "user-key",
          source: "byok",
        },
        reads: 1,
        decryptions: 1,
      },
      {
        name: "absent BYOK with platform fallback",
        token: "convex-token",
        row: null,
        expected: {
          provider: "openai",
          apiKey: "platform-key",
          source: "platform",
        },
        reads: 1,
        decryptions: 0,
      },
      {
        name: "decryption failure with platform fallback",
        token: "convex-token",
        row: currentRow,
        decryptError: new Error("decrypt failed"),
        expected: {
          provider: "openai",
          apiKey: "platform-key",
          source: "platform",
        },
        reads: 1,
        decryptions: 1,
      },
      {
        name: "tokenless guest with platform fallback",
        token: undefined,
        row: null,
        expected: {
          provider: "openai",
          apiKey: "platform-key",
          source: "platform",
        },
        reads: 0,
        decryptions: 0,
      },
    ] as const

    for (const testCase of cases) {
      vi.mocked(fetchQuery).mockReset()
      vi.mocked(decryptSecret).mockReset()
      vi.mocked(fetchQuery).mockResolvedValue(testCase.row as never)
      if ("decryptError" in testCase) {
        vi.mocked(decryptSecret).mockImplementation(() => {
          throw testCase.decryptError
        })
      } else if ("decrypted" in testCase) {
        vi.mocked(decryptSecret).mockReturnValue(testCase.decrypted)
      }

      const resolution = await getEffectiveProviderApiKey(
        "openai",
        testCase.token
      )

      expect(resolution, testCase.name).toEqual(testCase.expected)
      expect(fetchQuery, testCase.name).toHaveBeenCalledTimes(testCase.reads)
      expect(decryptSecret, testCase.name).toHaveBeenCalledTimes(
        testCase.decryptions
      )
    }
  })

  it("returns an empty resolution when neither source is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "")
    vi.mocked(fetchQuery).mockResolvedValue(null)

    await expect(getEffectiveProviderApiKey("openai")).resolves.toEqual({
      provider: "openai",
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
    ).resolves.toEqual({
      provider: "openai",
      apiKey: "platform-key",
      source: "platform",
    })
    await expect(
      getUserKeyFromConvex("openai", "convex-token")
    ).resolves.toBeNull()

    expect(decryptSecret).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    // Warn-once dedupe: two stale reads for the same provider, one warning.
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it("treats a current-format row without an IV as unusable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(fetchQuery).mockResolvedValue({
      encryptedKey: "v3:deadbeef:cafef00d",
      iv: "",
      ownerId: "user-1",
    } as never)

    await expect(
      getUserKeyFromConvex("anthropic", "convex-token")
    ).resolves.toBeNull()

    expect(decryptSecret).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
