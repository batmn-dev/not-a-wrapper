import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  hashBraintrustIdentifier,
  isBraintrustEnabled,
  maskBraintrustPayload,
  sanitizeBraintrustMetadata,
} from "./braintrust"

vi.mock("server-only", () => ({}))

describe("Braintrust observability helpers", () => {
  beforeEach(() => {
    delete process.env.BRAINTRUST_API_KEY
    delete process.env.BRAINTRUST_ENABLED
    delete process.env.BRAINTRUST_LOG_CONTENT
  })

  it("is disabled when the API key is absent", () => {
    expect(isBraintrustEnabled()).toBe(false)
  })

  it("is disabled when BRAINTRUST_ENABLED=false even with an API key", () => {
    process.env.BRAINTRUST_API_KEY = "bt-key"
    process.env.BRAINTRUST_ENABLED = "false"

    expect(isBraintrustEnabled()).toBe(false)
  })

  it("is enabled when an API key is present and the flag is not false", () => {
    process.env.BRAINTRUST_API_KEY = "bt-key"

    expect(isBraintrustEnabled()).toBe(true)
  })

  it("masks secrets and AI content by default", () => {
    const masked = maskBraintrustPayload({
      apiKey: "sk-secret",
      input: [{ role: "user", content: "hello@example.com" }],
      nested: {
        experimental_telemetry: {
          metadata: {
            conversationId: "chat_raw",
            requestId: "req_123",
          },
        },
        messages: [{ content: "keep this private" }],
        metadata: {
          model: "gpt-5.2",
          provider: "openai",
        },
      },
    })

    expect(masked).toEqual({
      apiKey: "[REDACTED]",
      input: "[REDACTED]",
      nested: {
        experimental_telemetry: {
          metadata: {
            conversationId: "[REDACTED]",
            requestId: "req_123",
          },
        },
        messages: "[REDACTED]",
        metadata: {
          model: "gpt-5.2",
          provider: "openai",
        },
      },
    })
  })

  it("preserves safe metadata fields while redacting sensitive metadata", () => {
    const metadata = sanitizeBraintrustMetadata({
      requestId: "req_123",
      route: "api/chat",
      provider: "anthropic",
      apiKey: "sk-secret",
      conversationId: "chat_raw",
      userEmail: "person@example.com",
      toolCounts: {
        builtIn: 1,
        mcp: 2,
      },
    })

    expect(metadata).toEqual({
      requestId: "req_123",
      route: "api/chat",
      provider: "anthropic",
      apiKey: "[REDACTED]",
      conversationId: "[REDACTED]",
      userEmail: "[REDACTED]",
      toolCounts: {
        builtIn: 1,
        mcp: 2,
      },
    })
  })

  it("uses the analytics scrubber instead of raw content when content logging is enabled", () => {
    process.env.BRAINTRUST_LOG_CONTENT = "true"

    const masked = maskBraintrustPayload({
      input: [{ role: "user", content: "Contact me at person@example.com" }],
      output: "Call 415-555-1212",
      apiKey: "sk-secret",
    })

    expect(masked).toEqual({
      input: [{ role: "user", content: "Contact me at [REDACTED]" }],
      output: "Call [REDACTED]",
      apiKey: "[REDACTED]",
    })
  })

  it("hashes identifiers without returning the raw value", async () => {
    const first = await hashBraintrustIdentifier("chat_123")
    const second = await hashBraintrustIdentifier("chat_123")

    expect(first).toBe(second)
    expect(first).toMatch(/^sha256:[a-f0-9]{32}$/)
    expect(first).not.toContain("chat_123")
  })
})
