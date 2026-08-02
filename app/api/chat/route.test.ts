import { getWorkosSession } from "@/lib/auth/workos"
import { getToolDimensionForError } from "@/lib/observability/chat-error-taxonomy"
import * as Sentry from "@sentry/nextjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  checkServerSideUsage,
  incrementServerSideUsage,
  validateAndResolveChatCredential,
} from "./api"
import { createChatTurnRuntime } from "./chat-turn-runtime"
import { PublicChatHttpError } from "./public-http-error"
import { maxDuration, POST } from "./route"

vi.mock("@sentry/nextjs", () => ({
  setTag: vi.fn(),
  setContext: vi.fn(),
  setConversationId: undefined,
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
}))

vi.mock("@/lib/models/model-id-migration", () => ({
  resolveModelId: vi.fn((model: string) => model),
}))

vi.mock("@/lib/auth/workos", () => ({
  getWorkosSession: vi.fn(),
}))

vi.mock("@/lib/observability/chat-error-taxonomy", async (importActual) => {
  const actual =
    await importActual<
      typeof import("@/lib/observability/chat-error-taxonomy")
    >()
  return {
    ...actual,
    classifyChatError: vi.fn(() => "unknown"),
  }
})

vi.mock("./api", () => ({
  checkServerSideUsage: vi.fn(),
  incrementServerSideUsage: vi.fn(),
  validateAndResolveChatCredential: vi.fn(),
}))

vi.mock("./chat-turn-runtime", () => ({
  createChatTurnRuntime: vi.fn(),
}))

const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

function makeRequest(): Request {
  return new Request("http://test.local/api/chat", {
    method: "POST",
    body: JSON.stringify({
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
      ],
      chatId: "chat-1",
      model: "test-model",
    }),
  })
}

describe("/api/chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getWorkosSession).mockResolvedValue({
      user: { id: "user-1" },
      accessToken: "convex-token",
    } as Awaited<ReturnType<typeof getWorkosSession>>)
    vi.mocked(validateAndResolveChatCredential).mockResolvedValue({
      provider: "openai",
      apiKey: "test-key",
      source: "byok",
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockClear()
    consoleWarnSpy.mockClear()
  })

  it("keeps the literal maxDuration in agreement with the execution budget", async () => {
    // Next.js statically analyzes segment config, so route.ts cannot import
    // the budget module's value — this pin is the agreement.
    const { CHAT_ROUTE_MAX_DURATION_SECONDS } =
      await import("@/lib/chat-turn/execution-budget")
    expect(maxDuration).toBe(CHAT_ROUTE_MAX_DURATION_SECONDS)
  })

  it("preserves check-resolve-increment ordering and passes one credential snapshot to the runtime", async () => {
    const order: string[] = []
    const credential = {
      provider: "openai",
      apiKey: "credential-snapshot",
      source: "byok",
    } as const
    vi.mocked(checkServerSideUsage).mockImplementation(async () => {
      order.push("check")
    })
    vi.mocked(validateAndResolveChatCredential).mockImplementation(async () => {
      order.push("resolve")
      return credential
    })
    vi.mocked(incrementServerSideUsage).mockImplementation(async () => {
      order.push("increment")
    })
    const prepare = vi.fn(async () => {
      order.push("prepare")
    })
    const toResponse = vi.fn(async () => {
      order.push("response")
      return new Response("ok")
    })
    vi.mocked(createChatTurnRuntime).mockImplementation((args) => {
      order.push("runtime")
      expect(args.input.credential).toBe(credential)
      return { prepare, toResponse, fail: vi.fn() }
    })

    const response = await POST(makeRequest())

    expect(await response.text()).toBe("ok")
    expect(order).toEqual([
      "check",
      "resolve",
      "increment",
      "runtime",
      "prepare",
      "response",
    ])
    expect(validateAndResolveChatCredential).toHaveBeenCalledWith({
      model: "test-model",
      isAuthenticated: true,
      token: "convex-token",
    })
  })

  it("returns the original fallback response when turn.fail throws", async () => {
    const originalError = new PublicChatHttpError({
      message: "Public request failure",
      code: "INVALID_REQUEST",
      statusCode: 502,
    })
    const failError = new Error("cleanup failed")
    const fail = vi.fn(async () => {
      throw failError
    })
    vi.mocked(createChatTurnRuntime).mockReturnValue({
      prepare: vi.fn(async () => {
        throw originalError
      }),
      toResponse: vi.fn(),
      fail,
    })

    const response = await POST(makeRequest())

    await expect(response.json()).resolves.toEqual({
      error: "Public request failure",
      code: "INVALID_REQUEST",
    })
    expect(response.status).toBe(502)
    expect(fail).toHaveBeenCalledWith(originalError)
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"_tag":"chat_turn_fail_failed"')
    )
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"errorMessage":"cleanup failed"')
    )
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Error", message: "cleanup failed" }),
      {
        tags: {
          route: "api/chat",
          chat_model: "test-model",
          chat_is_authenticated: "true",
          chat_error_type: "unknown",
          chat_error_has_tool_signal: getToolDimensionForError("unknown"),
          chat_failure_stage: "turn_fail",
        },
        extra: {
          requestId: expect.any(String),
          model: "test-model",
          errorType: "unknown",
          isAuthenticated: true,
          messageCount: 1,
          originalErrorName: "PublicChatHttpError",
        },
      }
    )
  })

  it("redacts an unbranded statusCode error at the route boundary", async () => {
    const unsafe = Object.assign(new Error("ENCRYPTED_CONTENT_HTTP_SENTINEL"), {
      statusCode: 400,
      code: "PROVIDER_ERROR",
    })
    vi.mocked(createChatTurnRuntime).mockReturnValue({
      prepare: vi.fn(async () => {
        throw unsafe
      }),
      toResponse: vi.fn(),
      fail: vi.fn(),
    })

    const response = await POST(makeRequest())
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body).not.toContain("ENCRYPTED_CONTENT_HTTP_SENTINEL")
    expect(body).toContain("INTERNAL_ERROR")
  })

  it("returns 400 for malformed JSON without capturing to Sentry", async () => {
    const response = await POST(
      new Request("http://test.local/api/chat", {
        method: "POST",
        body: "{",
      })
    )

    await expect(response.json()).resolves.toEqual({
      error: "Request body is not valid JSON",
      code: "INVALID_REQUEST",
    })
    expect(response.status).toBe(400)
    expect(createChatTurnRuntime).not.toHaveBeenCalled()
    expect(Sentry.captureException).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})
