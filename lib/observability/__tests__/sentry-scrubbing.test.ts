import {
  containsSecret,
  redactSecretsInString,
} from "@/lib/observability/secret-patterns"
import {
  getSanitizedExceptionSummary,
  sanitizeExceptionForTelemetry,
  sentryBeforeSend,
} from "@/lib/observability/sentry-scrubbing"
import { describe, expect, it } from "vitest"

describe("secret value detection", () => {
  it("matches the key shapes this app brokers", () => {
    for (const s of [
      "sk-proj-abcdefgh12345678",
      "sk-ant-api03-abcdefgh12345678",
      "sk-or-v1-abcdefgh12345678",
      "fc-abcdefgh12345678",
      "Bearer sk-abcdefgh12345678",
      "ghp_abcdefgh12345678",
      "xoxb-abcdefgh12345678",
      "AKIAIOSFODNN7EXAMPLE",
      "ASIAIOSFODNN7EXAMPLE",
    ]) {
      expect(containsSecret(s)).toBe(true)
    }
  })

  it("does not flag ordinary dashed identifiers", () => {
    for (const s of [
      "550e8400-e29b-41d4-a716-446655440000", // uuid
      "flex-row-gap-2",
      "chat-abc",
      "model-id-migration",
    ]) {
      expect(containsSecret(s)).toBe(false)
    }
  })

  it("redacts only the secret run, preserving surrounding text", () => {
    expect(
      redactSecretsInString(
        "Incorrect API key provided: sk-ant-api03-abcd1234efgh"
      )
    ).toBe("Incorrect API key provided: [REDACTED]")
  })

  it("leak-canary: catches the execution-grant secret bare and as a Bearer header", () => {
    // Shaped exactly like the ADR-0011 grant: randomBytes(32).toString("hex").
    const grantSecret =
      "9f8b1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c"
    for (const leak of [
      grantSecret,
      `Bearer ${grantSecret}`,
      `Durable worker write updateAssistantSnapshot failed: 401 secret=${grantSecret}`,
    ]) {
      expect(containsSecret(leak)).toBe(true)
      expect(redactSecretsInString(leak)).not.toContain(grantSecret)
    }
    // Generic bearer credentials without a known prefix are still caught.
    expect(containsSecret("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")).toBe(
      true
    )
  })
})

describe("chat-performance scrub corpus", () => {
  it("catches WorkOS-style session/access tokens behind Bearer schemes", () => {
    for (const leak of [
      "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6InNzb19vaWRjX2tleV9wYWlyIn0.payload.sig",
      "Bearer wos_session_abcdefghijklmnop",
    ]) {
      expect(containsSecret(leak)).toBe(true)
    }
  })

  it("redacts MCP authorization headers by key name", () => {
    const event = {
      contexts: {
        mcp_request: {
          serverUrl: "https://mcp.example.com",
          authorization: "Bearer mcp-server-token-000111222333",
        },
      },
    }
    const scrubbed = sentryBeforeSend(event) as typeof event
    expect(scrubbed.contexts.mcp_request.authorization).toBe("[REDACTED]")
  })

  it("redacts prompt/output-like AI telemetry paths regardless of content", () => {
    // Root-level AI telemetry paths — the shape sentryBeforeSendSpan sees.
    const event = {
      ai: { prompt: { messages: [{ role: "user", content: "my prompt" }] } },
      gen_ai: {
        response: { text: "assistant output text" },
        tool: {
          call: {
            arguments: { query: "tool input text" },
            result: { snippet: "tool output text" },
          },
        },
      },
    }
    const flattened = JSON.stringify(sentryBeforeSend(event))
    expect(flattened).not.toContain("my prompt")
    expect(flattened).not.toContain("assistant output text")
    expect(flattened).not.toContain("tool input text")
    expect(flattened).not.toContain("tool output text")
  })

  it("redacts provider keys and grants inside attachment-URL-shaped strings", () => {
    const leak =
      "https://files.example.com/att/1?sig=9f8b1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c"
    expect(redactSecretsInString(leak)).not.toContain(
      "9f8b1c2d3e4a5b6c7d8e9f0a1b2c3d4e"
    )
  })
})

describe("sentryBeforeSend", () => {
  it("allow-lists exception types at the final event boundary", () => {
    const sentinel = "PRIVATE_PROVIDER_PAYLOAD"
    const event = {
      exception: {
        values: [
          {
            type: `ProviderError: ${sentinel}`,
            value: "Provider request failed",
          },
          {
            type: "AI_TypeValidationError",
            value: "Validation failed",
          },
        ],
      },
    }

    const scrubbed = sentryBeforeSend(event)
    expect(scrubbed.exception.values[0].type).toBe("Error")
    expect(scrubbed.exception.values[1].type).toBe("AI_TypeValidationError")
    expect(JSON.stringify(scrubbed)).not.toContain(sentinel)
  })

  it("redacts a key embedded in an exception message (value-level, innocuous path)", () => {
    const event = {
      exception: {
        values: [
          {
            type: "AuthenticationError",
            // No sensitive KEY name here — only key-value scrubbing would miss this.
            value:
              "401 Incorrect API key provided: sk-ant-api03-verysecretvalue00",
          },
        ],
      },
    }
    const scrubbed = sentryBeforeSend(event)
    const message = scrubbed.exception.values[0].value
    expect(message).not.toContain("sk-ant-api03-verysecretvalue00")
    expect(message).toContain("[REDACTED]")
  })

  it("redacts a temporary AWS access key embedded in an exception message", () => {
    const event = {
      exception: {
        values: [
          {
            type: "CredentialsProviderError",
            value: "STS credentials failed for access key ASIAIOSFODNN7EXAMPLE",
          },
        ],
      },
    }
    const scrubbed = sentryBeforeSend(event)
    const message = scrubbed.exception.values[0].value
    expect(message).not.toContain("ASIAIOSFODNN7EXAMPLE")
    expect(message).toBe("STS credentials failed for access key [REDACTED]")
  })

  it("removes AI SDK validation payloads and entity ids from exception values", () => {
    const sentinel = "OPAQUE_ENCRYPTED_CONTENT_SENTINEL"
    const toolId = "srvtoolu_PRIVATE_ENTITY_ID"
    const event = {
      exception: {
        values: [
          {
            type: "AI_TypeValidationError",
            value: `Type validation failed for messages[3].parts[2].output (web_search, id: "${toolId}"): Value: [{"encryptedContent":"${sentinel}","url":"https://private.invalid"}].`,
          },
        ],
      },
    }

    const scrubbed = sentryBeforeSend(event)
    const serialized = JSON.stringify(scrubbed)
    expect(serialized).not.toContain(sentinel)
    expect(serialized).not.toContain(toolId)
    expect(serialized).not.toContain("private.invalid")
    expect(scrubbed.exception.values[0].value).toContain(
      "Type validation failed"
    )
  })

  it("still redacts by sensitive key name", () => {
    const event = {
      request: {
        headers: { authorization: "Bearer sk-secret", cookie: "session=abc" },
      },
    }
    const scrubbed = sentryBeforeSend(event) as typeof event
    expect(scrubbed.request.headers.authorization).toBe("[REDACTED]")
    expect(scrubbed.request.headers.cookie).toBe("[REDACTED]")
  })

  it("redacts secret-shaped values nested in arrays and objects", () => {
    const event = {
      breadcrumbs: [
        { data: { note: "retrying with sk-or-v1-anothersecret000" } },
      ],
    }
    const scrubbed = sentryBeforeSend(event)
    expect(JSON.stringify(scrubbed)).not.toContain("sk-or-v1-anothersecret000")
  })

  it("leaves non-sensitive content intact", () => {
    const event = { tags: { route: "api/chat", model: "gpt-5" } }
    expect(sentryBeforeSend(event)).toEqual(event)
  })
})

describe("sanitizeExceptionForTelemetry", () => {
  it("replaces an untrusted error name in summaries and the stack header", () => {
    const nameSentinel = "PRIVATE_NAME_PAYLOAD"
    const messageSentinel = "PRIVATE_MESSAGE_PAYLOAD"
    const error = new Error(
      `Type validation failed: Value: ${messageSentinel}`
    )
    error.name = `ProviderError: ${nameSentinel}`
    error.stack = `${error.name}: ${error.message}\n    at providerCall (provider.ts:1:1)`

    const sanitized = sanitizeExceptionForTelemetry(error)
    expect(sanitized.name).toBe("Error")
    expect(sanitized.message).toBe("Type validation failed")
    expect(sanitized.stack).toBe(
      "Error: Type validation failed\n    at providerCall (provider.ts:1:1)"
    )
    expect(getSanitizedExceptionSummary(error)).toEqual({
      errorName: "Error",
      errorMessage: "Type validation failed",
    })
    expect(JSON.stringify(getSanitizedExceptionSummary(error))).not.toContain(
      nameSentinel
    )
    expect(sanitized.stack).not.toContain(messageSentinel)
  })

  it("preserves an allow-listed exception name", () => {
    const error = new TypeError("Invalid input")
    expect(sanitizeExceptionForTelemetry(error).name).toBe("TypeError")
  })

  it("removes every multiline message line before retaining stack frames", () => {
    const messageSentinel = "PRIVATE_MULTILINE_PAYLOAD"
    const frameShapedSentinel = "PRIVATE_FRAME_SHAPED_PAYLOAD"
    const error = new Error(
      `Type validation failed: Value: {\n    at ${frameShapedSentinel} (private.ts:1:1)\n    "prompt": "${messageSentinel}"\n}`
    )
    error.stack = `${error.name}: ${error.message}\n    at providerCall (provider.ts:1:1)`

    const sanitized = sanitizeExceptionForTelemetry(error)

    expect(sanitized.stack).toBe(
      "Error: Type validation failed\n    at providerCall (provider.ts:1:1)"
    )
    expect(sanitized.stack).not.toContain(messageSentinel)
    expect(sanitized.stack).not.toContain(frameShapedSentinel)
  })

  it("omits raw frames when the original stack header cannot be verified", () => {
    const stackSentinel = "PRIVATE_CUSTOM_STACK_PAYLOAD"
    const error = new Error("Provider failed")
    error.stack = `Custom stack\n    at ${stackSentinel} (private.ts:1:1)`

    expect(sanitizeExceptionForTelemetry(error).stack).toBe(
      "Error: Provider failed"
    )
  })
})
