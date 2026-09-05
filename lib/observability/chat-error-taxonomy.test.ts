import { describe, expect, it } from "vitest"
import { classifyChatError } from "./chat-error-taxonomy"

describe("classifyChatError", () => {
  it("classifies auth errors from nested AI SDK payloads", () => {
    const wrapped = {
      message: "AI request failed",
      error: {
        statusCode: 401,
        message: "Invalid API key",
      },
    }

    expect(classifyChatError(wrapped)).toBe("auth")
  })

  it("classifies rate limits from nested error.error payloads", () => {
    const wrapped = {
      name: "APICallError",
      error: {
        statusCode: 429,
        message: "Rate limit exceeded",
      },
    }

    expect(classifyChatError(wrapped)).toBe("rate_limit")
  })

  it("classifies provider failures from nested cause payloads", () => {
    const wrapped = {
      message: "Streaming failed",
      cause: {
        statusCode: 503,
        message: "OpenAI upstream unavailable",
      },
    }

    expect(classifyChatError(wrapped)).toBe("provider_api")
  })

  it("keeps sanitized provider payment messages out of auth telemetry", () => {
    expect(
      classifyChatError(
        new Error(
          "Your OpenRouter API account has insufficient credits or requires payment. Check OpenRouter billing or update your API key in settings."
        )
      )
    ).toBe("provider_api")
  })

  it("keeps authoritative auth status ahead of payment-like copy", () => {
    expect(
      classifyChatError({
        statusCode: 401,
        message: "Authentication failed; check billing and update your API key.",
      })
    ).toBe("auth")
  })

  it("keeps authoritative rate-limit status ahead of payment-like copy", () => {
    expect(
      classifyChatError({
        statusCode: 429,
        message: "Rate limit reached due to insufficient credits.",
      })
    ).toBe("rate_limit")
  })

  it.each([
    ["lastError", { lastError: { statusCode: 429 } }, "rate_limit"],
    ["errors", { errors: [{ statusCode: 429 }] }, "rate_limit"],
    ["payment", { lastError: { statusCode: 402 } }, "provider_api"],
  ])(
    "classifies telemetry from AI SDK retry %s",
    (_shape, wrapped, expected) => {
      expect(classifyChatError(wrapped)).toBe(expected)
    }
  )

  it("handles cyclic error causes", () => {
    const error: { cause?: unknown; message: string } = {
      message: "MCP tool timed out",
    }
    error.cause = error

    expect(classifyChatError(error)).toBe("tool_timeout")
  })

  it("bounds nested error traversal", () => {
    let error: unknown = { statusCode: 401 }
    for (let depth = 0; depth < 5; depth += 1) {
      error = { cause: error }
    }

    expect(classifyChatError(error)).toBe("unknown")
  })
})
