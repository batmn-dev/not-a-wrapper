import { describe, expect, it } from "vitest"
import { normalizeChatError } from "./public-error"

describe("normalizeChatError", () => {
  it("uses the resolved provider instead of guessing from error text or stack", () => {
    const error = new Error("402 payment required while google metadata exists")
    error.stack = `${error.stack}\n    at googleTransport (server.js:1:1)`

    expect(
      normalizeChatError(error, {
        provider: "openai",
        credentialSource: "byok",
      })
    ).toEqual({
      code: "PAYMENT_REQUIRED",
      message:
        "Your OpenAI API account has insufficient credits or requires payment. Check OpenAI billing or update your API key in settings.",
      retryable: false,
      provider: "openai",
      credentialSource: "byok",
    })
  })

  it("finds structured payment status inside an AI SDK retry error chain", () => {
    const lastError = {
      statusCode: 402,
      responseBody: JSON.stringify({
        error: { message: "Account billing is required" },
      }),
    }
    const retryError = Object.assign(new Error("Failed after 3 attempts"), {
      lastError,
      errors: [lastError],
    })

    expect(
      normalizeChatError(retryError, {
        provider: "openai",
        credentialSource: "platform",
      })
    ).toMatchObject({
      code: "PAYMENT_REQUIRED",
      message:
        "OpenAI is temporarily unavailable because the app's provider account requires payment. Try again later or add your own OpenAI API key in settings.",
      retryable: false,
      provider: "openai",
      credentialSource: "platform",
    })
  })

  it("attributes wrapped-model billing to OpenRouter, not the upstream vendor", () => {
    expect(
      normalizeChatError(new Error("Google upstream credits exhausted"), {
        provider: "openrouter",
        credentialSource: "byok",
      })
    ).toMatchObject({
      code: "PAYMENT_REQUIRED",
      message: expect.stringContaining("Your OpenRouter API account"),
      retryable: false,
      provider: "openrouter",
    })
  })

  it("marks rate limits retryable and preserves authoritative attribution", () => {
    expect(
      normalizeChatError(
        { statusCode: 429, message: "Too many requests" },
        { provider: "anthropic", credentialSource: "byok" }
      )
    ).toEqual({
      code: "RATE_LIMIT_EXCEEDED",
      message: "Anthropic rate limit exceeded. Please try again later.",
      retryable: true,
      provider: "anthropic",
      credentialSource: "byok",
    })
  })

  it("omits provider attribution when the runtime has not resolved one", () => {
    expect(normalizeChatError(new Error("402 payment required"))).toEqual({
      code: "PAYMENT_REQUIRED",
      message: "Insufficient credits or payment required.",
      retryable: false,
    })
  })
})
