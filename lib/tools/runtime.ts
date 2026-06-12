// lib/tools/runtime.ts

import type { ToolSet } from "ai"
import { MCP_CONNECTION_TIMEOUT_MS, PREPARE_STEP_THRESHOLD } from "@/lib/config"
import { getPostHogClient } from "@/lib/posthog"
import type { ToolKeyMode } from "@/lib/user-keys"
import {
  loadUserMcpTools,
  type LoadToolsResult,
  type ServerInfo,
} from "@/lib/mcp/load-tools"
import {
  enforceToolNamingGovernance,
  type ToolLayerMap,
} from "@/lib/tools/naming"
import {
  filterMetadataMapByPolicy,
  filterToolSetByPolicy,
  getActiveToolsForStep,
  resolveCapabilityPolicy,
  type CapabilityAxis,
  type CapabilityReasonCode,
  type KeyModeReasonCode,
  type ToolPolicyDecision,
  type ToolPolicyInput,
  type UserTier,
} from "@/lib/tools/capability-policy"
import {
  createToolMetadataResolver,
  type ToolMetadataResolver,
} from "@/lib/tools/metadata-resolver"
import { ToolTraceCollector, wrapMcpTools } from "@/lib/tools/mcp-wrapper"
import {
  getRuntimeToolApprovalDecision,
  type RuntimeToolApprovalDecision,
} from "@/lib/tools/runtime-approval"
import type { ToolCapabilities, ToolMetadata, ToolTrace } from "@/lib/tools/types"

/**
 * Tool runtime (see CONTEXT.md): everything a chat request needs to use tools,
 * prepared once per request and alive for the whole stream — the merged tool
 * set, per-tool metadata, step gating, and budget accounting.
 *
 * `prepareToolRuntime` is the single seam the chat route calls to load the three
 * Tool layers (Layer 1 provider-native, Layer 2 Exa search/content, Layer 3 MCP),
 * run both Capability policy phases, enforce Tool budget, apply naming
 * governance, and compute runtime-approval decisions. The four per-layer
 * metadata maps, the budget Sets, the enforcers, and the ToolTraceCollector
 * never escape this module.
 */

export type PrepareToolRuntimeOptions = {
  isAuthenticated: boolean
  convexToken: string | undefined
  anonymousId: string | undefined
  provider: string
  apiKey: string | undefined
  providerToolKeyMode: ToolKeyMode
  /** ModelConfig.tools — the model's declared capability switches. */
  modelTools: boolean | ToolCapabilities | undefined
  enableSearch: boolean
  logContext: {
    requestId: string
    chatId: string
    userId: string
    model: string
  }
}

/**
 * Read-only view of the Capability policy outcome for the telemetry block
 * (braintrust metadata ~1690–1708) and `enableSearch: shouldInjectSearch`.
 * Mirrors the phase-2 `toolPolicy` result.
 */
export type ToolRuntimePolicySummary = {
  capabilities: Required<ToolCapabilities>
  capabilityReasons: Record<CapabilityAxis, CapabilityReasonCode>
  userTier: UserTier
  keyMode: ToolKeyMode | undefined
  keyModeReason: KeyModeReasonCode
  totalTools: number
  earlyAllowedCount: number
  lateAllowedCount: number
  searchInjected: boolean
}

/** Per-layer tool counts for the telemetry block (braintrust ~1709–1719). */
export type ToolRuntimeToolCounts = {
  builtIn: number
  thirdParty: number
  content: number
  mcp: number
  total: number
}

/**
 * TRANSITIONAL surface — removed in commit 3.
 *
 * The stream-lifecycle hooks (`prepareStep` / `onStepFinish`) still live in the
 * route for now; they call these two methods so the budget state machine can
 * move behind the runtime without the route owning the hooks yet. Commit 3 gives
 * the runtime ownership of the hooks and deletes this surface.
 */
export type ToolRuntimeStepGate = {
  /**
   * Body of today's `prepareStep` (route.ts:1752–1791): the policy step gate +
   * built-in Tool budget probe + the one-time `tool_policy_step_gate` log.
   * Returns the tools that survive both policy gating and budget probing for
   * the given step.
   */
  activeToolsForStep(stepNumber: number): Promise<string[]>
  /**
   * Body of today's `onStepFinish` budget accounting (route.ts:1806–1850):
   * post-call `enforceToolBudget` for built-in (provider-executed) tools, with
   * degraded-recovery / degraded soft-cap / fail-closed logging. No-op for
   * non-built-in tools.
   */
  accountBuiltInCall(toolName: string): Promise<void>
}

export type ToolRuntime = {
  /** Merged ToolSet (filtered, traced, budget-wrapped). */
  readonly tools: ToolSet
  /** Whether any tools survived loading + policy + naming. */
  readonly hasTools: boolean
  /** The source-agnostic metadata resolver (commit 1). */
  readonly metadata: ToolMetadataResolver
  /** Per-tool-call trace lookup — replaces direct `traceCollector.get`. */
  traceFor(toolCallId: string): ToolTrace | undefined
  /** Read-only Capability policy summary for telemetry. */
  readonly policySummary: ToolRuntimePolicySummary
  /** Per-layer tool counts for telemetry. */
  readonly toolCounts: ToolRuntimeToolCounts
  /** Distinct MCP server count (by serverId) for telemetry. */
  readonly mcpServerCount: number
  /** Number of MCP clients opened — for the two `mcpClientCount` log sites. */
  readonly mcpClientCount: number
  /** Runtime-approval decisions, keyed by tool name (final tools). */
  readonly approvalDecisionsByToolName: ReadonlyMap<
    string,
    RuntimeToolApprovalDecision
  >
  /** Approval decision lookup for the persistence sites. */
  approvalFor(toolName: string): RuntimeToolApprovalDecision | undefined
  /**
   * Wrap `tools` with runtime-approval gating exactly once. Idempotent — a
   * second call is a no-op. Called by the route only when a durable run is
   * active (durableRunState is assigned after the tool block runs, so this
   * cannot be a `prepareToolRuntime` flag).
   */
  applyDurableApprovals(): void
  /** TRANSITIONAL — removed in commit 3. See {@link ToolRuntimeStepGate}. */
  readonly stepGate: ToolRuntimeStepGate
  /** Close all MCP clients. Idempotent; safe to call twice. */
  dispose(): Promise<void>
}

export async function prepareToolRuntime(
  options: PrepareToolRuntimeOptions
): Promise<ToolRuntime> {
  // MCP clients are tracked here so that if preparation throws after they open,
  // we still close them. The runtime object is never returned on failure, so its
  // dispose() can't reach them — this mirrors the chat route's prior cleanup,
  // which closed clients on a mid-block error via the early after() registration.
  const opened: LoadToolsResult["clients"] = []
  try {
    return await buildToolRuntime(options, opened)
  } catch (error) {
    await Promise.allSettled(opened.map((client) => client.close()))
    throw error
  }
}

async function buildToolRuntime(
  options: PrepareToolRuntimeOptions,
  opened: LoadToolsResult["clients"]
): Promise<ToolRuntime> {
  const {
    isAuthenticated,
    convexToken,
    anonymousId,
    provider,
    apiKey,
    providerToolKeyMode,
    modelTools,
    enableSearch,
    logContext,
  } = options
  const { requestId, chatId, userId, model } = logContext

  // ── MCP state owned by the runtime (closed via dispose()) ────────────────
  // `mcpClients` aliases `opened`: the load step pushes into it so the wrapper's
  // failure path and the returned dispose() see the same client list.
  const mcpClients = opened
  let mcpToolServerMap: LoadToolsResult["toolServerMap"] = new Map()

  // ── Tool layers ──────────────────────────────────────────────────────────
  let builtInTools: ToolSet = {} as ToolSet
  let builtInToolMetadata = new Map<string, ToolMetadata>()

  // -----------------------------------------------------------------------
  // Capability policy — phase 1 (search injection gating)
  // -----------------------------------------------------------------------
  const initialCapabilityPolicy = resolveCapabilityPolicy({
    modelTools,
    isAuthenticated,
  })
  const capabilities = initialCapabilityPolicy.capabilities
  const shouldInjectSearch = enableSearch && capabilities.search
  console.log(
    JSON.stringify({
      _tag: "tool_capability_policy",
      requestId,
      chatId,
      userId,
      model,
      userTier: initialCapabilityPolicy.userTier,
      capabilities: initialCapabilityPolicy.capabilities,
      capabilityReasons: initialCapabilityPolicy.capabilityReasons,
      keyModeReason: initialCapabilityPolicy.keyModeReason,
    })
  )

  // -----------------------------------------------------------------------
  // Tool layer 1 — provider-native tools
  // -----------------------------------------------------------------------
  if (shouldInjectSearch) {
    const { getProviderTools } = await import("@/lib/tools/provider")
    const providerResult = await getProviderTools(provider, apiKey)
    builtInTools = providerResult.tools
    builtInToolMetadata = providerResult.metadata
  }

  // -----------------------------------------------------------------------
  // Exa API key resolution (shared by Layer 2 capabilities)
  // -----------------------------------------------------------------------
  let resolvedExaKey: string | undefined
  let resolvedExaKeyMode: ToolKeyMode | undefined
  const { getEffectiveToolKeyWithMode } = await import("@/lib/user-keys")
  const resolvedExa = await getEffectiveToolKeyWithMode("exa", convexToken)
  resolvedExaKey = resolvedExa.key
  resolvedExaKeyMode = resolvedExa.keyMode

  // -----------------------------------------------------------------------
  // Tool budget — policy guards + outage-tolerant enforcers
  // -----------------------------------------------------------------------
  const {
    createOutageTolerantToolBudgetEnforcer,
    createConvexToolLimitStore,
    createRequestLocalToolSoftCap,
    createToolPolicyGuard,
    isPolicyUnavailableError,
    probeToolBudget,
  } = await import("@/lib/tools/policy")
  const toolLimitStore = createConvexToolLimitStore({
    convexToken,
    anonymousId,
  })
  const makePolicyGuard = (keyMode: ToolKeyMode) =>
    createToolPolicyGuard({ store: toolLimitStore, keyMode })

  const builtInPolicyGuard = makePolicyGuard(providerToolKeyMode)
  const mcpPolicyGuard = makePolicyGuard("platform")
  const exaPolicyGuard = resolvedExaKeyMode
    ? makePolicyGuard(resolvedExaKeyMode)
    : undefined

  const logOutageTolerantBudgetEvent = (
    source: "third-party" | "content" | "mcp",
    event: {
      type: "recovered" | "degraded_allow" | "degraded_block"
      toolName: string
      keyMode: ToolKeyMode
      retryAfterSeconds?: number
      snapshot?: {
        used: number
        remaining: number
        maxCalls: number
      }
      error?: string
    }
  ) => {
    if (event.type === "recovered") {
      console.warn(
        JSON.stringify({
          _tag: "tool_budget_gate_recovered",
          requestId,
          tool: event.toolName,
          source,
          keyMode: event.keyMode,
          action: "resume_policy_enforced_budgeting",
        })
      )
      return
    }

    console.warn(
      JSON.stringify({
        _tag: "tool_budget_gate_degraded",
        requestId,
        tool: event.toolName,
        source,
        keyMode: event.keyMode,
        policyUnavailable: true,
        usedCalls: event.snapshot?.used ?? null,
        remainingCalls: event.snapshot?.remaining ?? null,
        maxCalls: event.snapshot?.maxCalls ?? null,
        retryAfterSeconds: event.retryAfterSeconds ?? null,
        error: event.error ?? null,
        action:
          event.type === "degraded_allow"
            ? "allow_tool_with_request_local_soft_cap"
            : "disable_tool_for_remaining_request",
      })
    )
  }

  const thirdPartyBudgetEnforcer =
    exaPolicyGuard && resolvedExaKeyMode
      ? createOutageTolerantToolBudgetEnforcer({
          enforceToolBudget: (toolName) =>
            exaPolicyGuard.enforceToolBudget(toolName),
          keyMode: resolvedExaKeyMode,
          maxCallsPerTool: PREPARE_STEP_THRESHOLD,
          onEvent: (event) => logOutageTolerantBudgetEvent("third-party", event),
        })
      : undefined

  const contentBudgetEnforcer =
    exaPolicyGuard && resolvedExaKeyMode
      ? createOutageTolerantToolBudgetEnforcer({
          enforceToolBudget: (toolName) =>
            exaPolicyGuard.enforceToolBudget(toolName),
          keyMode: resolvedExaKeyMode,
          maxCallsPerTool: PREPARE_STEP_THRESHOLD,
          onEvent: (event) => logOutageTolerantBudgetEvent("content", event),
        })
      : undefined

  const mcpBudgetEnforcer = createOutageTolerantToolBudgetEnforcer({
    enforceToolBudget: (toolName) => mcpPolicyGuard.enforceToolBudget(toolName),
    keyMode: "platform",
    maxCallsPerTool: PREPARE_STEP_THRESHOLD,
    onEvent: (event) => logOutageTolerantBudgetEvent("mcp", event),
  })

  // -----------------------------------------------------------------------
  // Tool layer 2 — search fallback (Layer-1-XOR-Layer-2)
  // -----------------------------------------------------------------------
  let thirdPartyTools: ToolSet = {} as ToolSet
  let thirdPartyToolMetadata = new Map<string, ToolMetadata>()

  if (shouldInjectSearch) {
    const builtInHasSearch = Object.keys(builtInTools).length > 0

    if (!builtInHasSearch) {
      const { getThirdPartyTools } = await import("@/lib/tools/third-party")
      const thirdPartyResult = await getThirdPartyTools({
        skipSearch: false,
        exaKey: resolvedExaKey,
      })
      thirdPartyTools = thirdPartyResult.tools
      thirdPartyToolMetadata = thirdPartyResult.metadata
    }
  }

  // -----------------------------------------------------------------------
  // Tool layer 2 — content extraction (independent of search gating)
  // -----------------------------------------------------------------------
  let contentTools: ToolSet = {} as ToolSet
  let contentToolMetadata = new Map<string, ToolMetadata>()

  if (resolvedExaKey && capabilities.extract) {
    const { getContentExtractionTools } = await import("@/lib/tools/third-party")
    const contentResult = await getContentExtractionTools({
      exaKey: resolvedExaKey,
      policyGuard: exaPolicyGuard,
    })
    contentTools = contentResult.tools
    contentToolMetadata = contentResult.metadata
  }

  // -----------------------------------------------------------------------
  // Tool layer 3 — MCP tools
  // -----------------------------------------------------------------------
  let mcpTools: ToolSet = {} as ToolSet

  if (isAuthenticated && convexToken && capabilities.mcp) {
    const mcpLoadStart = Date.now()
    const mcpResult = await loadUserMcpTools(convexToken, {
      timeout: MCP_CONNECTION_TIMEOUT_MS,
    })
    mcpTools = mcpResult.tools as ToolSet
    mcpClients.push(...mcpResult.clients)
    mcpToolServerMap = mcpResult.toolServerMap

    // PostHog: MCP tool loading observability
    const phClientForMcp = getPostHogClient()
    if (phClientForMcp) {
      phClientForMcp.capture({
        distinctId: userId,
        event: "mcp_tool_load",
        properties: {
          serverCount: mcpResult.clients.length,
          toolCount: Object.keys(mcpResult.tools).length,
          failedServers: mcpResult.failedServerCount,
          loadTimeMs: Date.now() - mcpLoadStart,
        },
      })
    }
    // NOTE: MCP cleanup is NOT registered here. The runtime owns the clients
    // and exposes dispose(); the route registers `after(() => runtime.dispose())`.
  }

  // -----------------------------------------------------------------------
  // Capability policy — phase 2 (per-tool decisions on the pre-filter maps)
  // -----------------------------------------------------------------------
  const toolPolicyInputs: ToolPolicyInput[] = [
    ...Object.keys(builtInTools).map((toolName) => {
      const meta = builtInToolMetadata.get(toolName)
      return {
        toolName,
        source: meta?.source ?? "builtin",
        capability: "search" as const,
        readOnly: meta?.readOnly,
        destructive: meta?.destructive,
        idempotent: meta?.idempotent,
        openWorld: meta?.openWorld,
      }
    }),
    ...Object.keys(thirdPartyTools).map((toolName) => {
      const meta = thirdPartyToolMetadata.get(toolName)
      return {
        toolName,
        source: meta?.source ?? "third-party",
        capability: "search" as const,
        readOnly: meta?.readOnly,
        destructive: meta?.destructive,
        idempotent: meta?.idempotent,
        openWorld: meta?.openWorld,
      }
    }),
    ...Object.keys(contentTools).map((toolName) => {
      const meta = contentToolMetadata.get(toolName)
      return {
        toolName,
        source: meta?.source ?? "third-party",
        capability: "extract" as const,
        readOnly: meta?.readOnly,
        destructive: meta?.destructive,
        idempotent: meta?.idempotent,
        openWorld: meta?.openWorld,
      }
    }),
    ...Object.keys(mcpTools).map((toolName) => {
      const info = mcpToolServerMap.get(toolName)
      const policyHintsTrusted = info?.policyHintsTrusted === true
      return {
        toolName,
        source: "mcp" as const,
        capability: "mcp" as const,
        riskHintsTrusted: policyHintsTrusted,
        readOnly: policyHintsTrusted ? info?.readOnly : undefined,
        destructive: policyHintsTrusted ? info?.destructive : undefined,
        idempotent: policyHintsTrusted ? info?.idempotent : undefined,
        openWorld: policyHintsTrusted ? info?.openWorld : undefined,
      }
    }),
  ]

  const toolPolicy = resolveCapabilityPolicy({
    modelTools,
    isAuthenticated,
    keyMode: resolvedExaKeyMode,
    tools: toolPolicyInputs,
  })

  const summarizeReasonCounts = (
    decisions: ToolPolicyDecision[],
    selector: (decision: ToolPolicyDecision) => string
  ) => {
    const counts: Record<string, number> = {}
    for (const decision of decisions) {
      const reason = selector(decision)
      counts[reason] = (counts[reason] ?? 0) + 1
    }
    return counts
  }

  console.log(
    JSON.stringify({
      _tag: "tool_policy_matrix",
      requestId,
      chatId,
      userId,
      model,
      userTier: toolPolicy.userTier,
      keyMode: toolPolicy.keyMode ?? null,
      keyModeReason: toolPolicy.keyModeReason,
      capabilities: toolPolicy.capabilities,
      capabilityReasons: toolPolicy.capabilityReasons,
      totalTools: toolPolicy.toolDecisions.length,
      earlyAllowedCount: toolPolicy.earlyToolNames.length,
      lateAllowedCount: toolPolicy.lateToolNames.length,
      earlyReasonCounts: summarizeReasonCounts(
        toolPolicy.toolDecisions,
        (decision) => decision.earlyReasonCode
      ),
      lateReasonCounts: summarizeReasonCounts(
        toolPolicy.toolDecisions,
        (decision) => decision.lateReasonCode
      ),
    })
  )

  // Eight policy filter passes (tools + metadata, per layer).
  builtInTools = filterToolSetByPolicy(builtInTools, toolPolicy)
  thirdPartyTools = filterToolSetByPolicy(thirdPartyTools, toolPolicy)
  contentTools = filterToolSetByPolicy(contentTools, toolPolicy)
  mcpTools = filterToolSetByPolicy(mcpTools, toolPolicy)

  builtInToolMetadata = filterMetadataMapByPolicy(builtInToolMetadata, toolPolicy)
  thirdPartyToolMetadata = filterMetadataMapByPolicy(
    thirdPartyToolMetadata,
    toolPolicy
  )
  contentToolMetadata = filterMetadataMapByPolicy(contentToolMetadata, toolPolicy)
  mcpToolServerMap = filterMetadataMapByPolicy(mcpToolServerMap, toolPolicy)

  // -----------------------------------------------------------------------
  // Tracing + MCP wrapping
  // -----------------------------------------------------------------------
  const traceCollector = new ToolTraceCollector()

  if (Object.keys(mcpTools).length > 0) {
    mcpTools = wrapMcpTools(mcpTools, {
      toolServerMap: mcpToolServerMap,
      traceCollector,
      requestId,
      enforceToolBudget: async (toolName) => {
        await mcpBudgetEnforcer(toolName)
      },
    }) as ToolSet
  }

  const { wrapToolsWithTracing } = await import("@/lib/tools/utils")
  if (Object.keys(thirdPartyTools).length > 0) {
    thirdPartyTools = wrapToolsWithTracing(
      thirdPartyTools,
      traceCollector,
      requestId,
      async (toolName) => {
        if (!thirdPartyBudgetEnforcer) return
        await thirdPartyBudgetEnforcer(toolName)
      },
      thirdPartyToolMetadata
    )
  }
  if (Object.keys(contentTools).length > 0) {
    contentTools = wrapToolsWithTracing(
      contentTools,
      traceCollector,
      requestId,
      async (toolName) => {
        if (!contentBudgetEnforcer) return
        await contentBudgetEnforcer(toolName)
      },
      contentToolMetadata
    )
  }

  // -----------------------------------------------------------------------
  // Tool naming governance
  // -----------------------------------------------------------------------
  const toolLayers: ToolLayerMap = {
    "built-in": builtInTools,
    "third-party-search": thirdPartyTools,
    "content-extraction": contentTools,
    mcp: mcpTools,
  }

  const namingResult = enforceToolNamingGovernance(toolLayers)
  if (namingResult.invalid.length > 0) {
    for (const invalid of namingResult.invalid) {
      console.warn(
        JSON.stringify({
          _tag: "tool_name_invalid",
          requestId,
          tool: invalid.toolKey,
          layer: invalid.layer,
          reason: invalid.reason,
          action: "drop_invalid_tool",
        })
      )
    }
  }
  if (namingResult.collisions.length > 0) {
    for (const collision of namingResult.collisions) {
      const droppedLayers = collision.owners.filter(
        (layer) => layer !== collision.winner
      )
      console.warn(
        JSON.stringify({
          _tag: "tool_name_collision",
          requestId,
          tool: collision.toolKey,
          layers: collision.owners,
          winner: collision.winner,
          droppedLayers,
          action: "keep_winner_drop_losers",
        })
      )
    }
  }

  builtInTools = (namingResult.sanitizedLayers["built-in"] ?? {}) as ToolSet
  thirdPartyTools = (namingResult.sanitizedLayers["third-party-search"] ??
    {}) as ToolSet
  contentTools = (namingResult.sanitizedLayers["content-extraction"] ??
    {}) as ToolSet
  mcpTools = (namingResult.sanitizedLayers.mcp ?? {}) as ToolSet

  const filterMetadataByTools = <T>(
    metadata: ReadonlyMap<string, T>,
    tools: ToolSet
  ) =>
    new Map(
      Array.from(metadata.entries()).filter(([name]) =>
        Object.prototype.hasOwnProperty.call(tools, name)
      )
    )

  builtInToolMetadata = filterMetadataByTools(builtInToolMetadata, builtInTools)
  thirdPartyToolMetadata = filterMetadataByTools(
    thirdPartyToolMetadata,
    thirdPartyTools
  )
  contentToolMetadata = filterMetadataByTools(contentToolMetadata, contentTools)
  mcpToolServerMap = new Map(
    Array.from(mcpToolServerMap.entries()).filter(([name]) =>
      Object.prototype.hasOwnProperty.call(mcpTools, name)
    )
  )

  // -----------------------------------------------------------------------
  // Tool budget — Layer 1 (provider-executed) state machine
  //
  // Provider-native tools are provider-executed and do not expose a local
  // execute() hook for per-call preflight enforcement. Compensating control:
  // probe budget during prepareStep (consume:false) and account actual usage in
  // onStepFinish. This preserves centralized budget policy semantics, with a
  // bounded request-local soft cap when policy is unavailable.
  // -----------------------------------------------------------------------
  const builtInToolNames = new Set(Object.keys(builtInTools))
  const exhaustedBuiltInTools = new Set<string>()
  const degradedBuiltInTools = new Set<string>()
  const degradedBuiltInSoftCap = createRequestLocalToolSoftCap({
    maxCallsPerTool: PREPARE_STEP_THRESHOLD,
  })

  const isBuiltInToolBudgetAllowed = async (
    toolName: string
  ): Promise<boolean> => {
    if (!builtInToolNames.has(toolName)) return true
    if (exhaustedBuiltInTools.has(toolName)) return false

    try {
      const probe = await probeToolBudget({
        store: toolLimitStore,
        keyMode: providerToolKeyMode,
        toolName,
      })
      if (probe.allowed) {
        if (degradedBuiltInTools.delete(toolName)) {
          console.warn(
            JSON.stringify({
              _tag: "tool_budget_gate_recovered",
              requestId,
              tool: toolName,
              source: "builtin",
              keyMode: providerToolKeyMode,
              action: "resume_policy_enforced_budgeting",
            })
          )
        }
        return true
      }
      degradedBuiltInTools.delete(toolName)
      exhaustedBuiltInTools.add(toolName)
      console.warn(
        JSON.stringify({
          _tag: "tool_budget_gate",
          requestId,
          tool: toolName,
          source: "builtin",
          keyMode: providerToolKeyMode,
          retryAfterSeconds: probe.retryAfterSeconds ?? null,
          action: "disable_tool_for_remaining_steps",
        })
      )
      return false
    } catch (error) {
      if (isPolicyUnavailableError(error)) {
        degradedBuiltInTools.add(toolName)
        const softCap = degradedBuiltInSoftCap.getSnapshot(toolName)
        const allowed = softCap.remaining > 0
        console.warn(
          JSON.stringify({
            _tag: "tool_budget_gate_degraded",
            requestId,
            tool: toolName,
            source: "builtin",
            keyMode: providerToolKeyMode,
            policyUnavailable: true,
            usedCalls: softCap.used,
            remainingCalls: softCap.remaining,
            maxCalls: softCap.maxCalls,
            error: error.message,
            action: allowed
              ? "allow_tool_with_request_local_soft_cap"
              : "disable_tool_until_policy_recovers",
          })
        )
        return allowed
      }
      exhaustedBuiltInTools.add(toolName)
      console.warn(
        JSON.stringify({
          _tag: "tool_budget_gate_error",
          requestId,
          tool: toolName,
          source: "builtin",
          keyMode: providerToolKeyMode,
          error: error instanceof Error ? error.message : String(error),
          action: "disable_tool_fail_closed",
        })
      )
      return false
    }
  }

  // -----------------------------------------------------------------------
  // Final merge:
  //   - Search: Layer 1 (built-in) XOR Layer 2 (Exa fallback) — never both
  //   - Content: Layer 2 content extraction — independent of search gating
  //   - MCP: Layer 3 (user-configured servers)
  // Spread order = conflict resolution priority (last wins).
  // -----------------------------------------------------------------------
  const searchTools = { ...builtInTools, ...thirdPartyTools }
  let mergedTools = {
    ...searchTools,
    ...contentTools,
    ...mcpTools,
  } as ToolSet

  // -----------------------------------------------------------------------
  // Metadata resolver — built from the runtime's own post-filter maps. The
  // four maps never escape; downstream call sites read this one shape.
  // -----------------------------------------------------------------------
  const metadata = createToolMetadataResolver({
    builtIn: builtInToolMetadata,
    thirdParty: thirdPartyToolMetadata,
    content: contentToolMetadata,
    mcpToolServerMap,
  })

  // -----------------------------------------------------------------------
  // Runtime-approval decisions (computed eagerly — tools are final).
  // -----------------------------------------------------------------------
  const approvalDecisionsByToolName = new Map<
    string,
    RuntimeToolApprovalDecision
  >()
  for (const toolName of Object.keys(mergedTools)) {
    const resolved = metadata.get(toolName)
    const decision = getRuntimeToolApprovalDecision({
      toolName,
      source: metadata.source(toolName),
      // Risk hints verbatim — for MCP these are advisory and only become
      // policy-driving via riskHintsTrusted below.
      metadata: resolved
        ? {
            readOnly: resolved.readOnly,
            destructive: resolved.destructive,
            idempotent: resolved.idempotent,
            openWorld: resolved.openWorld,
          }
        : undefined,
      riskHintsTrusted: resolved?.policyHintsTrusted,
    })
    approvalDecisionsByToolName.set(toolName, decision)
  }

  let durableApprovalsApplied = false
  const applyDurableApprovals = () => {
    if (durableApprovalsApplied) return
    durableApprovalsApplied = true
    mergedTools = wrapToolsWithRuntimeApproval(
      mergedTools,
      approvalDecisionsByToolName
    )
  }

  // -----------------------------------------------------------------------
  // dispose() — idempotent MCP client cleanup.
  // -----------------------------------------------------------------------
  let disposePromise: Promise<void> | null = null
  const dispose = (): Promise<void> => {
    if (!disposePromise) {
      disposePromise = Promise.allSettled(
        mcpClients.map((client) => client.close())
      ).then(() => {})
    }
    return disposePromise
  }

  // -----------------------------------------------------------------------
  // Transitional step gate (removed in commit 3).
  // -----------------------------------------------------------------------
  let loggedLateStepPolicy = false
  const stepGate: ToolRuntimeStepGate = {
    async activeToolsForStep(stepNumber: number): Promise<string[]> {
      const isLateStep = stepNumber > PREPARE_STEP_THRESHOLD
      const policyToolsForStep = getActiveToolsForStep(
        toolPolicy,
        stepNumber,
        PREPARE_STEP_THRESHOLD
      )
      const budgetAllowedTools: string[] = []
      for (const toolName of policyToolsForStep ?? []) {
        if (!builtInToolNames.has(toolName)) {
          budgetAllowedTools.push(toolName)
          continue
        }
        if (await isBuiltInToolBudgetAllowed(toolName)) {
          budgetAllowedTools.push(toolName)
        }
      }

      if (isLateStep && !loggedLateStepPolicy) {
        loggedLateStepPolicy = true
        console.log(
          JSON.stringify({
            _tag: "tool_policy_step_gate",
            requestId,
            chatId,
            userId,
            model,
            stepNumber,
            threshold: PREPARE_STEP_THRESHOLD,
            earlyToolCount: toolPolicy.earlyToolNames.length,
            lateToolCount: budgetAllowedTools.length,
            blockedCount:
              toolPolicy.earlyToolNames.length - budgetAllowedTools.length,
          })
        )
      }

      return budgetAllowedTools
    },

    async accountBuiltInCall(toolName: string): Promise<void> {
      if (!builtInToolNames.has(toolName)) return
      try {
        await builtInPolicyGuard.enforceToolBudget(toolName)
        if (degradedBuiltInTools.delete(toolName)) {
          console.warn(
            JSON.stringify({
              _tag: "tool_budget_post_accounting_recovered",
              requestId,
              tool: toolName,
              source: "builtin",
              keyMode: providerToolKeyMode,
              action: "resume_policy_enforced_budgeting",
            })
          )
        }
      } catch (error) {
        if (isPolicyUnavailableError(error)) {
          degradedBuiltInTools.add(toolName)
          const softCap = degradedBuiltInSoftCap.recordCall(toolName)
          console.warn(
            JSON.stringify({
              _tag: "tool_budget_post_accounting_degraded",
              requestId,
              tool: toolName,
              source: "builtin",
              keyMode: providerToolKeyMode,
              policyUnavailable: true,
              usedCalls: softCap.used,
              remainingCalls: softCap.remaining,
              maxCalls: softCap.maxCalls,
              error: error.message,
              action:
                softCap.remaining > 0
                  ? "allow_tool_with_request_local_soft_cap"
                  : "disable_tool_until_policy_recovers",
            })
          )
          return
        }
        exhaustedBuiltInTools.add(toolName)
        console.warn(
          JSON.stringify({
            _tag: "tool_budget_post_accounting_denied",
            requestId,
            tool: toolName,
            source: "builtin",
            keyMode: providerToolKeyMode,
            error: error instanceof Error ? error.message : String(error),
            action: "disable_tool_for_remaining_steps",
          })
        )
      }
    },
  }

  // -----------------------------------------------------------------------
  // Telemetry views (read-only).
  // -----------------------------------------------------------------------
  const policySummary: ToolRuntimePolicySummary = {
    capabilities: toolPolicy.capabilities,
    capabilityReasons: toolPolicy.capabilityReasons,
    userTier: toolPolicy.userTier,
    keyMode: toolPolicy.keyMode,
    keyModeReason: toolPolicy.keyModeReason,
    totalTools: toolPolicy.toolDecisions.length,
    earlyAllowedCount: toolPolicy.earlyToolNames.length,
    lateAllowedCount: toolPolicy.lateToolNames.length,
    searchInjected: shouldInjectSearch,
  }

  const toolCounts: ToolRuntimeToolCounts = {
    builtIn: Object.keys(builtInTools).length,
    thirdParty: Object.keys(thirdPartyTools).length,
    content: Object.keys(contentTools).length,
    mcp: Object.keys(mcpTools).length,
    total: Object.keys(mergedTools).length,
  }

  const mcpServerCount = new Set(
    Array.from(mcpToolServerMap.values()).map((info: ServerInfo) => info.serverId)
  ).size
  const mcpClientCount = mcpClients.length

  return {
    get tools() {
      return mergedTools
    },
    get hasTools() {
      return Object.keys(mergedTools).length > 0
    },
    metadata,
    traceFor(toolCallId: string) {
      return traceCollector.get(toolCallId)
    },
    policySummary,
    toolCounts,
    mcpServerCount,
    mcpClientCount,
    approvalDecisionsByToolName,
    approvalFor(toolName: string) {
      return approvalDecisionsByToolName.get(toolName)
    },
    applyDurableApprovals,
    stepGate,
    dispose,
  }
}

/**
 * Wrap tools with runtime-approval gating. A tool whose decision needs approval
 * gets a composed `needsApproval` that ORs the existing predicate with the
 * runtime decision; all other tools pass through unchanged.
 *
 * Moved verbatim from the chat route — used only by `applyDurableApprovals`.
 */
function wrapToolsWithRuntimeApproval(
  tools: ToolSet,
  approvalByToolName: ReadonlyMap<string, { needsApproval: boolean }>
): ToolSet {
  const wrapped: Record<string, unknown> = {}

  for (const [toolName, descriptor] of Object.entries(tools)) {
    const original = descriptor as Record<string, unknown>
    const decision = approvalByToolName.get(toolName)
    if (!decision?.needsApproval) {
      wrapped[toolName] = original
      continue
    }

    const existingNeedsApproval = original.needsApproval
    wrapped[toolName] = {
      ...original,
      needsApproval: async (input: unknown, options: unknown) => {
        let existingDecision = false
        if (typeof existingNeedsApproval === "function") {
          existingDecision = await (
            existingNeedsApproval as (
              input: unknown,
              options: unknown
            ) => boolean | PromiseLike<boolean>
          )(input, options)
        } else if (typeof existingNeedsApproval === "boolean") {
          existingDecision = existingNeedsApproval
        }
        return existingDecision || decision.needsApproval
      },
    }
  }

  return wrapped as ToolSet
}
