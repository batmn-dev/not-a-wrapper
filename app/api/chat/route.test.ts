import { getWorkosSession } from "@/lib/auth/workos"
import { getToolDimensionForError } from "@/lib/observability/chat-error-taxonomy"
import * as Sentry from "@sentry/nextjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createChatTurnRuntime } from "./chat-turn-runtime"
import { POST } from "./route"

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
  validateAndTrackUsage: vi.fn(),
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
  })

  afterEach(() => {
    consoleErrorSpy.mockClear()
    consoleWarnSpy.mockClear()
  })

  it("returns the original fallback response when turn.fail throws", async () => {
    const originalError = Object.assign(new Error("provider failed"), {
      code: "PROVIDER_FAILED",
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
      error: "provider failed",
      code: "PROVIDER_FAILED",
    })
    expect(response.status).toBe(502)
    expect(fail).toHaveBeenCalledWith(originalError)
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"_tag":"chat_turn_fail_failed"')
    )
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"error":"cleanup failed"')
    )
    expect(Sentry.captureException).toHaveBeenCalledWith(failError, {
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
        chatId: "chat-1",
        model: "test-model",
        errorType: "unknown",
        isAuthenticated: true,
        messageCount: 1,
        originalError: "provider failed",
      },
    })
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
