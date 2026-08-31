import { describe, expect, it, vi } from "vitest"
import { ToolExecutionError } from "../errors"
import { wrapToolsWithExecutionPolicy } from "../execution-policy"
import { ToolPolicyError } from "../policy"
import { ToolTraceCollector } from "../types"
import { enrichToolError, isTruncated, truncateToolResult } from "../utils"

function serializedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return new TextEncoder().encode(String(value)).length
  }
}

vi.mock("@/lib/config", () => ({
  MAX_TOOL_RESULT_SIZE: 100 * 1024, // 100KB default
  TOOL_EXECUTION_TIMEOUT_MS: 15_000,
}))

describe("truncateToolResult", () => {
  describe("results within size limit", () => {
    it("returns representative small values unchanged", () => {
      const values = [
        "Hello, world!",
        { key: "value", count: 42 },
        [1, 2, 3, "four"],
        42,
        true,
        null,
      ]

      for (const value of values) {
        expect(truncateToolResult(value, 1024)).toEqual(value)
      }
    })
  })

  describe("oversized string truncation", () => {
    it("truncates strings over the byte limit with marker", () => {
      const largeString = "a".repeat(2000)
      const result = truncateToolResult(largeString, 100)

      expect(typeof result).toBe("string")
      expect((result as string).length).toBeLessThan(2000)
      expect(result).toContain("[truncated — showing first")
    })

    it("uses the configured default byte boundary", () => {
      // Leave room for JSON's surrounding quotes.
      const underLimit = "a".repeat(100 * 1024 - 3)
      const overLimit = "a".repeat(100 * 1024 + 1)

      expect(truncateToolResult(underLimit)).toBe(underLimit)
      expect(truncateToolResult(overLimit)).toContain(
        "[truncated — showing first"
      )
    })
  })

  describe("oversized array truncation", () => {
    it("returns shape-preserved truncation with metadata", () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        content: "x".repeat(100),
      }))
      const result = truncateToolResult(items, 1024) as {
        _truncated: boolean
        _originalCount: number
        _returnedCount: number
        data: unknown[]
      }

      expect(result._truncated).toBe(true)
      expect(result._originalCount).toBe(100)
      expect(result._returnedCount).toBeLessThan(100)
      expect(result._returnedCount).toBeGreaterThan(0)
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBe(result._returnedCount)
      expect(serializedSize(result)).toBeLessThanOrEqual(1024)
    })

    it("falls back to empty array when a single element exceeds budget", () => {
      // Single oversized element — loop body never executes
      const items = [{ data: "x".repeat(2000) }]
      const result = truncateToolResult(items, 100) as {
        _truncated: boolean
        _originalCount: number
        _returnedCount: number
        data: unknown[]
      }

      expect(result._truncated).toBe(true)
      expect(result._originalCount).toBe(1)
      expect(result._returnedCount).toBe(0)
      expect(result.data).toEqual([])
    })
  })

  describe("oversized object truncation", () => {
    it("returns truncated representation with metadata", () => {
      const largeObj = {
        data: "x".repeat(2000),
        more: "y".repeat(2000),
      }
      const result = truncateToolResult(largeObj, 1024) as {
        _truncated: boolean
        _originalSizeBytes: number
        _hint: string
      }

      expect(result._truncated).toBe(true)
      expect(result._originalSizeBytes).toBeGreaterThan(1024)
      expect(result._hint).toContain("Request specific fields")
    })

    it("preserves truncation metadata when input uses reserved metadata keys", () => {
      const payload = {
        _hint: "user supplied hint",
        _truncated: false,
        _originalSizeBytes: "not-a-number",
        _keptKeys: "fake-count",
        title: "Important title",
        debugBlob: "x".repeat(5000),
      }

      const result = truncateToolResult(payload, 500) as Record<string, unknown>

      expect(result._truncated).toBe(true)
      expect(typeof result._hint).toBe("string")
      expect(result._hint).not.toBe("user supplied hint")
      expect(typeof result._originalSizeBytes).toBe("number")
      expect((result._originalSizeBytes as number) > 500).toBe(true)
      expect(serializedSize(result)).toBeLessThanOrEqual(500)
    })
  })

  describe("priority-aware truncation v2", () => {
    it("prioritizes high-signal keys in mixed objects", () => {
      const payload = {
        internalBlob: "x".repeat(3500),
        debugStack: "y".repeat(3500),
        title: "Important title",
        url: "https://example.com/post",
        content: "short excerpt",
        error: "upstream timeout",
      }

      const result = truncateToolResult(payload, 512) as Record<string, unknown>

      expect(result._truncated).toBe(true)
      expect(result.error).toBe("upstream timeout")
      expect(result.title).toBe("Important title")
      expect(result.url).toBe("https://example.com/post")
      expect(serializedSize(result)).toBeLessThanOrEqual(512)
    })

    it("retains useful subset for large result arrays", () => {
      const rows = Array.from({ length: 40 }, (_, i) => ({
        title: `Result ${i}`,
        url: `https://example.com/${i}`,
        content: i === 39 ? "tail with error context" : "z".repeat(260),
        ...(i === 39 ? { error: "failed_to_fetch" } : {}),
      }))

      const result = truncateToolResult(rows, {
        maxBytes: 900,
        toolName: "web_search",
        resultCategory: "search_results",
      }) as {
        _truncated: boolean
        _returnedCount: number
        data: Array<Record<string, unknown>>
      }

      expect(result._truncated).toBe(true)
      expect(result._returnedCount).toBeGreaterThan(0)
      expect(result.data[0]).toHaveProperty("title")
      expect(result.data[0]).toHaveProperty("url")
      expect(serializedSize(result)).toBeLessThanOrEqual(900)
    })

    it("keeps truncated object output JSON-serializable with circular high-priority keys", () => {
      const circularError: Record<string, unknown> = {}
      circularError.self = circularError
      const payload = {
        error: circularError,
        title: "Failure from upstream",
        url: "https://example.com/failure",
        debugBlob: "x".repeat(8_000),
      }

      const result = truncateToolResult(payload, 700) as Record<string, unknown>
      expect(result._truncated).toBe(true)
      expect(() => JSON.stringify(result)).not.toThrow()
      expect(serializedSize(result)).toBeLessThanOrEqual(700)
    })

    it("keeps truncated array output JSON-serializable with circular retained items", () => {
      const circularItem: Record<string, unknown> = {
        title: "Circular row",
        url: "https://example.com/circular",
      }
      circularItem.self = circularItem

      const rows = [
        circularItem,
        ...Array.from({ length: 24 }, (_, i) => ({
          title: `Result ${i}`,
          url: `https://example.com/${i}`,
          content: "z".repeat(300),
        })),
      ]

      const result = truncateToolResult(rows, {
        maxBytes: 900,
        resultCategory: "search_results",
      }) as {
        _truncated: boolean
        data: unknown[]
      }

      expect(result._truncated).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
      expect(() => JSON.stringify(result)).not.toThrow()
      expect(serializedSize(result)).toBeLessThanOrEqual(900)
    })

    it("truncates plain text at semantic boundaries when feasible", () => {
      const text =
        "Alpha sentence. Beta sentence with details.\n\nGamma paragraph starts here and continues with supporting notes. Delta closing sentence."
      const large = text.repeat(120)
      const result = truncateToolResult(large, {
        maxBytes: 700,
        resultCategory: "plain_text",
      }) as string

      expect(result).toContain("[truncated — showing first")
      const [prefix] = result.split("\n[truncated")
      expect(prefix.length).toBeGreaterThan(0)
      expect(/[.\n ]$/.test(prefix)).toBe(true)
      expect(serializedSize(result)).toBeLessThanOrEqual(700)
    })

    it("stays within hard budget for non-serializable deep payloads", () => {
      const root: Record<string, unknown> = { id: "root" }
      root.self = root
      root.large = {
        a: "a".repeat(6000),
        b: "b".repeat(6000),
      }

      const result = truncateToolResult(root, 512) as Record<string, unknown>
      expect(result._truncated).toBe(true)
      expect(() => JSON.stringify(result)).not.toThrow()
      expect(serializedSize(result)).toBeLessThanOrEqual(512)
    })
  })

  describe("edge cases", () => {
    it("logs a warning when truncation occurs", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const largeString = "a".repeat(2000)

      truncateToolResult(largeString, 100)

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[tools] Result truncated:")
      )
      warnSpy.mockRestore()
    })
  })
})

describe("isTruncated", () => {
  it("recognizes only explicit truncation envelopes", () => {
    expect(
      isTruncated({
        _truncated: true,
        _originalCount: 100,
        _returnedCount: 10,
        data: [],
      })
    ).toBe(true)
    expect(
      isTruncated({
        _truncated: true,
        _originalSizeBytes: 200000,
        _hint: "...",
      })
    ).toBe(true)
    expect(isTruncated({ key: "value" })).toBe(false)
    expect(isTruncated("hello")).toBe(false)
    expect(isTruncated(42)).toBe(false)
    expect(isTruncated(null)).toBe(false)
    expect(isTruncated(undefined)).toBe(false)
    expect(isTruncated({ _truncated: false })).toBe(false)
    expect(isTruncated({ _truncated: "yes" })).toBe(false)
  })
})

describe("structured tool errors", () => {
  it("enrichToolError returns ToolExecutionError with taxonomy code", () => {
    const err = enrichToolError(
      new Error("429 rate limit exceeded"),
      "web_search"
    )
    expect(err).toBeInstanceOf(ToolExecutionError)
    const typed = err as ToolExecutionError
    expect(typed.code).toBe("rate_limit")
    expect(typed.retryable).toBe(true)
    expect(typed.message).toContain("web_search failed")
  })

  it("enrichToolError passes policy errors through unchanged", () => {
    const policyError = new ToolPolicyError(
      "TOOL_BUDGET_EXCEEDED: Retry after approximately 10 seconds.",
      {
        code: "TOOL_BUDGET_EXCEEDED",
        retryAfterSeconds: 10,
        keyMode: "platform",
        budgetDenied: true,
      }
    )
    expect(enrichToolError(policyError, "web_search")).toBe(policyError)
  })

  it("records taxonomy code for failures", async () => {
    const traces = new ToolTraceCollector()
    const tools = {
      flaky_tool: {
        description: "flaky",
        execute: async () => {
          throw new Error("fetch failed")
        },
      },
    }

    const wrapped = wrapToolsWithExecutionPolicy(
      tools as unknown as import("ai").ToolSet,
      { traceCollector: traces, requestId: "req_1" }
    )

    await expect(
      (wrapped.flaky_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_network" }
      )
    ).rejects.toThrow("fetch failed")

    const trace = traces.get("call_network")
    expect(trace).toBeDefined()
    expect(trace?.errorCode).toBe("network")
  })
})

describe("local tool execution policy", () => {
  it("cancels promptly when upstream abortSignal is aborted", async () => {
    const traces = new ToolTraceCollector()
    const tools = {
      cancellable_tool: {
        description: "cancellable",
        execute: async (
          _params: unknown,
          options: { abortSignal?: AbortSignal }
        ) =>
          new Promise((resolve, reject) => {
            const signal = options.abortSignal
            if (!signal) return resolve("ok")
            if (signal.aborted) {
              reject(new Error("should not reach"))
              return
            }
            signal.addEventListener(
              "abort",
              () => reject(new Error("inner aborted")),
              { once: true }
            )
          }),
      },
    }

    const wrapped = wrapToolsWithExecutionPolicy(
      tools as unknown as import("ai").ToolSet,
      {
        traceCollector: traces,
        requestId: "req_abort",
        resolveAdapter: () => ({
          retrySafety: {
            readOnly: true,
            idempotent: true,
            destructive: false,
          },
        }),
      }
    )

    const controller = new AbortController()
    const execution = (
      wrapped.cancellable_tool as { execute: Function }
    ).execute({}, { toolCallId: "call_abort", abortSignal: controller.signal })
    controller.abort("caller_cancelled")

    await expect(execution).rejects.toThrow(/cancelled|aborted/i)
    const trace = traces.get("call_abort")
    expect(trace?.success).toBe(false)
    expect(trace?.errorCode).toBe("aborted")
  })

  it("retries idempotent transient failures and succeeds", async () => {
    const traces = new ToolTraceCollector()
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true })
    const tools = {
      flaky_tool: {
        description: "flaky",
        execute,
      },
    }

    const wrapped = wrapToolsWithExecutionPolicy(
      tools as unknown as import("ai").ToolSet,
      {
        traceCollector: traces,
        requestId: "req_retry",
        resolveAdapter: () => ({
          retrySafety: {
            readOnly: true,
            idempotent: true,
            destructive: false,
          },
        }),
      }
    )

    const result = await (wrapped.flaky_tool as { execute: Function }).execute(
      {},
      { toolCallId: "call_retry_success" }
    )

    expect(result).toEqual({ ok: true })
    expect(execute).toHaveBeenCalledTimes(2)
    const trace = traces.get("call_retry_success")
    expect(trace?.success).toBe(true)
    expect(trace?.retryCount).toBe(1)
  })

  it("does not retry non-idempotent tools", async () => {
    const traces = new ToolTraceCollector()
    const execute = vi.fn().mockRejectedValue(new Error("fetch failed"))
    const tools = {
      write_tool: {
        description: "write",
        execute,
      },
    }

    const wrapped = wrapToolsWithExecutionPolicy(
      tools as unknown as import("ai").ToolSet,
      {
        traceCollector: traces,
        requestId: "req_non_idempotent",
        resolveAdapter: () => ({
          retrySafety: {
            readOnly: false,
            idempotent: false,
            destructive: false,
          },
        }),
      }
    )

    await expect(
      (wrapped.write_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_non_idempotent" }
      )
    ).rejects.toThrow("fetch failed")

    expect(execute).toHaveBeenCalledTimes(1)
    const trace = traces.get("call_non_idempotent")
    expect(trace?.retryCount).toBe(0)
  })

  it("does not retry policy/auth/validation failures", async () => {
    const traces = new ToolTraceCollector()
    const execute = vi.fn().mockRejectedValueOnce(
      new ToolPolicyError("TOOL_BUDGET_EXCEEDED: retry later", {
        code: "TOOL_BUDGET_EXCEEDED",
        retryAfterSeconds: 10,
        keyMode: "platform",
        budgetDenied: true,
      })
    )
    const tools = {
      guarded_tool: {
        description: "guarded",
        execute,
      },
    }

    const wrapped = wrapToolsWithExecutionPolicy(
      tools as unknown as import("ai").ToolSet,
      {
        traceCollector: traces,
        requestId: "req_no_retry",
        resolveAdapter: () => ({
          retrySafety: {
            readOnly: true,
            idempotent: true,
            destructive: false,
          },
        }),
      }
    )

    await expect(
      (wrapped.guarded_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_policy_no_retry" }
      )
    ).rejects.toThrow("TOOL_BUDGET_EXCEEDED")
    expect(execute).toHaveBeenCalledTimes(1)

    execute.mockReset().mockRejectedValueOnce(new Error("401 unauthorized"))
    await expect(
      (wrapped.guarded_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_auth_no_retry" }
      )
    ).rejects.toThrow("401 unauthorized")
    expect(execute).toHaveBeenCalledTimes(1)

    execute
      .mockReset()
      .mockRejectedValueOnce(new Error("Validation failed: invalid input"))
    await expect(
      (wrapped.guarded_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_validation_no_retry" }
      )
    ).rejects.toThrow("Validation failed")
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
