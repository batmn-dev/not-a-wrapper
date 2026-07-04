import type { ToolSet } from "ai"
import { describe, expect, it } from "vitest"
import { ToolTraceCollector, wrapMcpTools } from "../mcp-wrapper"
import {
  createOutageTolerantToolBudgetEnforcer,
  createRequestLocalToolSoftCap,
  createToolPolicyGuard,
  getToolBudgetPolicy,
  InMemoryToolLimitStore,
  isPolicyUnavailableError,
  probeToolBudget,
  ToolPolicyError,
  type ToolLimitStore,
} from "../policy"
import { wrapToolsWithTracing } from "../utils"

describe("tool policy guardrails", () => {
  it("persists extract_content domain limits across separate requests", async () => {
    let now = 1_000_000
    const store = new InMemoryToolLimitStore(() => now)

    const requestOneGuard = createToolPolicyGuard({
      store,
      keyMode: "platform",
      actorKey: "guest:guest_alpha",
    })
    await requestOneGuard.enforceExtractDomainLimit(
      new Map([["example.com", 6]])
    )

    const requestTwoGuard = createToolPolicyGuard({
      store,
      keyMode: "platform",
      actorKey: "guest:guest_alpha",
    })

    await expect(
      requestTwoGuard.enforceExtractDomainLimit(new Map([["example.com", 1]]))
    ).rejects.toThrow("EXTRACT_CONTENT_DOMAIN_LIMIT_EXCEEDED")

    // Move beyond the window and verify quota resets.
    now += 16 * 60_000
    await expect(
      requestTwoGuard.enforceExtractDomainLimit(new Map([["example.com", 1]]))
    ).resolves.toBeUndefined()
  })

  it("isolates domain limits by authenticated actor", async () => {
    const store = new InMemoryToolLimitStore(() => 2_000_000)
    const userAGuard = createToolPolicyGuard({
      store,
      keyMode: "platform",
      actorKey: "user:user_a",
    })
    const userBGuard = createToolPolicyGuard({
      store,
      keyMode: "platform",
      actorKey: "user:user_b",
    })

    await userAGuard.enforceExtractDomainLimit(
      new Map([["docs.example.com", 6]])
    )
    await expect(
      userAGuard.enforceExtractDomainLimit(new Map([["docs.example.com", 1]]))
    ).rejects.toThrow("EXTRACT_CONTENT_DOMAIN_LIMIT_EXCEEDED")

    // User B remains unaffected by user A's quota consumption.
    await expect(
      userBGuard.enforceExtractDomainLimit(new Map([["docs.example.com", 1]]))
    ).resolves.toBeUndefined()
  })

  it("isolates anonymous guest IDs correctly", async () => {
    const store = new InMemoryToolLimitStore(() => 3_000_000)
    const guestOneGuard = createToolPolicyGuard({
      store,
      keyMode: "platform",
      actorKey: "guest:guest_one",
    })
    const guestTwoGuard = createToolPolicyGuard({
      store,
      keyMode: "platform",
      actorKey: "guest:guest_two",
    })

    await guestOneGuard.enforceExtractDomainLimit(new Map([["news.site", 6]]))
    await expect(
      guestOneGuard.enforceExtractDomainLimit(new Map([["news.site", 1]]))
    ).rejects.toThrow("EXTRACT_CONTENT_DOMAIN_LIMIT_EXCEEDED")

    await expect(
      guestTwoGuard.enforceExtractDomainLimit(new Map([["news.site", 1]]))
    ).resolves.toBeUndefined()
  })

  it("enforces tool budgets in Layer 2 tracing wrapper", async () => {
    const traces = new ToolTraceCollector()
    const tools = {
      web_search: {
        description: "search",
        inputSchema: { type: "object" },
        execute: async () => ({ ok: true }),
      },
    } as unknown as ToolSet

    const wrapped = wrapToolsWithTracing(
      tools,
      traces,
      "req_layer2",
      async () => {
        throw new ToolPolicyError(
          "TOOL_BUDGET_EXCEEDED: Tool budget exceeded. Retry after approximately 30 seconds.",
          {
            code: "TOOL_BUDGET_EXCEEDED",
            retryAfterSeconds: 30,
            keyMode: "platform",
            budgetDenied: true,
          }
        )
      }
    )

    await expect(
      (wrapped.web_search as { execute: Function }).execute(
        {},
        { toolCallId: "call_layer2" }
      )
    ).rejects.toThrow("TOOL_BUDGET_EXCEEDED")

    const trace = traces.get("call_layer2")
    expect(trace?.errorCode).toBe("policy_limit")
    expect(trace?.retryAfterSeconds).toBe(30)
    expect(trace?.budgetDenied).toBe(true)
    expect(trace?.budgetKeyMode).toBe("platform")
  })

  it("enforces tool budgets in Layer 3 MCP wrapper", async () => {
    const traces = new ToolTraceCollector()
    const tools = {
      mcp_read_docs: {
        description: "mcp read docs",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ ok: true }),
      },
    } as unknown as ToolSet

    const wrapped = wrapMcpTools(tools, {
      toolServerMap: new Map([
        [
          "mcp_read_docs",
          {
            displayName: "Read Docs",
            serverName: "docs",
            serverId: "server_docs",
          },
        ],
      ]),
      traceCollector: traces,
      requestId: "req_layer3",
      enforceToolBudget: async () => {
        throw new ToolPolicyError(
          "TOOL_BUDGET_EXCEEDED: Tool budget exceeded. Retry after approximately 45 seconds.",
          {
            code: "TOOL_BUDGET_EXCEEDED",
            retryAfterSeconds: 45,
            keyMode: "platform",
            budgetDenied: true,
          }
        )
      },
    })

    await expect(
      (wrapped.mcp_read_docs as { execute: Function }).execute(
        {},
        { toolCallId: "call_layer3" }
      )
    ).rejects.toThrow("TOOL_BUDGET_EXCEEDED")

    const trace = traces.get("call_layer3")
    expect(trace?.errorCode).toBe("policy_limit")
    expect(trace?.budgetDenied).toBe(true)
    expect(trace?.budgetKeyMode).toBe("platform")
  })

  it("uses stricter platform budgets than BYOK budgets", () => {
    const platform = getToolBudgetPolicy("extract_content", "platform")
    const byok = getToolBudgetPolicy("extract_content", "byok")
    expect(byok.maxCount).toBeGreaterThan(platform.maxCount)
  })

  it("returns stable error code with actionable retry hint", async () => {
    const store = new InMemoryToolLimitStore(() => 4_000_000)
    const guard = createToolPolicyGuard({
      store,
      keyMode: "platform",
      actorKey: "guest:guest_error_shape",
    })

    await guard.enforceExtractDomainLimit(new Map([["shape.example", 6]]))

    const error = await guard
      .enforceExtractDomainLimit(new Map([["shape.example", 1]]))
      .then(() => null)
      .catch((err) => err)

    expect(error).toBeInstanceOf(ToolPolicyError)
    const typed = error as ToolPolicyError
    expect(typed.code).toBe("EXTRACT_CONTENT_DOMAIN_LIMIT_EXCEEDED")
    expect(typed.message).toContain("Retry after approximately")
  })

  it("returns stable budget error code with actionable retry hint", async () => {
    const store = new InMemoryToolLimitStore(() => 5_000_000)
    const guard = createToolPolicyGuard({
      store,
      keyMode: "platform",
      actorKey: "user:user_budget_shape",
    })

    const budget = getToolBudgetPolicy("web_search", "platform")
    for (let i = 0; i < budget.maxCount; i++) {
      await guard.enforceToolBudget("web_search")
    }

    const error = await guard
      .enforceToolBudget("web_search")
      .then(() => null)
      .catch((err) => err)

    expect(error).toBeInstanceOf(ToolPolicyError)
    const typed = error as ToolPolicyError
    expect(typed.code).toBe("TOOL_BUDGET_EXCEEDED")
    expect(typed.message).toContain("Retry after approximately")
  })

  it("uses tool-specific domain limit codes for non-extract tools", async () => {
    const store = new InMemoryToolLimitStore(() => 5_500_000)

    const first = await store.checkAndConsume({
      limitType: "domain",
      toolName: "web_search",
      keyMode: "platform",
      scopeCounts: [{ scopeKey: "example.com", count: 1 }],
      windowMs: 60_000,
      maxCount: 1,
      bucketSizeMs: 30_000,
      consume: true,
    })
    expect(first.allowed).toBe(true)

    const second = await store.checkAndConsume({
      limitType: "domain",
      toolName: "web_search",
      keyMode: "platform",
      scopeCounts: [{ scopeKey: "example.com", count: 1 }],
      windowMs: 60_000,
      maxCount: 1,
      bucketSizeMs: 30_000,
      consume: true,
    })

    expect(second.allowed).toBe(false)
    expect(second.code).toBe("WEB_SEARCH_DOMAIN_LIMIT_EXCEEDED")
    expect(second.message).toContain('"web_search"')
    expect(second.message).toContain('domain "example.com"')
  })

  it("degrades with a bounded request-local soft cap when policy backend is unavailable", async () => {
    const unavailableStore: ToolLimitStore = {
      async checkAndConsume() {
        throw new ToolPolicyError(
          "TOOL_POLICY_UNAVAILABLE: Tool policy service is unavailable. Retry in 30 seconds.",
          {
            code: "TOOL_POLICY_UNAVAILABLE",
            retryAfterSeconds: 30,
          }
        )
      },
    }

    const probeError = await probeToolBudget({
      store: unavailableStore,
      keyMode: "platform",
      toolName: "web_search",
    }).catch((err) => err)
    expect(isPolicyUnavailableError(probeError)).toBe(true)

    const softCap = createRequestLocalToolSoftCap({ maxCallsPerTool: 2 })
    expect(softCap.getSnapshot("web_search")).toMatchObject({
      used: 0,
      remaining: 2,
      maxCalls: 2,
    })

    expect(softCap.recordCall("web_search")).toMatchObject({
      used: 1,
      remaining: 1,
      maxCalls: 2,
    })
    expect(softCap.recordCall("web_search")).toMatchObject({
      used: 2,
      remaining: 0,
      maxCalls: 2,
    })
  })

  it("supports non-consuming budget probes for provider-executed tools", async () => {
    const store = new InMemoryToolLimitStore(() => 6_000_000)
    const guard = createToolPolicyGuard({
      store,
      keyMode: "platform",
      actorKey: "user:user_provider_probe",
    })
    const budget = getToolBudgetPolicy("web_search", "platform")

    for (let i = 0; i < 10; i++) {
      const probe = await probeToolBudget({
        store,
        keyMode: "platform",
        actorKey: "user:user_provider_probe",
        toolName: "web_search",
      })
      expect(probe.allowed).toBe(true)
    }

    for (let i = 0; i < budget.maxCount; i++) {
      await expect(
        guard.enforceToolBudget("web_search")
      ).resolves.toBeUndefined()
    }

    const exhaustedProbe = await probeToolBudget({
      store,
      keyMode: "platform",
      actorKey: "user:user_provider_probe",
      toolName: "web_search",
    })
    expect(exhaustedProbe.allowed).toBe(false)
  })

  it("degrades non-built-in budget enforcement with bounded request-local caps", async () => {
    const unavailable = () =>
      new ToolPolicyError(
        "TOOL_POLICY_UNAVAILABLE: Tool policy service is unavailable. Retry in 30 seconds.",
        {
          code: "TOOL_POLICY_UNAVAILABLE",
          retryAfterSeconds: 30,
        }
      )

    const events: Array<{ type: string }> = []
    const enforce = createOutageTolerantToolBudgetEnforcer({
      enforceToolBudget: async () => {
        throw unavailable()
      },
      keyMode: "platform",
      maxCallsPerTool: 2,
      onEvent: (event) => {
        events.push({ type: event.type })
      },
    })

    await expect(enforce("web_search")).resolves.toBeUndefined()
    await expect(enforce("web_search")).resolves.toBeUndefined()
    await expect(enforce("web_search")).rejects.toMatchObject({
      code: "TOOL_BUDGET_EXCEEDED",
      budgetDenied: true,
    })

    expect(events.map((event) => event.type)).toEqual([
      "degraded_allow",
      "degraded_allow",
      "degraded_block",
    ])
  })

  it("emits degraded recovery once policy backend is available again", async () => {
    let callCount = 0
    const events: Array<{ type: string }> = []
    const enforce = createOutageTolerantToolBudgetEnforcer({
      enforceToolBudget: async () => {
        callCount++
        if (callCount === 1) {
          throw new ToolPolicyError(
            "TOOL_POLICY_UNAVAILABLE: Tool policy service is unavailable. Retry in 30 seconds.",
            {
              code: "TOOL_POLICY_UNAVAILABLE",
              retryAfterSeconds: 30,
            }
          )
        }
      },
      keyMode: "platform",
      maxCallsPerTool: 2,
      onEvent: (event) => {
        events.push({ type: event.type })
      },
    })

    await expect(enforce("web_search")).resolves.toBeUndefined()
    await expect(enforce("web_search")).resolves.toBeUndefined()
    expect(events.map((event) => event.type)).toEqual([
      "degraded_allow",
      "recovered",
    ])
  })

  it("keeps fail-closed behavior for non-policy errors", async () => {
    const enforce = createOutageTolerantToolBudgetEnforcer({
      enforceToolBudget: async () => {
        throw new Error("unexpected policy backend failure")
      },
      keyMode: "platform",
      maxCallsPerTool: 2,
    })

    await expect(enforce("web_search")).rejects.toThrow(
      "unexpected policy backend failure"
    )
  })
})
