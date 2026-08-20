import type { UIMessage } from "ai"
import { fetchQuery } from "convex/nextjs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  resolveModelRoute,
  type RouteResolutionFailure,
} from "@/lib/model-route-resolver"
import {
  checkServerSideUsage,
  validateAndResolveChatCredential,
} from "./api"
import { createErrorResponse } from "./utils"

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
}))

vi.mock("@/lib/model-route-resolver", () => ({
  resolveModelRoute: vi.fn(),
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

    const error = await checkServerSideUsage(undefined).then(
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

    const error = await checkServerSideUsage("convex-token").then(
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
      checkServerSideUsage("convex-token")
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

    const error = await checkServerSideUsage("convex-token").then(
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

    const error = await checkServerSideUsage(undefined, "guest-id").then(
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
  // A local chat id keeps the platform-funding context absent (ADR-0021):
  // funding requires a durable chat; these tests exercise the pre-existing
  // admission contract unchanged.
  const admissionBase = {
    requestId: "req-1",
    chatId: "local-chat-1",
    enableSearch: false,
  }
  const textMessages = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    },
  ] as UIMessage[]

  const resolvedRoute = {
    modelId: "claude-sonnet-5",
    routeId: "openrouter:anthropic/claude-sonnet-5",
    providerId: "openrouter",
    upstreamModelId: "anthropic/claude-sonnet-5",
    credentialSource: "byok",
    routeReason: "priority_byok",
  } as const

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the route receipt plus the credential snapshot it implies", async () => {
    vi.mocked(resolveModelRoute).mockResolvedValue({
      ok: true,
      route: resolvedRoute,
      apiKey: "sk-or-byok",
    })

    await expect(
      validateAndResolveChatCredential({
        ...admissionBase,
        model: "openrouter:anthropic/claude-sonnet-5",
        isAuthenticated: true,
        token: "convex-token",
        messages: textMessages,
      })
    ).resolves.toEqual({
      route: resolvedRoute,
      credential: {
        provider: "openrouter",
        apiKey: "sk-or-byok",
        source: "byok",
      },
    })

    expect(resolveModelRoute).toHaveBeenCalledWith({
      modelId: "openrouter:anthropic/claude-sonnet-5",
      isAuthenticated: true,
      token: "convex-token",
      requiredCapabilities: undefined,
      pinnedProviderId: undefined,
    })
  })

  it("maps resolver failures to the public admission contract", async () => {
    const cases: Array<{
      failure: RouteResolutionFailure
      expected: Record<string, unknown>
    }> = [
      {
        failure: {
          ok: false,
          reason: "auth_required",
          modelId: "claude-sonnet-5",
          keyProviders: [],
        },
        expected: { statusCode: 401, code: "AUTH_REQUIRED" },
      },
      {
        failure: {
          ok: false,
          reason: "model_not_found",
          modelId: "missing-model",
          keyProviders: [],
        },
        expected: { statusCode: 400, code: "INVALID_REQUEST" },
      },
      {
        failure: {
          ok: false,
          reason: "no_eligible_route",
          modelId: "claude-sonnet-5",
          keyProviders: ["anthropic", "openrouter"],
        },
        expected: {
          statusCode: 401,
          code: "MISSING_API_KEY",
          message: expect.stringContaining("Anthropic or OpenRouter"),
        },
      },
      {
        // Capability mismatch: no candidate route at all.
        failure: {
          ok: false,
          reason: "no_eligible_route",
          modelId: "claude-sonnet-5",
          keyProviders: [],
        },
        expected: { statusCode: 400, code: "INVALID_REQUEST" },
      },
    ]

    for (const testCase of cases) {
      vi.mocked(resolveModelRoute).mockResolvedValue(testCase.failure)

      const error = await validateAndResolveChatCredential({
        ...admissionBase,
        model: "claude-sonnet-5",
        isAuthenticated: true,
        token: "convex-token",
        messages: textMessages,
      }).then(
        () => null,
        (caught) => caught
      )

      expect(error).toMatchObject(testCase.expected)
      // Secrets never ride admission errors.
      expect(JSON.stringify(error)).not.toContain("sk-")
    }
  })

  it("maps insufficient allowance to the ALLOWANCE_EXHAUSTED contract", async () => {
    vi.mocked(resolveModelRoute).mockResolvedValue({
      ok: false,
      reason: "insufficient_allowance",
      modelId: "gpt-5-mini",
      keyProviders: ["openai"],
    })

    const error = await validateAndResolveChatCredential({
      ...admissionBase,
      model: "gpt-5-mini",
      isAuthenticated: true,
      token: "convex-token",
      messages: textMessages,
    }).then(
      () => null,
      (caught) => caught
    )

    expect(error).toMatchObject({
      statusCode: 403,
      code: "ALLOWANCE_EXHAUSTED",
      message: expect.stringContaining("included platform allowance"),
    })
    expect((error as Error).message).toContain("OpenAI")
  })

  it("passes the platform-funding context only for durable chats", async () => {
    vi.mocked(resolveModelRoute).mockResolvedValue({
      ok: true,
      route: { ...resolvedRoute, credentialSource: "platform" },
      apiKey: "platform-key",
      reservationId: "res-1" as never,
    })

    const admitted = await validateAndResolveChatCredential({
      model: "gpt-5-mini",
      isAuthenticated: true,
      workosUserId: "workos-user-1",
      token: "convex-token",
      messages: textMessages,
      requestId: "req-42",
      chatId: "j57abc123", // server chat id (no local-/optimistic prefix)
      systemPrompt: "be brief",
      enableSearch: true,
    })

    expect(resolveModelRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        platformFunding: {
          workosUserId: "workos-user-1",
          requestId: "req-42",
          chatId: "j57abc123",
          messages: textMessages,
          systemPrompt: "be brief",
          toolsLikely: true,
        },
      })
    )
    expect(admitted.reservationId).toBe("res-1")
  })

  it("requires vision routes when the turn carries image attachments", async () => {
    vi.mocked(resolveModelRoute).mockResolvedValue({
      ok: true,
      route: resolvedRoute,
      apiKey: "sk-or-byok",
    })

    await validateAndResolveChatCredential({
      ...admissionBase,
      model: "claude-sonnet-5",
      isAuthenticated: true,
      token: "convex-token",
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [
            { type: "text", text: "what is this?" },
            {
              type: "file",
              mediaType: "image/png",
              url: "convex://file-1",
            },
          ],
        },
      ] as UIMessage[],
    })

    expect(resolveModelRoute).toHaveBeenCalledWith(
      expect.objectContaining({ requiredCapabilities: { vision: true } })
    )
  })

  it("does not require vision for images from an earlier turn", async () => {
    vi.mocked(resolveModelRoute).mockResolvedValue({
      ok: true,
      route: resolvedRoute,
      apiKey: "sk-or-byok",
    })

    await validateAndResolveChatCredential({
      ...admissionBase,
      model: "sonar",
      isAuthenticated: true,
      token: "convex-token",
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [
            { type: "text", text: "what is this?" },
            {
              type: "file",
              mediaType: "image/png",
              url: "convex://file-1",
            },
          ],
        },
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "text", text: "It is a diagram." }],
        },
        {
          id: "u2",
          role: "user",
          parts: [{ type: "text", text: "Search for related work." }],
        },
      ] as UIMessage[],
    })

    expect(resolveModelRoute).toHaveBeenCalledWith(
      expect.objectContaining({ requiredCapabilities: undefined })
    )
  })

  it("pins an approval continuation to the paused run's provider", async () => {
    vi.mocked(fetchQuery).mockResolvedValue({
      provider: "anthropic",
      routeId: "claude-sonnet-5",
      model: "claude-sonnet-5",
    })
    vi.mocked(resolveModelRoute).mockResolvedValue({
      ok: true,
      route: { ...resolvedRoute, providerId: "anthropic" },
      apiKey: "sk-ant-byok",
    })

    await validateAndResolveChatCredential({
      ...admissionBase,
      model: "claude-sonnet-5",
      isAuthenticated: true,
      token: "convex-token",
      messages: [
        ...textMessages,
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "search",
              toolCallId: "call-1",
              state: "approval-responded",
              approval: { id: "appr-1", approved: true },
            },
          ],
        },
      ] as unknown as UIMessage[],
    })

    expect(fetchQuery).toHaveBeenCalledWith(
      expect.anything(),
      { approvalId: "appr-1" },
      { token: "convex-token" }
    )
    expect(resolveModelRoute).toHaveBeenCalledWith(
      expect.objectContaining({ pinnedProviderId: "anthropic" })
    )
  })

  it("continues without a provider pin when the approval lookup fails", async () => {
    const lookupError = new Error("Convex transport failed")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.mocked(fetchQuery).mockRejectedValue(lookupError)
    vi.mocked(resolveModelRoute).mockResolvedValue({
      ok: true,
      route: resolvedRoute,
      apiKey: "sk-or-byok",
    })

    await expect(
      validateAndResolveChatCredential({
        ...admissionBase,
        model: "claude-sonnet-5",
        isAuthenticated: true,
        token: "convex-token",
        messages: [
          ...textMessages,
          {
            id: "a1",
            role: "assistant",
            parts: [
              {
                type: "dynamic-tool",
                toolName: "search",
                toolCallId: "call-1",
                state: "approval-responded",
                approval: { id: "appr-1", approved: true },
              },
            ],
          },
        ] as unknown as UIMessage[],
      })
    ).resolves.toEqual({
      route: resolvedRoute,
      credential: {
        provider: "openrouter",
        apiKey: "sk-or-byok",
        source: "byok",
      },
    })

    expect(resolveModelRoute).toHaveBeenCalledWith(
      expect.objectContaining({ pinnedProviderId: undefined })
    )
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({
        _tag: "approval_route_facts_lookup_failed",
        errorType: "Error",
      })
    )
    warn.mockRestore()
  })
})
