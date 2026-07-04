import { describe, expect, it } from "vitest"
import { normalizeToolError } from "../errors"
import { ToolPolicyError } from "../policy"

describe("normalizeToolError", () => {
  it("maps abort/cancel errors", () => {
    const err = new Error("Request was aborted by caller")
    err.name = "AbortError"
    const normalized = normalizeToolError(err)

    expect(normalized.code).toBe("aborted")
    expect(normalized.retryable).toBe(false)
  })

  it("maps timeout-like errors", () => {
    const err = new Error("operation timed out after 30000ms")
    err.name = "ToolTimeoutError"
    const normalized = normalizeToolError(err, { toolName: "mcp_read_docs" })

    expect(normalized.code).toBe("timeout")
    expect(normalized.retryable).toBe(true)
    expect(normalized.toolName).toBe("mcp_read_docs")
  })

  it("maps rate limit errors", () => {
    const normalized = normalizeToolError(new Error("429 rate limit exceeded"))
    expect(normalized.code).toBe("rate_limit")
    expect(normalized.retryable).toBe(true)
  })

  it("maps auth errors", () => {
    const normalized = normalizeToolError(new Error("401 unauthorized"))
    expect(normalized.code).toBe("auth")
    expect(normalized.retryable).toBe(false)
  })

  it("maps network errors", () => {
    const normalized = normalizeToolError(
      new Error("ENOTFOUND api.example.com")
    )
    expect(normalized.code).toBe("network")
    expect(normalized.retryable).toBe(true)
  })

  it("maps validation/input errors", () => {
    const normalized = normalizeToolError(
      new Error("Validation failed: invalid input schema")
    )
    expect(normalized.code).toBe("validation_input")
    expect(normalized.retryable).toBe(false)
  })

  it("maps policy errors into policy_limit taxonomy", () => {
    const normalized = normalizeToolError(
      new ToolPolicyError(
        "TOOL_BUDGET_EXCEEDED: Retry after approximately 30 seconds.",
        {
          code: "TOOL_BUDGET_EXCEEDED",
          retryAfterSeconds: 30,
          keyMode: "platform",
          budgetDenied: true,
        }
      )
    )

    expect(normalized.code).toBe("policy_limit")
    expect(normalized.retryAfterSeconds).toBe(30)
    expect(normalized.details?.policyCode).toBe("TOOL_BUDGET_EXCEEDED")
  })

  it("maps 5xx errors to upstream_failure", () => {
    const err = new Error("Service unavailable")
    ;(err as Error & { statusCode?: number }).statusCode = 503
    const normalized = normalizeToolError(err)

    expect(normalized.code).toBe("upstream_failure")
    expect(normalized.retryable).toBe(true)
    expect(normalized.statusCode).toBe(503)
  })

  it("falls back to unknown", () => {
    const normalized = normalizeToolError(new Error("something odd happened"))
    expect(normalized.code).toBe("unknown")
    expect(normalized.retryable).toBe(false)
  })
})
