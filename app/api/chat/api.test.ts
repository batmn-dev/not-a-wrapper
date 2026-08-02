import { fetchQuery } from "convex/nextjs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getEffectiveProviderApiKey } from "@/lib/user-keys"
import {
  checkServerSideUsage,
  validateAndResolveChatCredential,
} from "./api"
import { createErrorResponse } from "./utils"

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
}))

vi.mock("@/lib/user-keys", () => ({
  getEffectiveProviderApiKey: vi.fn(),
}))

describe("checkServerSideUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("maps missing anonymous usage IDs to INVALID_REQUEST", async () => {
    vi.mocked(fetchQuery).mockResolvedValue({
      canSend: false,
      remaining: 0,
      limit: 5,
      isAnonymous: true,
      error: "Anonymous ID required for usage tracking",
      errorCode: "ANONYMOUS_ID_REQUIRED",
    })

    const error = await checkServerSideUsage(undefined, "gpt-5-mini").then(
      () => null,
      (err) => err
    )

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message: "Anonymous ID required for usage tracking",
      statusCode: 400,
      code: "INVALID_REQUEST",
    })
  })

  it("maps missing synced users to USER_NOT_FOUND server errors", async () => {
    vi.mocked(fetchQuery).mockResolvedValue({
      canSend: false,
      remaining: 0,
      limit: 0,
      error: "User not found",
      errorCode: "USER_NOT_FOUND",
    })

    const error = await checkServerSideUsage("convex-token", "gpt-5-mini").then(
      () => null,
      (err) => err
    )

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message: "Internal server error",
      statusCode: 500,
      code: "USER_NOT_FOUND",
      cause: expect.objectContaining({
        message: "User not found",
      }),
    })
  })

  it("keeps the missing-user mapping for older string-only usage responses", async () => {
    vi.mocked(fetchQuery).mockResolvedValue({
      canSend: false,
      remaining: 0,
      limit: 0,
      error: "User not found",
    })

    await expect(
      checkServerSideUsage("convex-token", "gpt-5-mini")
    ).rejects.toMatchObject({
      message: "Internal server error",
      statusCode: 500,
      code: "USER_NOT_FOUND",
    })
  })

  it("does not expose raw backend usage errors in 500 responses", async () => {
    vi.mocked(fetchQuery).mockResolvedValue({
      canSend: false,
      remaining: 0,
      limit: 0,
      error: "Convex internal diagnostics: shard=usage-primary",
    })

    const error = await checkServerSideUsage("convex-token", "gpt-5-mini").then(
      () => null,
      (err) => err
    )

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message: "Internal server error",
      statusCode: 500,
      code: "USAGE_CHECK_FAILED",
      cause: expect.objectContaining({
        message: "Convex internal diagnostics: shard=usage-primary",
      }),
    })

    const response = createErrorResponse(error)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
      code: "USAGE_CHECK_FAILED",
    })
  })

  it("preserves the branded DAILY_LIMIT_REACHED public contract", async () => {
    vi.mocked(fetchQuery).mockResolvedValue({
      canSend: false,
      remaining: 0,
      limit: 5,
      isAnonymous: true,
    })

    const error = await checkServerSideUsage(
      undefined,
      "gpt-5-mini",
      "guest-id"
    ).then(
      () => null,
      (caught) => caught
    )
    const response = createErrorResponse(error)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "DAILY_LIMIT_REACHED",
      error: expect.stringContaining("Daily message limit reached"),
    })
  })
})

describe("validateAndResolveChatCredential", () => {
  it("enforces the essential paid, free, and guest policy table", async () => {
    const cases = [
      {
        name: "paid model with BYOK",
        model: "gpt-5.2",
        isAuthenticated: true,
        token: "convex-token",
        credential: {
          provider: "openai",
          apiKey: "byok-key",
          source: "byok",
        },
        expected: "resolve",
      },
      {
        name: "paid model with platform credential",
        model: "gpt-5.2",
        isAuthenticated: true,
        token: "convex-token",
        credential: {
          provider: "openai",
          apiKey: "platform-key",
          source: "platform",
        },
        expected: "MISSING_API_KEY",
      },
      {
        name: "free model with platform credential",
        model: "gpt-5-mini",
        isAuthenticated: true,
        token: "convex-token",
        credential: {
          provider: "openai",
          apiKey: "platform-key",
          source: "platform",
        },
        expected: "resolve",
      },
      {
        name: "allowed guest model",
        model: "gpt-5-mini",
        isAuthenticated: false,
        token: undefined,
        credential: {
          provider: "openai",
          apiKey: "platform-key",
          source: "platform",
        },
        expected: "resolve",
      },
      {
        name: "disallowed guest model",
        model: "gpt-5.2",
        isAuthenticated: false,
        token: undefined,
        credential: undefined,
        expected: "AUTH_REQUIRED",
      },
    ] as const

    for (const testCase of cases) {
      vi.mocked(getEffectiveProviderApiKey).mockReset()
      if (testCase.credential) {
        vi.mocked(getEffectiveProviderApiKey).mockResolvedValue(
          testCase.credential
        )
      }

      const result = validateAndResolveChatCredential({
        model: testCase.model,
        isAuthenticated: testCase.isAuthenticated,
        token: testCase.token,
      })

      if (testCase.expected === "resolve") {
        await expect(result, testCase.name).resolves.toEqual(
          testCase.credential
        )
      } else {
        await expect(result, testCase.name).rejects.toMatchObject({
          statusCode: 401,
          code: testCase.expected,
        })
      }

      if (testCase.expected === "AUTH_REQUIRED") {
        expect(getEffectiveProviderApiKey, testCase.name).not.toHaveBeenCalled()
      } else {
        expect(getEffectiveProviderApiKey, testCase.name).toHaveBeenCalledWith(
          "openai",
          testCase.isAuthenticated ? testCase.token : undefined
        )
      }
    }
  })
})
