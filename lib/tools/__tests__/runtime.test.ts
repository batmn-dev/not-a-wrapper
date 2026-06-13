import { describe, it, expect, vi, beforeEach } from "vitest"

// =============================================================================
// Module mocks — must be declared before importing the runtime. The loader
// seams are mocked; the policy module keeps its real degradation logic with
// only the Convex-backed limit store swapped for a controllable fake.
// =============================================================================

const mocks = vi.hoisted(() => ({
  getProviderTools: vi.fn(),
  getThirdPartyTools: vi.fn(),
  getContentExtractionTools: vi.fn(),
  loadUserMcpTools: vi.fn(),
  getEffectiveToolKeyWithMode: vi.fn(),
  // Swapped per test; the real policy guard/probe/soft-cap run against it.
  store: null as unknown as {
    state?: { available: boolean }
    checkAndConsume: (input: { keyMode: string; consume?: boolean }) => Promise<{
      allowed: boolean
      remaining: number
    }>
  },
  // When true, the (otherwise real) tracing wrapper throws — simulating a
  // failure after MCP clients have opened.
  failTracing: false,
}))

vi.mock("@/lib/posthog", () => ({
  getPostHogClient: () => null,
}))

vi.mock("@/lib/tools/provider", () => ({
  getProviderTools: mocks.getProviderTools,
}))

vi.mock("@/lib/tools/third-party", () => ({
  getThirdPartyTools: mocks.getThirdPartyTools,
  getContentExtractionTools: mocks.getContentExtractionTools,
}))

vi.mock("@/lib/mcp/load-tools", () => ({
  loadUserMcpTools: mocks.loadUserMcpTools,
}))

vi.mock("@/lib/user-keys", () => ({
  getEffectiveToolKeyWithMode: mocks.getEffectiveToolKeyWithMode,
}))

vi.mock("@/lib/tools/policy", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/tools/policy")>(
      "@/lib/tools/policy"
    )
  return {
    ...actual,
    createConvexToolLimitStore: () => mocks.store,
  }
})

vi.mock("@/lib/tools/utils", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/tools/utils")>(
      "@/lib/tools/utils"
    )
  return {
    ...actual,
    wrapToolsWithTracing: (...args: Parameters<typeof actual.wrapToolsWithTracing>) => {
      if (mocks.failTracing) throw new Error("tracing wrap failed")
      return actual.wrapToolsWithTracing(...args)
    },
  }
})

// =============================================================================
// Imports after mocks
// =============================================================================

import {
  prepareToolRuntime,
  type PrepareToolRuntimeOptions,
  type ToolOutcome,
  type ToolRuntime,
} from "../runtime"
import { ToolPolicyError } from "../policy"
import type { ToolMetadata } from "../types"
import type { ServerInfo } from "@/lib/mcp/load-tools"

// =============================================================================
// Fixtures
// =============================================================================

function meta(overrides: Partial<ToolMetadata> = {}): ToolMetadata {
  return {
    displayName: "Tool",
    source: "builtin",
    serviceName: "Provider",
    readOnly: true,
    idempotent: true,
    ...overrides,
  }
}

function serverInfo(overrides: Partial<ServerInfo> = {}): ServerInfo {
  return {
    displayName: "mcp_tool",
    serverName: "MCP Server",
    serverId: "server_1",
    policyHintsTrusted: false,
    ...overrides,
  }
}

/** Store that always allows — the policy service is healthy. */
function availableStore() {
  return {
    checkAndConsume: vi.fn(async () => ({ allowed: true, remaining: 99 })),
  }
}

/** Store that throws TOOL_POLICY_UNAVAILABLE until `state.available` flips. */
function outageStore() {
  const state = { available: false }
  return {
    state,
    checkAndConsume: vi.fn(async (input: { keyMode: string }) => {
      if (!state.available) {
        throw new ToolPolicyError("policy service unavailable", {
          code: "TOOL_POLICY_UNAVAILABLE",
          keyMode: input.keyMode as "platform" | "byok",
        })
      }
      return { allowed: true, remaining: 99 }
    }),
  }
}

function baseOptions(
  overrides: Partial<PrepareToolRuntimeOptions> = {}
): PrepareToolRuntimeOptions {
  return {
    isAuthenticated: false,
    convexToken: undefined,
    anonymousId: "guest_1",
    provider: "openai",
    apiKey: "sk-test",
    providerToolKeyMode: "byok",
    modelTools: true,
    enableSearch: true,
    logContext: {
      requestId: "req_1",
      chatId: "chat_1",
      userId: "user_1",
      model: "test-model",
    },
    ...overrides,
  }
}

/**
 * Drive the runtime's step gate via `prepareStep`, asserting it exists. Every
 * scenario that calls this loads tools, so `prepareStep` is always defined here.
 */
async function activeToolsForStep(
  runtime: ToolRuntime,
  stepNumber: number
): Promise<string[]> {
  const { prepareStep } = runtime
  if (!prepareStep) throw new Error("expected prepareStep to be defined")
  return (await prepareStep({ stepNumber })).activeTools
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.failTracing = false
  mocks.store = availableStore()
  mocks.getProviderTools.mockResolvedValue({ tools: {}, metadata: new Map() })
  mocks.getThirdPartyTools.mockResolvedValue({ tools: {}, metadata: new Map() })
  mocks.getContentExtractionTools.mockResolvedValue({
    tools: {},
    metadata: new Map(),
  })
  mocks.loadUserMcpTools.mockResolvedValue({
    tools: {},
    clients: [],
    toolServerMap: new Map(),
    failedServerCount: 0,
  })
  mocks.getEffectiveToolKeyWithMode.mockResolvedValue({
    key: "exa_key",
    keyMode: "platform",
  })
})

// =============================================================================
// Tests
// =============================================================================

describe("prepareToolRuntime — Tool layer loading & gating", () => {
  it("anonymous user: search tools load, MCP never loads", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta({ source: "builtin" })]]),
    })

    const runtime = await prepareToolRuntime(
      baseOptions({ isAuthenticated: false, convexToken: undefined })
    )

    expect(mocks.getProviderTools).toHaveBeenCalledWith("openai", "sk-test")
    expect(mocks.loadUserMcpTools).not.toHaveBeenCalled()
    expect(Object.keys(runtime.tools)).toContain("web_search")
    expect(runtime.toolCounts.mcp).toBe(0)
    expect(runtime.policySummary.searchInjected).toBe(true)
    expect(runtime.policySummary.userTier).toBe("anonymous")
  })

  it("Layer 1 provided search → Layer 2 search is skipped", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta()]]),
    })

    const runtime = await prepareToolRuntime(baseOptions())

    expect(mocks.getThirdPartyTools).not.toHaveBeenCalled()
    expect(runtime.toolCounts.builtIn).toBe(1)
    expect(runtime.toolCounts.thirdParty).toBe(0)
  })

  it("Layer 1 empty → Layer 2 search loads", async () => {
    mocks.getProviderTools.mockResolvedValue({ tools: {}, metadata: new Map() })
    mocks.getThirdPartyTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta({ source: "third-party" })]]),
    })

    const runtime = await prepareToolRuntime(baseOptions())

    expect(mocks.getThirdPartyTools).toHaveBeenCalledWith({
      skipSearch: false,
      exaKey: "exa_key",
    })
    expect(runtime.toolCounts.builtIn).toBe(0)
    expect(runtime.toolCounts.thirdParty).toBe(1)
    expect(Object.keys(runtime.tools)).toContain("web_search")
  })

  it("content extraction loads independent of search gating (extract capability + Exa key)", async () => {
    mocks.getContentExtractionTools.mockResolvedValue({
      tools: { extract_content: {} },
      metadata: new Map([
        ["extract_content", meta({ source: "third-party", readOnly: true })],
      ]),
    })

    // enableSearch:false → no Layer 1 / Layer 2 search at all.
    const runtime = await prepareToolRuntime(
      baseOptions({ enableSearch: false })
    )

    expect(mocks.getProviderTools).not.toHaveBeenCalled()
    expect(mocks.getThirdPartyTools).not.toHaveBeenCalled()
    expect(mocks.getContentExtractionTools).toHaveBeenCalledWith(
      expect.objectContaining({ exaKey: "exa_key" })
    )
    expect(runtime.policySummary.searchInjected).toBe(false)
    expect(runtime.toolCounts.content).toBe(1)
    expect(Object.keys(runtime.tools)).toContain("extract_content")
  })

  it("late step (stepNumber > threshold) returns only late-step-safe tools", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {}, stateful_tool: {} },
      metadata: new Map([
        ["web_search", meta({ readOnly: true, idempotent: true })],
        ["stateful_tool", meta({ readOnly: false, idempotent: false })],
      ]),
    })

    const runtime = await prepareToolRuntime(baseOptions())

    const earlyTools = await activeToolsForStep(runtime, 1)
    expect(earlyTools).toContain("web_search")
    expect(earlyTools).toContain("stateful_tool")

    // PREPARE_STEP_THRESHOLD is 3; step 4 is a late step.
    const lateTools = await activeToolsForStep(runtime, 4)
    expect(lateTools).toEqual(["web_search"])
  })

  it("prepareStep is undefined when no tools loaded, defined when tools exist", async () => {
    // enableSearch:false + no Exa content + unauthenticated → empty merged set.
    const empty = await prepareToolRuntime(baseOptions({ enableSearch: false }))
    expect(empty.hasTools).toBe(false)
    expect(empty.prepareStep).toBeUndefined()

    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta()]]),
    })
    const withTools = await prepareToolRuntime(baseOptions())
    expect(withTools.hasTools).toBe(true)
    expect(withTools.prepareStep).toBeDefined()
    expect(await activeToolsForStep(withTools, 1)).toContain("web_search")
  })
})

describe("prepareToolRuntime — Tool budget degradation & recovery", () => {
  it("built-in budget degrades to a request-local soft cap during a policy outage, then recovers", async () => {
    const store = outageStore()
    mocks.store = store
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta({ readOnly: true })]]),
    })
    // No Exa key → no Layer 2 tools to muddy the built-in budget assertions.
    mocks.getEffectiveToolKeyWithMode.mockResolvedValue({
      key: undefined,
      keyMode: undefined,
    })

    const runtime = await prepareToolRuntime(baseOptions())
    expect(runtime.toolCounts.builtIn).toBe(1)

    // Outage, soft cap not yet consumed → tool allowed via the soft cap.
    expect(await activeToolsForStep(runtime, 1)).toContain("web_search")

    // Consume the soft cap (PREPARE_STEP_THRESHOLD = 3 calls).
    await runtime.onStepFinish({
      stepNumber: 1,
      toolCalls: [{ toolCallId: "call_1", toolName: "web_search" }],
    })
    await runtime.onStepFinish({
      stepNumber: 2,
      toolCalls: [{ toolCallId: "call_2", toolName: "web_search" }],
    })
    await runtime.onStepFinish({
      stepNumber: 3,
      toolCalls: [{ toolCallId: "call_3", toolName: "web_search" }],
    })

    // Soft cap exhausted while policy is still unavailable → tool disabled.
    expect(await activeToolsForStep(runtime, 1)).not.toContain("web_search")

    // Policy service recovers → budgeting resumes and the tool is allowed again.
    store.state.available = true
    expect(await activeToolsForStep(runtime, 1)).toContain("web_search")
  })

  it("built-in budget fails closed on a non-outage store error and stays disabled", async () => {
    const checkAndConsume = vi.fn<
      () => Promise<{ allowed: boolean; remaining: number }>
    >(async () => {
      throw new Error("unexpected store failure")
    })
    mocks.store = { checkAndConsume }
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta({ readOnly: true })]]),
    })
    mocks.getEffectiveToolKeyWithMode.mockResolvedValue({
      key: undefined,
      keyMode: undefined,
    })

    const runtime = await prepareToolRuntime(baseOptions())

    // Non-TOOL_POLICY_UNAVAILABLE error → fail closed, no soft-cap fallback.
    expect(await activeToolsForStep(runtime, 1)).not.toContain("web_search")

    // Exhausted set short-circuits: the store is not probed again, and the
    // tool stays disabled even though the store would now succeed.
    checkAndConsume.mockImplementation(async () => ({
      allowed: true,
      remaining: 99,
    }))
    expect(await activeToolsForStep(runtime, 2)).not.toContain("web_search")
    expect(checkAndConsume).toHaveBeenCalledTimes(1)
  })

  it("onStepFinish is a no-op for non-built-in tools", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta()]]),
    })

    const runtime = await prepareToolRuntime(baseOptions())

    // A name the runtime never classified as built-in must not touch the store.
    await expect(
      runtime.onStepFinish({
        stepNumber: 1,
        toolCalls: [{ toolCallId: "call_1", toolName: "not_a_tool" }],
      })
    ).resolves.toBeUndefined()
    expect(mocks.store.checkAndConsume).not.toHaveBeenCalled()
  })

  it("onStepFinish with an empty toolCalls array is a no-op", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta()]]),
    })

    const runtime = await prepareToolRuntime(baseOptions())

    // Spy after preparation so the prepare-time policy logs don't count.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await expect(
        runtime.onStepFinish({ stepNumber: 1, toolCalls: [] })
      ).resolves.toBeUndefined()
      // No budget probe/consume, and no degraded/recovered/denied logs.
      expect(mocks.store.checkAndConsume).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
      expect(log).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      log.mockRestore()
    }
  })
})

describe("prepareToolRuntime — naming governance", () => {
  it("name collision across layers: MCP winner kept, built-in loser dropped, metadata consistent", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { shared_tool: {} },
      metadata: new Map([["shared_tool", meta({ source: "builtin" })]]),
    })
    mocks.loadUserMcpTools.mockResolvedValue({
      tools: { shared_tool: {} },
      clients: [],
      toolServerMap: new Map([
        ["shared_tool", serverInfo({ displayName: "shared_tool" })],
      ]),
      failedServerCount: 0,
    })

    const runtime = await prepareToolRuntime(
      baseOptions({ isAuthenticated: true, convexToken: "token" })
    )

    // MCP wins (later in layer precedence); built-in loser is dropped.
    expect(Object.keys(runtime.tools)).toEqual(["shared_tool"])
    expect(runtime.toolCounts.builtIn).toBe(0)
    expect(runtime.toolCounts.mcp).toBe(1)
    expect(runtime.metadata.source("shared_tool")).toBe("mcp")
    expect(runtime.metadata.get("shared_tool")?.source).toBe("mcp")
  })
})

describe("prepareToolRuntime — runtime approvals", () => {
  it("applyDurableApprovals wraps only approval-needing tools and is idempotent", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta({ readOnly: true })]]),
    })
    mocks.loadUserMcpTools.mockResolvedValue({
      tools: { risky_tool: {} },
      clients: [],
      toolServerMap: new Map([
        // Untrusted MCP hints → the tool needs runtime approval.
        ["risky_tool", serverInfo({ displayName: "risky_tool" })],
      ]),
      failedServerCount: 0,
    })

    const runtime = await prepareToolRuntime(
      baseOptions({ isAuthenticated: true, convexToken: "token" })
    )

    expect(runtime.approvalFor("web_search")?.needsApproval).toBe(false)
    expect(runtime.approvalFor("risky_tool")?.needsApproval).toBe(true)

    const before = runtime.tools
    const safeBefore = before.web_search
    const riskyBefore = before.risky_tool

    runtime.applyDurableApprovals()
    const afterFirst = runtime.tools

    // Approval wrapping replaced the merged set...
    expect(afterFirst).not.toBe(before)
    // ...but a tool that needs no approval keeps its original descriptor.
    expect(afterFirst.web_search).toBe(safeBefore)
    // ...and the approval-needing tool gained a needsApproval predicate.
    expect(afterFirst.risky_tool).not.toBe(riskyBefore)
    expect(
      typeof (afterFirst.risky_tool as { needsApproval?: unknown }).needsApproval
    ).toBe("function")

    // Idempotent: a second call is a no-op (same object identity).
    runtime.applyDurableApprovals()
    expect(runtime.tools).toBe(afterFirst)
  })
})

describe("prepareToolRuntime — MCP client lifecycle", () => {
  it("dispose() closes all MCP clients and is safe to call twice", async () => {
    const close1 = vi.fn().mockResolvedValue(undefined)
    const close2 = vi.fn().mockResolvedValue(undefined)
    mocks.loadUserMcpTools.mockResolvedValue({
      tools: { mcp_tool: {} },
      clients: [{ close: close1 }, { close: close2 }],
      toolServerMap: new Map([["mcp_tool", serverInfo()]]),
      failedServerCount: 0,
    })

    const runtime = await prepareToolRuntime(
      baseOptions({ isAuthenticated: true, convexToken: "token" })
    )

    expect(runtime.mcpClientCount).toBe(2)

    await runtime.dispose()
    await runtime.dispose()

    expect(close1).toHaveBeenCalledTimes(1)
    expect(close2).toHaveBeenCalledTimes(1)
  })

  it("closes MCP clients when preparation fails after they open", async () => {
    mocks.failTracing = true
    const close = vi.fn().mockResolvedValue(undefined)
    mocks.loadUserMcpTools.mockResolvedValue({
      tools: { mcp_tool: {} },
      clients: [{ close }],
      toolServerMap: new Map([["mcp_tool", serverInfo()]]),
      failedServerCount: 0,
    })
    // A content tool makes the tracing wrapper run (and throw) after MCP loaded.
    mocks.getContentExtractionTools.mockResolvedValue({
      tools: { extract_content: {} },
      metadata: new Map([
        ["extract_content", meta({ source: "third-party" })],
      ]),
    })

    const onMcpClientsOpened = vi.fn()
    await expect(
      prepareToolRuntime(
        baseOptions({
          isAuthenticated: true,
          convexToken: "token",
          onMcpClientsOpened,
        })
      )
    ).rejects.toThrow("tracing wrap failed")

    expect(close).toHaveBeenCalledTimes(1)
    // The telemetry hook still reported the opened-client count, so the
    // route's catch path can log mcpClientCount as the pre-runtime code did.
    expect(onMcpClientsOpened).toHaveBeenCalledWith(1)
  })
})

// =============================================================================
// Tool outcomes — recorded at step finish, dispatched through injected sinks.
// The interface is the test surface: outcomes are observed through in-memory
// sinks (the seam's test adapter) and outcomeSummary(), never via internals.
// =============================================================================

describe("prepareToolRuntime — Tool outcome recording", () => {
  it("assembles one outcome per call with unified metadata and dispatches to every sink", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([
        [
          "web_search",
          meta({
            displayName: "Web Search",
            source: "builtin",
            serviceName: "OpenAI",
            estimatedCostPer1k: 25,
          }),
        ],
      ]),
    })

    const sinkA: ToolOutcome[] = []
    const sinkB: ToolOutcome[] = []
    const runtime = await prepareToolRuntime(
      baseOptions({
        outcomeSinks: [(o) => sinkA.push(o), (o) => sinkB.push(o)],
      })
    )

    await runtime.onStepFinish({
      stepNumber: 2,
      toolCalls: [
        { toolCallId: "call_1", toolName: "web_search", input: { q: "hi" } },
      ],
      toolResults: [{ toolCallId: "call_1", output: { answer: "ok" } }],
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "tool-calls",
    })

    expect(sinkA).toHaveLength(1)
    expect(sinkB).toEqual(sinkA)
    const outcome = sinkA[0]
    expect(outcome).toMatchObject({
      toolCallId: "call_1",
      toolKey: "web_search",
      displayName: "Web Search",
      source: "builtin",
      serviceName: "OpenAI",
      success: true,
      estimatedCostPer1k: 25,
      stepNumber: 2,
      finishReason: "tool-calls",
      inputTokens: 10,
      outputTokens: 5,
      timedOut: false,
    })
    expect(outcome.inputPreview).toBe(JSON.stringify({ q: "hi" }))
    expect(outcome.outputPreview).toBe(JSON.stringify({ answer: "ok" }))
    expect(outcome.mcpServer).toBeUndefined()
  })

  it("preserves valid falsy output previews", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([
        [
          "web_search",
          meta({
            displayName: "Web Search",
            source: "builtin",
            serviceName: "OpenAI",
          }),
        ],
      ]),
    })

    const sink: ToolOutcome[] = []
    const runtime = await prepareToolRuntime(
      baseOptions({
        outcomeSinks: [(outcome) => sink.push(outcome)],
      })
    )

    await runtime.onStepFinish({
      stepNumber: 2,
      toolCalls: [
        { toolCallId: "call_false", toolName: "web_search" },
        { toolCallId: "call_zero", toolName: "web_search" },
        { toolCallId: "call_empty", toolName: "web_search" },
        { toolCallId: "call_null", toolName: "web_search" },
      ],
      toolResults: [
        { toolCallId: "call_false", output: false },
        { toolCallId: "call_zero", output: 0 },
        { toolCallId: "call_empty", output: "" },
        { toolCallId: "call_null", output: null },
      ],
      finishReason: "tool-calls",
    })

    expect(sink.map((outcome) => outcome.outputPreview)).toEqual([
      "false",
      "0",
      '""',
      "null",
    ])
  })

  it("serializes non-JSON-safe outcome previews without breaking onStepFinish", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([
        [
          "web_search",
          meta({
            displayName: "Web Search",
            source: "builtin",
            serviceName: "OpenAI",
          }),
        ],
      ]),
    })

    const sink: ToolOutcome[] = []
    const runtime = await prepareToolRuntime(
      baseOptions({
        outcomeSinks: [(outcome) => sink.push(outcome)],
      })
    )
    const input = { q: "hi", count: BigInt(1) } as {
      q: string
      count: bigint
      self?: unknown
    }
    input.self = input

    await expect(
      runtime.onStepFinish({
        stepNumber: 2,
        toolCalls: [{ toolCallId: "call_1", toolName: "web_search", input }],
        toolResults: [
          {
            toolCallId: "call_1",
            output: { answer: "ok", count: BigInt(2), input },
          },
        ],
        finishReason: "tool-calls",
      })
    ).resolves.toBeUndefined()

    expect(sink).toHaveLength(1)
    expect(sink[0].inputPreview).toBe(
      '{"q":"hi","count":"1","self":"[Circular]"}'
    )
    expect(sink[0].outputPreview).toBe(
      '{"answer":"ok","count":"2","input":{"q":"hi","count":"1","self":"[Circular]"}}'
    )
  })

  it("resolves MCP tools to the original server tool name and carries mcpServer", async () => {
    mocks.loadUserMcpTools.mockResolvedValue({
      tools: { mcp_github_create_issue: {} },
      clients: [],
      toolServerMap: new Map([
        [
          "mcp_github_create_issue",
          serverInfo({
            displayName: "create_issue",
            serverName: "GitHub",
            serverId: "server_42",
          }),
        ],
      ]),
      failedServerCount: 0,
    })

    const recorded: ToolOutcome[] = []
    const runtime = await prepareToolRuntime(
      baseOptions({
        isAuthenticated: true,
        convexToken: "token",
        outcomeSinks: [(o) => recorded.push(o)],
      })
    )

    await runtime.onStepFinish({
      stepNumber: 1,
      toolCalls: [
        { toolCallId: "call_1", toolName: "mcp_github_create_issue", input: {} },
      ],
      toolResults: [{ toolCallId: "call_1", output: "created" }],
    })

    expect(recorded[0]).toMatchObject({
      toolKey: "mcp_github_create_issue",
      displayName: "create_issue",
      source: "mcp",
      serviceName: "GitHub",
      mcpServer: {
        serverId: "server_42",
        serverName: "GitHub",
        displayName: "create_issue",
      },
      success: true,
    })
  })

  it("records unidentifiable tools as source unknown instead of skipping them", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta()]]),
    })

    const recorded: ToolOutcome[] = []
    const runtime = await prepareToolRuntime(
      baseOptions({ outcomeSinks: [(o) => recorded.push(o)] })
    )

    await runtime.onStepFinish({
      stepNumber: 1,
      toolCalls: [{ toolCallId: "call_1", toolName: "mystery_tool", input: {} }],
      toolResults: [],
    })

    expect(recorded[0]).toMatchObject({
      toolKey: "mystery_tool",
      displayName: "mystery_tool",
      source: "unknown",
      serviceName: "unknown",
      success: false,
    })
  })

  it("outcomeSummary accumulates totals, failures, timeouts, and budget denials across steps", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta()]]),
    })

    const runtime = await prepareToolRuntime(baseOptions())
    expect(runtime.outcomeSummary()).toEqual({
      totalToolCalls: 0,
      failedToolCalls: 0,
      timeoutToolCalls: 0,
      budgetDeniedToolCalls: 0,
    })

    await runtime.onStepFinish({
      stepNumber: 1,
      toolCalls: [
        { toolCallId: "call_1", toolName: "web_search", input: {} },
        { toolCallId: "call_2", toolName: "web_search", input: {} },
      ],
      toolResults: [
        { toolCallId: "call_1", output: "ok" },
        // call_2: timeout signal in a string output, and isError set.
        { toolCallId: "call_2", output: "Request timed out", isError: true } as {
          toolCallId: string
          output?: unknown
        },
      ],
    })
    await runtime.onStepFinish({
      stepNumber: 2,
      // No result at all → failed.
      toolCalls: [{ toolCallId: "call_3", toolName: "web_search", input: {} }],
      toolResults: [],
    })

    expect(runtime.outcomeSummary()).toEqual({
      totalToolCalls: 3,
      failedToolCalls: 2,
      timeoutToolCalls: 1,
      budgetDeniedToolCalls: 0,
    })
  })

  it("a throwing sink is contained — other sinks still receive the outcome", async () => {
    mocks.getProviderTools.mockResolvedValue({
      tools: { web_search: {} },
      metadata: new Map([["web_search", meta()]]),
    })

    const recorded: ToolOutcome[] = []
    const runtime = await prepareToolRuntime(
      baseOptions({
        outcomeSinks: [
          () => {
            throw new Error("sink exploded")
          },
          (o) => recorded.push(o),
        ],
      })
    )

    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await expect(
        runtime.onStepFinish({
          stepNumber: 1,
          toolCalls: [{ toolCallId: "call_1", toolName: "web_search", input: {} }],
          toolResults: [{ toolCallId: "call_1", output: "ok" }],
        })
      ).resolves.toBeUndefined()
    } finally {
      error.mockRestore()
    }

    expect(recorded).toHaveLength(1)
    expect(runtime.outcomeSummary().totalToolCalls).toBe(1)
  })
})
