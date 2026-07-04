import { MCP_CIRCUIT_BREAKER_THRESHOLD } from "@/lib/config"
import type { ToolSet } from "ai"
import { describe, expect, it, vi } from "vitest"
import {
  ToolTimeoutError,
  ToolTraceCollector,
  wrapMcpTools,
} from "../mcp-wrapper"
import { ToolPolicyError } from "../policy"

// ── Helpers ──────────────────────────────────────────────

/** Create a minimal tool with the given execute function */
function makeTool(
  executeFn: (
    params: unknown,
    options: {
      toolCallId: string
      abortSignal?: AbortSignal
      [k: string]: unknown
    }
  ) => Promise<unknown>
) {
  return {
    description: "test tool",
    parameters: { type: "object", properties: {} },
    execute: executeFn,
  }
}

/** Create a standard WrapMcpToolsConfig for tests */
function makeConfig(overrides?: {
  timeoutMs?: number
  maxResultBytes?: number
}) {
  const traceCollector = new ToolTraceCollector()
  return {
    toolServerMap: new Map([
      [
        "test_tool",
        {
          displayName: "Test Tool",
          serverName: "test-server",
          serverId: "server123",
        },
      ],
    ]),
    traceCollector,
    ...overrides,
  }
}

// ── wrapMcpTools ─────────────────────────────────────────

describe("wrapMcpTools", () => {
  it("wraps a tool that resolves before timeout", async () => {
    const config = makeConfig({ timeoutMs: 5000 })
    const tools = {
      test_tool: makeTool(async () => ({ answer: 42 })),
    } as unknown as ToolSet

    const wrapped = wrapMcpTools(tools, config)
    const result = await (wrapped.test_tool as { execute: Function }).execute(
      {},
      { toolCallId: "call_1" }
    )

    expect(result).toEqual({ answer: 42 })

    // Trace recorded
    const trace = config.traceCollector.get("call_1")
    expect(trace).toBeDefined()
    expect(trace!.success).toBe(true)
    expect(trace!.toolName).toBe("test_tool")
    expect(trace!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("throws ToolTimeoutError when tool exceeds timeout", async () => {
    const config = makeConfig({ timeoutMs: 50 }) // 50ms timeout
    const tools = {
      test_tool: makeTool(
        () => new Promise((resolve) => setTimeout(resolve, 5000)) // hangs for 5s
      ),
    } as unknown as ToolSet

    const wrapped = wrapMcpTools(tools, config)

    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_timeout" }
      )
    ).rejects.toThrow(ToolTimeoutError)

    // Trace records the failure
    const trace = config.traceCollector.get("call_timeout")
    expect(trace).toBeDefined()
    expect(trace!.success).toBe(false)
    expect(trace!.error).toContain("timed out")
    expect(trace!.errorCode).toBe("timeout")
    expect(trace!.durationMs).toBeLessThan(500) // Should fail fast
  })

  it("cancels on upstream abortSignal and preserves abort taxonomy", async () => {
    const config = makeConfig({ timeoutMs: 5000 })
    const tools = {
      test_tool: makeTool(
        async (_params, options) =>
          new Promise((_, reject) => {
            const signal = options.abortSignal as AbortSignal | undefined
            if (!signal) return
            signal.addEventListener(
              "abort",
              () => reject(new Error("tool saw abort")),
              { once: true }
            )
          })
      ),
    } as unknown as ToolSet

    const wrapped = wrapMcpTools(tools, config)
    const controller = new AbortController()
    const pending = (wrapped.test_tool as { execute: Function }).execute(
      {},
      { toolCallId: "call_upstream_abort", abortSignal: controller.signal }
    )
    controller.abort("request_cancelled")

    await expect(pending).rejects.toThrow(/cancelled|aborted/i)
    const trace = config.traceCollector.get("call_upstream_abort")
    expect(trace?.success).toBe(false)
    expect(trace?.errorCode).toBe("aborted")
  })

  it("retries idempotent MCP tool on transient failure when retry hints are trusted", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true })
    const traceCollector = new ToolTraceCollector()
    const wrapped = wrapMcpTools(
      {
        test_tool: makeTool(execute),
      } as unknown as ToolSet,
      {
        toolServerMap: new Map([
          [
            "test_tool",
            {
              displayName: "Test Tool",
              serverName: "test-server",
              serverId: "server123",
              idempotent: true,
              destructive: false,
              retrySafetyTrusted: true,
            },
          ],
        ]),
        traceCollector,
        timeoutMs: 1000,
      }
    )

    const result = await (wrapped.test_tool as { execute: Function }).execute(
      {},
      { toolCallId: "call_retry_mcp" }
    )
    expect(result).toEqual({ ok: true })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(traceCollector.get("call_retry_mcp")?.retryCount).toBe(1)
  })

  it("does not retry trusted idempotent MCP tool when non-destructive signal is missing", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true })
    const traceCollector = new ToolTraceCollector()
    const wrapped = wrapMcpTools(
      {
        test_tool: makeTool(execute),
      } as unknown as ToolSet,
      {
        toolServerMap: new Map([
          [
            "test_tool",
            {
              displayName: "Test Tool",
              serverName: "test-server",
              serverId: "server123",
              idempotent: true,
              retrySafetyTrusted: true,
            },
          ],
        ]),
        traceCollector,
        timeoutMs: 1000,
      }
    )

    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_retry_trusted_without_non_destructive" }
      )
    ).rejects.toThrow(/fetch failed/i)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(
      traceCollector.get("call_retry_trusted_without_non_destructive")
        ?.retryCount
    ).toBe(0)
  })

  it("does not retry idempotent MCP tool when retry hints are untrusted", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true })
    const traceCollector = new ToolTraceCollector()
    const wrapped = wrapMcpTools(
      {
        test_tool: makeTool(execute),
      } as unknown as ToolSet,
      {
        toolServerMap: new Map([
          [
            "test_tool",
            {
              displayName: "Test Tool",
              serverName: "test-server",
              serverId: "server123",
              idempotent: true,
              retrySafetyTrusted: false,
            },
          ],
        ]),
        traceCollector,
        timeoutMs: 1000,
      }
    )

    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_retry_untrusted_mcp" }
      )
    ).rejects.toThrow(/fetch failed/i)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(traceCollector.get("call_retry_untrusted_mcp")?.retryCount).toBe(0)
  })

  it("throws and traces when tool execute() rejects", async () => {
    const config = makeConfig({ timeoutMs: 5000 })
    const tools = {
      test_tool: makeTool(async () => {
        throw new Error("API rate limited")
      }),
    } as unknown as ToolSet

    const wrapped = wrapMcpTools(tools, config)

    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_error" }
      )
    ).rejects.toThrow("API rate limited")

    const trace = config.traceCollector.get("call_error")
    expect(trace).toBeDefined()
    expect(trace!.success).toBe(false)
    expect(trace!.error).toBe("API rate limited")
    expect(trace!.errorCode).toBe("rate_limit")
  })

  it("maps policy errors to taxonomy while preserving budget metadata", async () => {
    const config = makeConfig({ timeoutMs: 5000 })
    const tools = {
      test_tool: makeTool(async () => {
        throw new ToolPolicyError(
          "TOOL_BUDGET_EXCEEDED: Tool budget exceeded. Retry after approximately 60 seconds.",
          {
            code: "TOOL_BUDGET_EXCEEDED",
            retryAfterSeconds: 60,
            keyMode: "platform",
            budgetDenied: true,
          }
        )
      }),
    } as unknown as ToolSet

    const wrapped = wrapMcpTools(tools, config)

    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_policy" }
      )
    ).rejects.toThrow("TOOL_BUDGET_EXCEEDED")

    const trace = config.traceCollector.get("call_policy")
    expect(trace).toBeDefined()
    expect(trace!.success).toBe(false)
    expect(trace!.errorCode).toBe("policy_limit")
    expect(trace!.retryAfterSeconds).toBe(60)
    expect(trace!.budgetKeyMode).toBe("platform")
    expect(trace!.budgetDenied).toBe(true)
  })

  it("opens only after true consecutive transient failures", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))

    const wrapped = wrapMcpTools(
      { test_tool: makeTool(execute) } as unknown as ToolSet,
      makeConfig()
    )

    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_reset_1" }
      )
    ).rejects.toThrow(/fetch failed/i)

    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_reset_2" }
      )
    ).resolves.toEqual({ ok: true })

    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_reset_3" }
      )
    ).rejects.toThrow(/fetch failed/i)
    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_reset_4" }
      )
    ).rejects.toThrow(/fetch failed/i)
    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_reset_5" }
      )
    ).rejects.toThrow(/fetch failed/i)

    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_reset_6" }
      )
    ).rejects.toThrow(/circuit open/i)

    expect(execute).toHaveBeenCalledTimes(5)
  })

  it("resets transient streak when a non-transient failure occurs", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("invalid input: query is required"))
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("fetch failed ECONNREFUSED"))

    const wrapped = wrapMcpTools(
      { test_tool: makeTool(execute) } as unknown as ToolSet,
      makeConfig()
    )

    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_streak_1" }
      )
    ).rejects.toThrow(/fetch failed/i)
    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_streak_2" }
      )
    ).rejects.toThrow(/invalid input/i)
    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_streak_3" }
      )
    ).rejects.toThrow(/fetch failed/i)
    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_streak_4" }
      )
    ).rejects.toThrow(/fetch failed/i)
    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_streak_5" }
      )
    ).rejects.toThrow(/fetch failed/i)
    await expect(
      (wrapped.test_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_streak_6" }
      )
    ).rejects.toThrow(/circuit open/i)

    expect(execute).toHaveBeenCalledTimes(5)
  })

  it("does not count policy or input-validation failures toward circuit opening", async () => {
    const policyFailure = makeTool(async () => {
      throw new ToolPolicyError(
        "TOOL_BUDGET_EXCEEDED: Tool budget exceeded. Retry after approximately 30 seconds.",
        {
          code: "TOOL_BUDGET_EXCEEDED",
          retryAfterSeconds: 30,
          keyMode: "platform",
          budgetDenied: true,
        }
      )
    })
    const validationFailure = makeTool(async () => {
      throw new Error("invalid input: query is required")
    })

    const wrapped = wrapMcpTools(
      {
        test_tool: policyFailure,
        validation_tool: validationFailure,
      } as unknown as ToolSet,
      {
        toolServerMap: new Map([
          [
            "test_tool",
            {
              displayName: "Test Tool",
              serverName: "test-server",
              serverId: "server123",
            },
          ],
          [
            "validation_tool",
            {
              displayName: "Validation Tool",
              serverName: "test-server",
              serverId: "server123",
            },
          ],
        ]),
        traceCollector: new ToolTraceCollector(),
      }
    )

    for (let i = 0; i < 5; i++) {
      await expect(
        (wrapped.test_tool as { execute: Function }).execute(
          {},
          { toolCallId: `call_policy_${i}` }
        )
      ).rejects.toThrow("TOOL_BUDGET_EXCEEDED")
      await expect(
        (wrapped.validation_tool as { execute: Function }).execute(
          {},
          { toolCallId: `call_validation_${i}` }
        )
      ).rejects.toThrow(/invalid input/i)
    }
  })

  it("isolates circuit state for tools without server metadata", async () => {
    const flakyExecute = vi
      .fn()
      .mockRejectedValue(new Error("fetch failed ECONNREFUSED"))
    const healthyExecute = vi.fn().mockResolvedValue({ ok: true })

    const wrapped = wrapMcpTools(
      {
        flaky_tool: makeTool(flakyExecute),
        healthy_tool: makeTool(healthyExecute),
      } as unknown as ToolSet,
      {
        toolServerMap: new Map(),
        traceCollector: new ToolTraceCollector(),
      }
    )

    for (let i = 0; i < MCP_CIRCUIT_BREAKER_THRESHOLD; i++) {
      await expect(
        (wrapped.flaky_tool as { execute: Function }).execute(
          {},
          { toolCallId: `call_flaky_${i}` }
        )
      ).rejects.toThrow(/fetch failed/i)
    }

    await expect(
      (wrapped.flaky_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_flaky_circuit_open" }
      )
    ).rejects.toThrow(/circuit open/i)

    await expect(
      (wrapped.healthy_tool as { execute: Function }).execute(
        {},
        { toolCallId: "call_healthy_after_flaky_open" }
      )
    ).resolves.toEqual({ ok: true })
    expect(healthyExecute).toHaveBeenCalledTimes(1)
  })

  it("passes through tools without execute unchanged", () => {
    const config = makeConfig()
    const providerTool = { description: "provider tool", parameters: {} }
    const tools = {
      provider_tool: providerTool,
    } as unknown as ToolSet

    const wrapped = wrapMcpTools(tools, config)
    expect(wrapped.provider_tool).toBe(providerTool)
  })

  it("truncates large results", async () => {
    const config = makeConfig({ timeoutMs: 5000, maxResultBytes: 100 })
    const largeResult = "x".repeat(1000)
    const tools = {
      test_tool: makeTool(async () => largeResult),
    } as unknown as ToolSet

    const wrapped = wrapMcpTools(tools, config)
    const result = await (wrapped.test_tool as { execute: Function }).execute(
      {},
      { toolCallId: "call_large" }
    )

    // Raw string result should be truncated (contains truncation marker)
    const resultStr =
      typeof result === "string" ? result : JSON.stringify(result)
    expect(resultStr.length).toBeLessThan(1000)

    // Trace should record original size
    const trace = config.traceCollector.get("call_large")
    expect(trace).toBeDefined()
    expect(trace!.resultSizeBytes).toBeGreaterThan(100)
  })
})

// ── ToolTraceCollector ───────────────────────────────────

describe("ToolTraceCollector", () => {
  it("records and retrieves traces by toolCallId", () => {
    const collector = new ToolTraceCollector()
    collector.record({
      toolName: "search",
      toolCallId: "call_1",
      durationMs: 150,
      success: true,
      resultSizeBytes: 2048,
    })
    collector.record({
      toolName: "fetch",
      toolCallId: "call_2",
      durationMs: 300,
      success: false,
      error: "Connection refused",
    })

    expect(collector.get("call_1")?.durationMs).toBe(150)
    expect(collector.get("call_1")?.success).toBe(true)

    expect(collector.get("call_2")?.success).toBe(false)
    expect(collector.get("call_2")?.error).toBe("Connection refused")

    expect(collector.get("nonexistent")).toBeUndefined()
  })

  it("returns all traces via getAll()", () => {
    const collector = new ToolTraceCollector()
    collector.record({
      toolName: "a",
      toolCallId: "call_a",
      durationMs: 10,
      success: true,
    })
    collector.record({
      toolName: "b",
      toolCallId: "call_b",
      durationMs: 20,
      success: true,
    })

    const all = collector.getAll()
    expect(all).toHaveLength(2)
    expect(all.map((t) => t.toolName)).toEqual(
      expect.arrayContaining(["a", "b"])
    )
  })
})

// ── ToolTimeoutError ─────────────────────────────────────

describe("ToolTimeoutError", () => {
  it("has correct name, toolName, and timeoutMs", () => {
    const err = new ToolTimeoutError("my_tool", 30000)
    expect(err.name).toBe("ToolTimeoutError")
    expect(err.toolName).toBe("my_tool")
    expect(err.timeoutMs).toBe(30000)
    expect(err.message).toContain("my_tool")
    expect(err.message).toContain("30000ms")
    expect(err instanceof Error).toBe(true)
  })
})
