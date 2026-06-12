import * as Sentry from "@sentry/nextjs"
import { after } from "next/server"
import {
  SYSTEM_PROMPT_DEFAULT,
  MCP_CONNECTION_TIMEOUT_MS,
  MCP_MAX_STEP_COUNT,
  DEFAULT_MAX_STEP_COUNT,
  ANONYMOUS_MAX_STEP_COUNT,
  ANTHROPIC_BETA_HEADERS,
  PREPARE_STEP_THRESHOLD,
  HISTORY_REPLAY_COMPILER_V1,
} from "@/lib/config"
import { getAllModels } from "@/lib/models"
import { resolveModelId } from "@/lib/models/model-id-migration"
import { getProviderForModel } from "@/lib/openproviders/provider-map"
import { createLanguageModel } from "@/lib/openproviders/create-language-model"
import {
  captureGeneration,
  flushPostHog,
  getPostHogClient,
} from "@/lib/posthog"
import { scrubForAnalytics } from "@/lib/posthog/scrub"
import type { Provider, ToolKeyMode } from "@/lib/user-keys"
import {
  UIMessage as MessageAISDK,
  ToolSet,
  consumeStream,
  stepCountIs,
  convertToModelMessages,
  validateUIMessages,
  type ModelMessage,
} from "ai"
import type { ProviderOptions } from "@ai-sdk/provider-utils"
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { getWorkosSession } from "@/lib/auth/workos"
import {
  checkServerSideUsage,
  incrementServerSideUsage,
  validateAndTrackUsage,
} from "./api"
import {
  createErrorResponse,
  extractErrorMessage,
  hasProviderLinkedResponseIds,
  toPlainTextModelMessages,
} from "./utils"
import { adaptHistoryForProvider } from "./adapters"
import type { AdaptationContext, AdaptationWarning } from "./adapters/types"
import {
  getTextFilePartReferences,
  prepareTextFilePartsForModelInput,
} from "./text-file-parts"
import {
  loadUserMcpTools,
  type LoadToolsResult,
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
  type ToolPolicyInput,
  type ToolPolicyDecision,
} from "@/lib/tools/capability-policy"
import type { ToolSource } from "@/lib/tools/types"
import { getRuntimeToolApprovalDecision } from "@/lib/tools/runtime-approval"
import { createToolMetadataResolver } from "@/lib/tools/metadata-resolver"
import {
  buildFinishToolInvocationStreamMetadata,
  buildStartToolInvocationStreamMetadata,
  type ToolInvocationMetadataByCallId,
} from "@/lib/tools/ui-metadata"
import {
  ToolTraceCollector,
  wrapMcpTools,
} from "@/lib/tools/mcp-wrapper"
import {
  classifyChatError,
  type ChatErrorType,
} from "@/lib/observability/chat-error-taxonomy"
import {
  flushBraintrust,
  getBraintrustErrorMetadata,
  getBraintrustStreamText,
  hashBraintrustIdentifier,
  logBraintrustTraceMetadata,
  withBraintrustTrace,
  type BraintrustChatMetadata,
  type BraintrustTraceSpan,
} from "@/lib/observability/braintrust"
import {
  countToolParts,
  createDurableSnapshotTracker,
  createRuntimeApprovalPersistenceTransform,
  extractApprovalResponses,
  getFinalAssistantText,
  getLatestUserMessage,
  hasApprovalResponse,
  isDurableConvexChat,
  toDurableUiMessages,
  type DurableUiMessage,
  type ToolInvocationForPersistence,
} from "./durable-runtime"

export const maxDuration = 60

type ChatRequest = {
  messages: MessageAISDK[]
  chatId: string
  model: string
  systemPrompt: string
  enableSearch: boolean
  chatVersion?: number
  userId?: string // Client-provided userId (for anonymous users)
}

type DurableRunState = {
  runId: Id<"generationRuns">
  assistantMessageId: Id<"messages">
  assistantOrder: number
  originalMessages: DurableUiMessage[]
  snapshotTracker: ReturnType<typeof createDurableSnapshotTracker> | null
}

type RuntimeApprovalDecision = ReturnType<typeof getRuntimeToolApprovalDecision>

function normalizeChatVersion(
  chatVersion: unknown,
  fallbackMessages: MessageAISDK[]
): number {
  if (
    typeof chatVersion === "number" &&
    Number.isFinite(chatVersion) &&
    chatVersion >= 0
  ) {
    return Math.floor(chatVersion)
  }
  return fallbackMessages.length
}

function bucketChatVersion(chatVersion: number): string {
  if (chatVersion <= 1) return "0-1"
  if (chatVersion <= 5) return "2-5"
  if (chatVersion <= 20) return "6-20"
  return "21+"
}

function getToolDimensionForError(errorType: ChatErrorType): "yes" | "no" {
  return errorType === "tool_timeout" || errorType === "tool_execution"
    ? "yes"
    : "no"
}

type ToolExecutionOutcome =
  | "none"
  | "success"
  | "failure"
  | "timeout"
  | "budget_denied"

function bucketLatencyMs(latencyMs: number): string {
  if (latencyMs <= 1000) return "le_1s"
  if (latencyMs <= 3000) return "1s_3s"
  if (latencyMs <= 8000) return "3s_8s"
  if (latencyMs <= 15000) return "8s_15s"
  return "gt_15s"
}

function isTimeoutSignal(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.toLowerCase()
  return (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("deadline exceeded") ||
    normalized.includes("aborterror")
  )
}

function getSlowRequestThresholdMs(): number {
  const fallback = 30000
  const parsed = Number.parseInt(
    process.env.SENTRY_CHAT_SLOW_REQUEST_MS ?? "",
    10
  )
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getStalledContinuationThresholdMs(): number {
  const fallback = 30000
  const parsed = Number.parseInt(
    process.env.SENTRY_CHAT_STALLED_CONTINUATION_MS ?? "",
    10
  )
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

type ChatStreamPhase =
  | "pre_first_chunk"
  | "post_tool_continue"
  | "post_first_chunk"
  | "unknown"

function setChatConversationCorrelation(chatId: string): void {
  const sentryWithConversationApi = Sentry as typeof Sentry & {
    setConversationId?: (conversationId: string) => void
  }
  if (typeof sentryWithConversationApi.setConversationId === "function") {
    sentryWithConversationApi.setConversationId(chatId)
  }
  Sentry.setContext("chat_conversation", { id: chatId })
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  return undefined
}

function getLatestUserMessageTimestamp(messages: MessageAISDK[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "user") continue
    const withCreatedAt = message as MessageAISDK & { createdAt?: unknown }
    return parseTimestampMs(withCreatedAt.createdAt)
  }
  return undefined
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function getStringField(
  value: Record<string, unknown> | null,
  field: string
): string | undefined {
  if (!value) return undefined
  const candidate = value[field]
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined
}

function getBooleanField(
  value: Record<string, unknown> | null,
  field: string
): boolean | undefined {
  if (!value) return undefined
  const candidate = value[field]
  return typeof candidate === "boolean" ? candidate : undefined
}

function isReplayShapeError(message: string): boolean {
  const normalized = message.toLowerCase()
  return [
    // OpenAI
    "was provided without its required",
    "no tool output found for function call",
    // Anthropic
    "thinking block must be followed by",
    "tool_use block must be followed by tool_result",
    // Google
    "number of function response parts is equal to",
    "missing a thought_signature",
  ].some((pattern) => normalized.includes(pattern))
}

function summarizeHistoryPartTypes(messages: MessageAISDK[]): {
  roleCounts: Record<string, number>
  partTypeCounts: Record<string, number>
} {
  const roleCounts: Record<string, number> = {}
  const partTypeCounts: Record<string, number> = {}

  for (const message of messages) {
    roleCounts[message.role] = (roleCounts[message.role] ?? 0) + 1
    for (const part of message.parts ?? []) {
      partTypeCounts[part.type] = (partTypeCounts[part.type] ?? 0) + 1
    }
  }

  return { roleCounts, partTypeCounts }
}

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

function countWarningsByCode(warnings: AdaptationWarning[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const warning of warnings) {
    counts[warning.code] = (counts[warning.code] ?? 0) + 1
  }
  return counts
}

function summarizeReplayWarningDetails(
  warnings: AdaptationWarning[],
  code: "replay_normalization_warning" | "replay_compile_warning",
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const warning of warnings) {
    if (warning.code !== code) continue
    const subcode = warning.detail.split(":")[0]?.trim() || "unknown"
    counts[subcode] = (counts[subcode] ?? 0) + 1
  }
  return counts
}

export async function POST(req: Request) {
  // MCP state — declared outside try for cleanup in both after() and catch
  let mcpClients: LoadToolsResult["clients"] = []
  let mcpToolServerMap: LoadToolsResult["toolServerMap"] = new Map()
  const requestId = crypto.randomUUID()
  let telemetryChatId: string | undefined
  let telemetryModel: string | undefined
  let telemetryProvider: string | undefined
  let telemetryIsAuthenticated: boolean | undefined
  let telemetryMessageCount: number | undefined
  let durableRunState: DurableRunState | null = null
  let durableConvexToken: string | undefined
  const slowRequestThresholdMs = getSlowRequestThresholdMs()
  const stalledContinuationThresholdMs = getStalledContinuationThresholdMs()

  try {
    Sentry.setTag("route", "api/chat")
    Sentry.setTag("chat_route", "/api/chat")
    Sentry.setTag("chat_operation", "stream_text")

    // Server-side authentication - derive user ID from WorkOS AuthKit session
    const authSession = await getWorkosSession()
    const authUserId = authSession.user?.id
    const isAuthenticated = !!authUserId
    telemetryIsAuthenticated = isAuthenticated

    // Get Convex token for authenticated usage tracking
    const convexToken = isAuthenticated
      ? authSession.accessToken
      : undefined
    durableConvexToken = convexToken

    const {
      messages,
      chatId,
      model: requestedModel,
      systemPrompt,
      enableSearch,
      chatVersion,
      userId: clientUserId,
    } = (await req.json()) as ChatRequest
    const model = resolveModelId(requestedModel)
    telemetryChatId = chatId
    telemetryModel = model
    telemetryMessageCount = Array.isArray(messages) ? messages.length : undefined
    setChatConversationCorrelation(chatId)
    Sentry.setTag("chat_model", model)
    Sentry.setTag("chat_is_authenticated", String(isAuthenticated))
    Sentry.setContext("chat_request", {
      requestId,
      chatId,
      requestedModel,
      resolvedModel: model,
      messageCount: telemetryMessageCount,
    })
    if (requestedModel !== model) {
      console.warn(
        JSON.stringify({
          _tag: "model_id_migrated",
          requestId,
          from: requestedModel,
          to: model,
        })
      )
    }

    if (!messages || !chatId || !model) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields",
          code: "INVALID_REQUEST",
          details: {
            messages: !messages ? "required" : "ok",
            chatId: !chatId ? "required" : "ok",
            model: !model ? "required" : "ok",
          },
        }),
        { status: 400 }
      )
    }

    const normalizedChatVersion = normalizeChatVersion(chatVersion, messages)
    const latestUserMessageTimestamp = getLatestUserMessageTimestamp(messages)

    // For anonymous users, require a guest ID for usage tracking
    // The client must provide a stable guest ID (format: "guest_<uuid>") from localStorage
    // This is generated by getOrCreateGuestUserId() on the client
    if (!isAuthenticated && !clientUserId) {
      return new Response(
        JSON.stringify({
          error: "Guest ID required for anonymous users",
          code: "MISSING_GUEST_ID",
        }),
        { status: 400 }
      )
    }

    // Use authenticated userId, or client-provided ID for anonymous users
    // At this point: if authenticated, authUserId is defined; if not, clientUserId is defined (validated above)
    const userId = authUserId ?? clientUserId!

    // For anonymous users, use clientUserId for rate limiting
    // This should match the format from getOrCreateGuestUserId: "guest_<uuid>"
    const anonymousId = !isAuthenticated ? clientUserId! : undefined

    // Server-side usage check - enforces rate limits before processing
    // For anonymous users, pass the anonymousId for tracking
    await Sentry.startSpan(
      {
        name: "chat.usage_checks",
        op: "chat.validation",
        attributes: {
          "chat.id": chatId,
          "chat.model": model,
          "chat.is_authenticated": isAuthenticated,
        },
      },
      async () => {
        await checkServerSideUsage(convexToken, model, anonymousId)

        await validateAndTrackUsage({
          userId,
          model,
          isAuthenticated,
          token: convexToken,
        })

        // Increment usage count server-side with Convex
        await incrementServerSideUsage(convexToken, model, anonymousId)
      }
    )

    const allModels = await Sentry.startSpan(
      { name: "chat.load_models", op: "chat.config" },
      async () => getAllModels()
    )
    const modelConfig = allModels.find((m) => m.id === model)

    if (!modelConfig) {
      throw new Error(`Model ${model} not found`)
    }

    const effectiveSystemPrompt = systemPrompt || SYSTEM_PROMPT_DEFAULT

    const provider = getProviderForModel(model)
    telemetryProvider = provider
    Sentry.setTag("chat_provider", provider)

    let apiKey: string | undefined
    if (isAuthenticated && convexToken) {
      const { getEffectiveApiKey } = await import("@/lib/user-keys")
      apiKey =
        (await getEffectiveApiKey(
          provider as Provider,
          convexToken
        )) || undefined
    }

    // Pre-flight check: verify an API key is available before calling the provider.
    // When apiKey is undefined, the AI SDK falls back to environment variables.
    // If neither source has a valid key, the provider will reject with a 401.
    if (!apiKey) {
      const { env: providerEnv } = await import("@/lib/openproviders/env")
      const envKeyMap: Record<string, string | undefined> = {
        openai: providerEnv.OPENAI_API_KEY,
        mistral: providerEnv.MISTRAL_API_KEY,
        perplexity: providerEnv.PERPLEXITY_API_KEY,
        google: providerEnv.GOOGLE_GENERATIVE_AI_API_KEY,
        anthropic: providerEnv.ANTHROPIC_API_KEY,
        xai: providerEnv.XAI_API_KEY,
        openrouter: providerEnv.OPENROUTER_API_KEY,
      }
      const envKey = envKeyMap[provider]
      if (!envKey) {
        const providerName = modelConfig.provider || provider
        throw Object.assign(
          new Error(
            `No API key configured for ${providerName}. Please add your ${providerName} API key in settings.`
          ),
          { statusCode: 401, code: "MISSING_API_KEY" }
        )
      }
    }
    const providerToolKeyMode: ToolKeyMode = apiKey ? "byok" : "platform"

    // enableSearch is no longer passed to the model — it controls tool injection below.
    // All search is now provided via visible, auditable tool calls (Layer 1 or Layer 2).
    const aiModel = createLanguageModel(modelConfig, apiKey)

    // -----------------------------------------------------------------------
    // Search Tool Loading (Layer 1 — Built-in Provider Tools)
    //
    // The `enableSearch` flag from the client is the MASTER SWITCH for search
    // tool injection. When true, route.ts injects search tools:
    //   - If the provider has native search tools → use them (Layer 1)
    //   - If not → use Exa fallback (Layer 2, added in Phase 3)
    //
    // This replaces the previous dual mechanism where `enableSearch` was
    // passed to model creation as an opaque provider-level flag.
    // All search is now visible, auditable tool calls.
    //
    // NOT gated on isAuthenticated. Anonymous users (5 daily messages)
    // get search tools when the platform has provider API keys configured.
    // When apiKey is undefined (anonymous), the provider factory falls back
    // to the env var — same behavior as model creation above.
    // -----------------------------------------------------------------------
    let builtInTools: ToolSet = {} as ToolSet
    let builtInToolMetadata = new Map<string, import("@/lib/tools/types").ToolMetadata>()

    const initialCapabilityPolicy = resolveCapabilityPolicy({
      modelTools: modelConfig.tools,
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

    if (shouldInjectSearch) {
      const { getProviderTools } = await import("@/lib/tools/provider")
      const providerResult = await getProviderTools(provider, apiKey)
      builtInTools = providerResult.tools
      builtInToolMetadata = providerResult.metadata
    }

    // -----------------------------------------------------------------------
    // Exa API Key Resolution (shared by Layer 2 capabilities)
    //
    // Resolved once, used by both search fallback and content extraction.
    // Key resolution: user BYOK key → platform env var → undefined.
    // The exa-js SDK accepts keys in its constructor, so BYOK keys
    // are passed directly — no env var manipulation needed.
    //
    // NOT gated on isAuthenticated — anonymous users get Exa-powered tools
    // when the platform has an EXA_API_KEY configured (same as Layer 1).
    // -----------------------------------------------------------------------
    let resolvedExaKey: string | undefined
    let resolvedExaKeyMode: ToolKeyMode | undefined
    const { getEffectiveToolKeyWithMode } = await import("@/lib/user-keys")
    const resolvedExa = await getEffectiveToolKeyWithMode("exa", convexToken)
    resolvedExaKey = resolvedExa.key
    resolvedExaKeyMode = resolvedExa.keyMode

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
    const exaPolicyGuard =
      resolvedExaKeyMode ? makePolicyGuard(resolvedExaKeyMode) : undefined

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
            enforceToolBudget: (toolName) => exaPolicyGuard.enforceToolBudget(toolName),
            keyMode: resolvedExaKeyMode,
            maxCallsPerTool: PREPARE_STEP_THRESHOLD,
            onEvent: (event) => logOutageTolerantBudgetEvent("third-party", event),
          })
        : undefined

    const contentBudgetEnforcer =
      exaPolicyGuard && resolvedExaKeyMode
        ? createOutageTolerantToolBudgetEnforcer({
            enforceToolBudget: (toolName) => exaPolicyGuard.enforceToolBudget(toolName),
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
    // Third-Party Search Fallback (Layer 2 — Search)
    // Universal search fallback for providers without native search tools.
    // Only loaded when enableSearch is true AND Layer 1 didn't provide search.
    //
    // The coordination model is simple:
    //   - enableSearch === true: route.ts injects search tools
    //   - Layer 1 provided search (builtInHasSearch): skip Layer 2 search
    //   - Layer 1 did NOT provide search: load Layer 2 Exa fallback
    // -----------------------------------------------------------------------
    let thirdPartyTools: ToolSet = {} as ToolSet
    let thirdPartyToolMetadata = new Map<string, import("@/lib/tools/types").ToolMetadata>()

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
    // Content Extraction Tools (Layer 2 — Content)
    // Independent capability — NOT gated on shouldInjectSearch or
    // builtInHasSearch. Gated on capabilities.extract and Exa key.
    // Available for ALL providers including those with native Layer 1
    // search (OpenAI, Anthropic, Google, xAI).
    // -----------------------------------------------------------------------
    let contentTools: ToolSet = {} as ToolSet
    let contentToolMetadata = new Map<string, import("@/lib/tools/types").ToolMetadata>()

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
    // MCP Tool Loading
    // Gate on: auth + Convex token + model capability
    // -----------------------------------------------------------------------
    let mcpTools: ToolSet = {} as ToolSet

    if (
      isAuthenticated &&
      convexToken &&
      capabilities.mcp
    ) {
      const mcpLoadStart = Date.now()
      const mcpResult = await loadUserMcpTools(convexToken, {
        timeout: MCP_CONNECTION_TIMEOUT_MS,
      })
      mcpTools = mcpResult.tools as ToolSet
      mcpClients = mcpResult.clients
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

      // Register MCP cleanup immediately after loading — before any code that
      // could throw.  after() runs even when the response errors or the client
      // disconnects, so this covers both the happy path and streaming failures.
      after(async () => {
        await Promise.allSettled(mcpClients.map((c) => c.close()))
      })
    }

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
      modelTools: modelConfig.tools,
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

    // Wrap MCP tools with timeout, timing, truncation, and envelope.
    // Single wrapper handles all Layer 3 concerns — follows the Exa gold
    // standard pattern (lib/tools/third-party.ts:82-119).
    // Replaces the previous wrapToolsWithTruncation(mcpTools) call.
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

    // Wrap non-builtin tools with tracing (Layer 2 + Layer 4).
    // Records durationMs and resultSizeBytes into traceCollector so
    // onStepFinish and onFinish can read them for ALL tool types.
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

    // Merge all tool layers:
    //   - Search: Layer 1 (built-in) XOR Layer 2 (Exa fallback) — never both
    //   - Content: Layer 2 content extraction — independent of search gating
    //   - MCP: Layer 3 (user-configured servers)
    // Spread order = conflict resolution priority (last wins):
    //   1. Search tools (lowest priority)
    //   2. Content extraction tools (same priority tier as search)
    //   3. MCP tools (highest priority — user-configured, namespaced)
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

    const builtInToolNames = new Set(Object.keys(builtInTools))
    const exhaustedBuiltInTools = new Set<string>()
    const degradedBuiltInTools = new Set<string>()
    const degradedBuiltInSoftCap = createRequestLocalToolSoftCap({
      maxCallsPerTool: PREPARE_STEP_THRESHOLD,
    })

    // Provider-native (Layer 1) tools are provider-executed and do not expose a
    // local execute() hook for per-call preflight enforcement. Compensating
    // control: probe budget during prepareStep (consume:false) and account
    // actual usage in onStepFinish. This preserves centralized budget policy
    // semantics, with a bounded request-local soft cap when policy is unavailable.
    const isBuiltInToolBudgetAllowed = async (toolName: string): Promise<boolean> => {
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

    const searchTools = { ...builtInTools, ...thirdPartyTools }
    let allTools = { ...searchTools, ...contentTools, ...mcpTools } as ToolSet

    const hasAnyTools = Object.keys(allTools).length > 0

    // Anonymous users get a lower step count to limit tool call cost exposure.
    // Authenticated users get the full MCP_MAX_STEP_COUNT (20).
    const maxSteps = hasAnyTools
      ? (isAuthenticated ? MCP_MAX_STEP_COUNT : ANONYMOUS_MAX_STEP_COUNT)
      : DEFAULT_MAX_STEP_COUNT

    // Check if PostHog is configured for LLM analytics
    const phClient = getPostHogClient()
    const startTime = Date.now()
    const braintrustStreamText = getBraintrustStreamText()

    // Schedule PostHog flush after streaming response completes
    // This ensures $ai_generation events are flushed before the serverless function terminates
    // Using flush() instead of shutdown() allows client reuse in warm containers
    if (phClient) {
      after(async () => {
        await flushPostHog()
      })
    }
    after(async () => {
      await flushBraintrust()
    })

    let canonicalMessages: MessageAISDK[] = messages
    const durableRuntimeEnabled = isDurableConvexChat({
      isAuthenticated,
      convexToken,
      chatId,
    })

    if (durableRuntimeEnabled && convexToken) {
      const approvalResponses = extractApprovalResponses(messages)
      const latestUserMessage = hasApprovalResponse(messages)
        ? undefined
        : getLatestUserMessage(messages)

      const prepared = await fetchMutation(
        api.chatRuntime.prepareGeneration,
        {
          chatId: chatId as Id<"chats">,
          requestId,
          model,
          provider,
          chatVersion: normalizedChatVersion,
          latestUserMessage: latestUserMessage
            ? {
                id: latestUserMessage.id,
                role: "user" as const,
                content: getStringField(
                  getRecord(latestUserMessage as unknown),
                  "content"
                ),
                parts: latestUserMessage.parts,
              }
            : undefined,
          approvalResponses,
        },
        { token: convexToken }
      )

      const durableMessages = toDurableUiMessages(prepared.messages)
      canonicalMessages = durableMessages as MessageAISDK[]
      durableRunState = {
        runId: prepared.runId,
        assistantMessageId: prepared.assistantMessageId,
        assistantOrder: prepared.assistantOrder,
        originalMessages: durableMessages,
        snapshotTracker: createDurableSnapshotTracker({
          convexToken,
          runId: prepared.runId,
          chatId: chatId as Id<"chats">,
          messageId: prepared.assistantMessageId,
          order: prepared.assistantOrder,
        }),
      }

      console.log(
        JSON.stringify({
          _tag: "durable_chat_runtime_prepared",
          requestId,
          chatId,
          runId: prepared.runId,
          assistantMessageId: prepared.assistantMessageId,
          canonicalMessageCount: canonicalMessages.length,
          approvalResponseCount: approvalResponses.length,
          hasLatestUserMessage: Boolean(latestUserMessage),
        })
      )
    }

    const validatedMessages = await validateUIMessages({
      messages: canonicalMessages,
      tools: allTools as unknown as Parameters<typeof validateUIMessages>[0]["tools"],
    })

    const textFileReferences = getTextFilePartReferences(validatedMessages)
    const trustedTextAttachments =
      durableRuntimeEnabled && convexToken && textFileReferences.length > 0
        ? await fetchQuery(
            api.files.getTrustedTextAttachmentsForChat,
            {
              chatId: chatId as Id<"chats">,
              references: textFileReferences,
            },
            { token: convexToken }
          )
        : []

    const textFileModelInput = await prepareTextFilePartsForModelInput(
      validatedMessages,
      {
        trustedAttachments: trustedTextAttachments,
      }
    )

    if (textFileModelInput.convertedCount > 0) {
      console.log(
        JSON.stringify({
          _tag: "text_file_model_input_prepared",
          chatId,
          provider,
          model,
          convertedCount: textFileModelInput.convertedCount,
          failedCount: textFileModelInput.failedCount,
          truncatedCount: textFileModelInput.truncatedCount,
          skippedCount: textFileModelInput.skippedCount,
        })
      )
    }

    const adaptationContext: AdaptationContext = {
      targetModelId: model,
      hasTools: hasAnyTools,
      sourceProviderHint: provider,
    }

    const adaptStartTime = Date.now()
    const adapterResult = await adaptHistoryForProvider(
      textFileModelInput.messages,
      provider,
      adaptationContext,
      {
        useReplayCompiler: HISTORY_REPLAY_COMPILER_V1,
      },
    )
    const adaptationTimeMs = Date.now() - adaptStartTime
    const warningCount = adapterResult.warnings.length
    const warningCountsByCode = countWarningsByCode(adapterResult.warnings)
    const replayNormalizeWarningCount =
      warningCountsByCode.replay_normalization_warning ?? 0
    const replayCompileWarningCount =
      warningCountsByCode.replay_compile_warning ?? 0
    const replayCompileFallbackCount =
      warningCountsByCode.replay_compile_fallback ?? 0
    const replayCompileFallbackActivated = replayCompileFallbackCount > 0
    const partsDroppedTotal = Object.values(adapterResult.stats.partsDropped).reduce(
      (sum, count) => sum + count,
      0
    )

    if (HISTORY_REPLAY_COMPILER_V1) {
      console.log(
        JSON.stringify({
          _tag: "replay_normalize_stage",
          chatId,
          provider,
          model,
          compilerEnabled: true,
          warningCount: replayNormalizeWarningCount,
          warningCodes: summarizeReplayWarningDetails(
            adapterResult.warnings,
            "replay_normalization_warning"
          ),
          originalMessageCount: adapterResult.stats.originalMessageCount,
          adaptedMessageCount: adapterResult.stats.adaptedMessageCount,
          totalPartsOriginal: adapterResult.stats.totalPartsOriginal,
          totalPartsAdapted: adapterResult.stats.totalPartsAdapted,
        })
      )

      console.log(
        JSON.stringify({
          _tag: "replay_compile_stage",
          chatId,
          provider,
          model,
          compilerEnabled: true,
          warningCount: replayCompileWarningCount,
          warningCodes: summarizeReplayWarningDetails(
            adapterResult.warnings,
            "replay_compile_warning"
          ),
          fallbackActivated: replayCompileFallbackActivated,
          fallbackCount: replayCompileFallbackCount,
          adaptationTimeMs,
        })
      )
    }

    if (replayCompileFallbackActivated) {
      console.warn(
        JSON.stringify({
          _tag: "replay_compile_fallback_activated",
          chatId,
          provider,
          model,
          compilerEnabled: HISTORY_REPLAY_COMPILER_V1,
          fallbackCount: replayCompileFallbackCount,
          originalMessageCount: adapterResult.stats.originalMessageCount,
          adaptedMessageCount: adapterResult.stats.adaptedMessageCount,
        })
      )
    }

    console.log(
      JSON.stringify({
        _tag: "history_adapt",
        chatId,
        provider,
        model,
        replayCompilerEnabled: HISTORY_REPLAY_COMPILER_V1,
        ...adapterResult.stats,
        warningCount,
        warningCodes: warningCountsByCode,
        adaptationTimeMs,
      })
    )

    if (phClient) {
      phClient.capture({
        distinctId: userId || "anonymous",
        event: "history_adaptation",
        properties: {
          chatId,
          provider,
          model,
          originalMessageCount: adapterResult.stats.originalMessageCount,
          adaptedMessageCount: adapterResult.stats.adaptedMessageCount,
          partsDroppedTotal,
          providerIdsStripped: adapterResult.stats.providerIdsStripped,
          warningCount,
          adaptationTimeMs,
        },
      })
    }

    // Convert UIMessage[] to ModelMessage[] for streamText (v6)
    let modelMessages: ModelMessage[] = await convertToModelMessages(
      adapterResult.messages,
      {
        tools: allTools,
        ignoreIncompleteToolCalls: true,
      }
    )

    // OpenAI responses replay hardening:
    // If conversion output still contains provider-linked response IDs
    // (msg_/rs_/ws_), fall back to a plain-text transcript to avoid
    // pairing invariant failures on follow-up turns.
    if (provider === "openai" && hasProviderLinkedResponseIds(modelMessages)) {
      console.warn(
        JSON.stringify({
          _tag: "replay_plaintext_fallback_activated",
          chatId,
          provider,
          model,
          reason: "provider_linked_response_ids_detected_post_conversion",
          messageCount: modelMessages.length,
          compilerEnabled: HISTORY_REPLAY_COMPILER_V1,
        })
      )
      modelMessages = toPlainTextModelMessages(adapterResult.messages)
    }

    // Build provider-specific options to enable reasoning/thinking when
    // the selected model advertises support (reasoningText: true).
    //
    // Anthropic thinking configuration is context-aware:
    //   - Models with thinkingMode: "adaptive" (Opus 4.6+) use Anthropic's
    //     adaptive allocation — the recommended mode per Anthropic's docs.
    //     "enabled" with budget_tokens is deprecated on Opus 4.6.
    //   - Older models use "enabled" with a fixed budgetTokens.
    //
    // IMPORTANT: Server-side web search results (encrypted_content) are
    // counted as INPUT tokens, not output tokens. They do NOT consume from
    // the max_tokens budget. (Source: Anthropic web search tool docs)
    //
    // SDK LIMITATION (ai@6.0.78 / @ai-sdk/anthropic@3.0.41):
    // When adaptive thinking is used with server-side tools (web search),
    // the Anthropic API may return stop_reason: "pause_turn" — indicating
    // the model needs a follow-up request to continue generating text. The
    // AI SDK maps "pause_turn" to the same unified finishReason as "end_turn"
    // ("stop") and the step continuation logic does not re-send the
    // conversation. This results in responses with reasoning + tool results
    // but zero text content.
    //
    // WORKAROUND: When search tools are active, fall back to "enabled"
    // thinking with a conservative budget. This produces a complete response
    // in a single API call (no pause_turn). For non-search requests,
    // adaptive thinking works correctly and is preferred.
    const providerOptions: ProviderOptions = {}

    if (modelConfig.reasoningText) {
      if (provider === "anthropic") {
        if (modelConfig.thinkingMode === "adaptive") {
          if (shouldInjectSearch) {
            // Adaptive + server-side web search triggers pause_turn in the
            // Anthropic API, which the AI SDK does not handle (see above).
            // Fall back to "enabled" with a budget that leaves ample room
            // for text output. Search results are input tokens, so they
            // don't consume from max_tokens — no reduction needed.
            providerOptions.anthropic = {
              thinking: { type: "enabled", budgetTokens: 10000 },
            }
          } else {
            // Opus 4.6+ without search — use adaptive thinking as recommended.
            // The model dynamically allocates between thinking and text, with
            // interleaved thinking automatically enabled for tool use.
            providerOptions.anthropic = {
              thinking: { type: "adaptive" },
            }
          }
        } else {
          // Older models — fixed budget.
          let budgetTokens = 10000 // default
          if (model.includes("opus")) budgetTokens = 16000
          else if (model.includes("haiku")) budgetTokens = 5000
          else if (model.includes("sonnet")) budgetTokens = 12000

          providerOptions.anthropic = {
            thinking: { type: "enabled", budgetTokens },
          }
        }
      } else if (provider === "google") {
        providerOptions.google = {
          thinkingConfig: { includeThoughts: true },
        }
      } else if (provider === "openai") {
        providerOptions.openai = {
          reasoningEffort: "medium",
          reasoningSummary: "auto",
        }
      } else if (provider === "xai") {
        providerOptions.xai = {
          reasoningEffort: "medium",
        }
      }
    }

    // -----------------------------------------------------------------------
    // Anthropic Token-Efficient Tool Use
    //
    // When Anthropic models have tools injected, enable the token-efficient
    // beta header to reduce tool definition token consumption. This header
    // is request-scoped via streamText({ headers }) — only affects Anthropic
    // requests that actually include tools.
    //
    // The header is safe to apply: @ai-sdk/anthropic@3.0.41 comma-merges
    // user and inferred betas (getBetasFromHeaders + Array.from(betas).join(",")).
    // -----------------------------------------------------------------------
    const isTokenEfficient =
      process.env.ANTHROPIC_TOKEN_EFFICIENT_TOOLS !== "false"
    const requestHeaders: Record<string, string> = {}

    if (provider === "anthropic" && hasAnyTools && isTokenEfficient) {
      requestHeaders["anthropic-beta"] = ANTHROPIC_BETA_HEADERS.tokenEfficient
    }

    // Resolve every tool's metadata behind one source-agnostic interface — the
    // Tool runtime's metadata resolver. It unifies the two prior shapes
    // (ToolMetadata across built-in/third-party/content + ServerInfo for MCP)
    // so downstream call sites read one shape instead of hand-joining four maps.
    // Built post-filter (after the metadata filtering above) so it sees only the
    // tools that survived policy + naming. MCP risk hints are carried verbatim;
    // trust is applied at the call sites below, never inside the resolver.
    const toolMetadataResolver = createToolMetadataResolver({
      builtIn: builtInToolMetadata,
      thirdParty: thirdPartyToolMetadata,
      content: contentToolMetadata,
      mcpToolServerMap,
    })
    const toolMetadataByName = toolMetadataResolver.toInvocationMetadataByName()

    const runtimeApprovalByToolName = new Map<
      string,
      ReturnType<typeof getRuntimeToolApprovalDecision>
    >()
    for (const toolName of Object.keys(allTools)) {
      const resolved = toolMetadataResolver.get(toolName)
      const decision = getRuntimeToolApprovalDecision({
        toolName,
        source: toolMetadataResolver.source(toolName),
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
      runtimeApprovalByToolName.set(toolName, decision)
    }

    if (durableRunState) {
      allTools = wrapToolsWithRuntimeApproval(allTools, runtimeApprovalByToolName)
    }

    const enrichedSystemPrompt = effectiveSystemPrompt

    const streamStartMs = Date.now()
    let stepCounter = 0
    let toolMetadataByCallId: ToolInvocationMetadataByCallId = {}

    // Track reasoning timing for messageMetadata persistence.
    // The first reasoning chunk records a start timestamp; when text-delta
    // arrives (reasoning is done) or onFinish fires, we compute elapsed ms.
    let reasoningStartMs: number | null = null
    let reasoningDurationMs: number | null = null
    let firstChunkLatencyMs: number | null = null
    let loggedLateStepPolicy = false
    let lastChunkAtMs: number | null = null
    let lastProgressAtMs = streamStartMs
    let observedToolCalls = 0
    let lastStepFinishReason: string | null = null
    let lastToolStepNumber: number | null = null
    let lastToolNames: string[] = []
    let awaitingPostToolContinuation = false
    let postToolContinuationArmedAtMs: number | null = null
    let stalledContinuationTimer: ReturnType<typeof setTimeout> | null = null
    let stalledContinuationCaptured = false
    let abortCaptured = false
    let streamCompleted = false
    let durableFinalUsage:
      | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
      | undefined
    let durableFinalFinishReason: string | undefined
    let durableFinalToolCounts:
      | { totalToolCalls: number; failedToolCalls: number }
      | undefined
    const approvalWritePromises: Promise<unknown>[] = []

    const clearStalledContinuationTimer = () => {
      if (stalledContinuationTimer !== null) {
        clearTimeout(stalledContinuationTimer)
        stalledContinuationTimer = null
      }
    }

    const getStreamPhase = (): ChatStreamPhase => {
      if (awaitingPostToolContinuation) return "post_tool_continue"
      if (firstChunkLatencyMs !== null) return "post_first_chunk"
      if (stepCounter > 0 || observedToolCalls > 0) return "unknown"
      return "pre_first_chunk"
    }

    const captureChatLifecycleSignal = (
      signalName: "chat_client_abort" | "chat_stalled_continuation",
      phase: ChatStreamPhase = getStreamPhase()
    ) => {
      const now = Date.now()
      Sentry.captureMessage(signalName, {
        level: "warning",
        tags: {
          route: "api/chat",
          chat_route: "/api/chat",
          chat_operation: "stream_text",
          chat_provider: provider,
          chat_model: model,
          chat_is_authenticated: String(isAuthenticated),
          chat_error_type: "none",
          chat_stream_phase: phase,
        },
        extra: {
          requestId,
          chatId,
          model,
          provider,
          isAuthenticated,
          messageCount: validatedMessages.length,
          chatVersion: normalizedChatVersion,
          elapsedMs: now - streamStartMs,
          firstTokenLatencyMs: firstChunkLatencyMs,
          timeSinceLastChunkMs: lastChunkAtMs === null ? null : now - lastChunkAtMs,
          timeSinceLastProgressMs: now - lastProgressAtMs,
          stalledThresholdMs: stalledContinuationThresholdMs,
          stepCounter,
          observedToolCalls,
          lastStepFinishReason,
          lastToolStepNumber,
          lastToolNames,
          awaitingPostToolContinuation,
          postToolContinuationDelayMs:
            postToolContinuationArmedAtMs === null
              ? null
              : now - postToolContinuationArmedAtMs,
          mcpClientCount: mcpClients.length,
        },
      })
    }

    const armStalledContinuationTimer = () => {
      clearStalledContinuationTimer()
      if (stalledContinuationCaptured || abortCaptured || streamCompleted) {
        return
      }
      awaitingPostToolContinuation = true
      postToolContinuationArmedAtMs = Date.now()
      stalledContinuationTimer = setTimeout(() => {
        if (stalledContinuationCaptured || abortCaptured || streamCompleted) {
          return
        }
        stalledContinuationCaptured = true
        captureChatLifecycleSignal(
          "chat_stalled_continuation",
          "post_tool_continue"
        )
      }, stalledContinuationThresholdMs)
    }

    const resolvePostToolContinuation = () => {
      awaitingPostToolContinuation = false
      postToolContinuationArmedAtMs = null
      clearStalledContinuationTimer()
    }

    const handleRequestAbort = () => {
      if (abortCaptured || streamCompleted) return
      abortCaptured = true
      resolvePostToolContinuation()
      captureChatLifecycleSignal("chat_client_abort")
    }

    if (req.signal.aborted) {
      handleRequestAbort()
    } else {
      req.signal.addEventListener("abort", handleRequestAbort, { once: true })
      after(() => {
        req.signal.removeEventListener("abort", handleRequestAbort)
      })
    }

    const mcpServerCount = new Set(
      Array.from(mcpToolServerMap.values()).map((info) => info.serverId)
    ).size
    const braintrustMetadata: BraintrustChatMetadata = {
      requestId,
      route: "api/chat",
      operation: "stream_text",
      chatIdHash: await hashBraintrustIdentifier(chatId),
      model,
      provider,
      isAuthenticated,
      messageCount: validatedMessages.length,
      chatVersionBucket: bucketChatVersion(normalizedChatVersion),
      searchEnabled: shouldInjectSearch,
      hasTools: hasAnyTools,
      keyMode: providerToolKeyMode,
      exaKeyMode: resolvedExaKeyMode ?? null,
      maxSteps,
      capabilities: {
        search: toolPolicy.capabilities.search,
        extract: toolPolicy.capabilities.extract,
        code: toolPolicy.capabilities.code,
        mcp: toolPolicy.capabilities.mcp,
        platform: toolPolicy.capabilities.platform,
      },
      capabilityReasons: toolPolicy.capabilityReasons,
      toolPolicy: {
        userTier: toolPolicy.userTier,
        keyMode: toolPolicy.keyMode ?? null,
        keyModeReason: toolPolicy.keyModeReason,
        totalTools: toolPolicy.toolDecisions.length,
        earlyAllowedCount: toolPolicy.earlyToolNames.length,
        lateAllowedCount: toolPolicy.lateToolNames.length,
      },
      toolCounts: {
        builtIn: Object.keys(builtInTools).length,
        thirdParty: Object.keys(thirdPartyTools).length,
        content: Object.keys(contentTools).length,
        mcp: Object.keys(mcpTools).length,
        total: Object.keys(allTools).length,
      },
      mcp: {
        serverCount: mcpServerCount,
        toolCount: Object.keys(mcpTools).length,
      },
      historyAdaptation: {
        warningCount: adapterResult.warnings.length,
        warningCodes: countWarningsByCode(adapterResult.warnings),
      },
    }

    const runGeneration = (braintrustSpan: BraintrustTraceSpan) =>
      braintrustStreamText({
      model: aiModel,
      system: enrichedSystemPrompt,
      messages: modelMessages,
      tools: allTools,
      stopWhen: stepCountIs(maxSteps),
      experimental_telemetry: {
        isEnabled: true,
        functionId: "api.chat.streamText",
        metadata: {
          route: "api/chat",
          operation: "stream_text",
          conversationId: chatId,
          provider,
          model,
          isAuthenticated,
          hasTools: hasAnyTools,
          enableSearch: shouldInjectSearch,
          chatVersionBucket: bucketChatVersion(normalizedChatVersion),
        },
      },

      // Centralized step gating from the capability policy resolver.
      // After PREPARE_STEP_THRESHOLD, only late-step-safe tools remain
      // (currently read_only risk class). Unknown risk fails closed.
      prepareStep: hasAnyTools
        ? async ({ stepNumber }) => {
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

            return { activeTools: budgetAllowedTools }
          }
        : undefined,

      // Per-step structured tracing.
      // Captures tool name, duration, token usage, and success per step.
      // This data feeds into the existing toolCallLog for trajectory analysis
      // and future trace-based evaluation.
      onStepFinish: async ({ toolCalls, toolResults, usage, finishReason }) => {
        stepCounter++
        observedToolCalls += toolCalls.length
        lastProgressAtMs = Date.now()
        lastStepFinishReason = finishReason ?? null
        if (toolCalls.length === 0) return

        for (const call of toolCalls) {
          if (!builtInToolNames.has(call.toolName)) continue
          try {
            await builtInPolicyGuard.enforceToolBudget(call.toolName)
            if (degradedBuiltInTools.delete(call.toolName)) {
              console.warn(
                JSON.stringify({
                  _tag: "tool_budget_post_accounting_recovered",
                  requestId,
                  tool: call.toolName,
                  source: "builtin",
                  keyMode: providerToolKeyMode,
                  action: "resume_policy_enforced_budgeting",
                })
              )
            }
          } catch (error) {
            if (isPolicyUnavailableError(error)) {
              degradedBuiltInTools.add(call.toolName)
              const softCap = degradedBuiltInSoftCap.recordCall(call.toolName)
              console.warn(
                JSON.stringify({
                  _tag: "tool_budget_post_accounting_degraded",
                  requestId,
                  tool: call.toolName,
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
              continue
            }
            exhaustedBuiltInTools.add(call.toolName)
            console.warn(
              JSON.stringify({
                _tag: "tool_budget_post_accounting_denied",
                requestId,
                tool: call.toolName,
                source: "builtin",
                keyMode: providerToolKeyMode,
                error: error instanceof Error ? error.message : String(error),
                action: "disable_tool_for_remaining_steps",
              })
            )
          }
        }

        for (const call of toolCalls) {
          const result = toolResults.find(
            (r) => r.toolCallId === call.toolCallId
          )
          const success = result
            ? !(result as { isError?: boolean }).isError
            : false
          const meta = toolMetadataResolver.getNonMcp(call.toolName)
          const trace = traceCollector.get(call.toolCallId)

          // Structured JSON log — parseable by Vercel log drain and grep.
          // Uses _tag for machine filtering without affecting human readability.
          console.log(
            JSON.stringify({
              _tag: "tool_trace",
              requestId,
              chatId,
              userId,
              step: stepCounter,
              tool: meta?.displayName ?? call.toolName,
              source: meta?.source ?? "unknown",
              success,
              durationMs: trace?.durationMs ?? null,
              estimatedCostPer1k: meta?.estimatedCostPer1k ?? null,
              errorCode: trace?.errorCode ?? null,
              retryAfterSeconds: trace?.retryAfterSeconds ?? null,
              budgetKeyMode: trace?.budgetKeyMode ?? null,
              budgetDenied: trace?.budgetDenied ?? null,
              tokens: {
                in: usage?.inputTokens ?? null,
                out: usage?.outputTokens ?? null,
              },
              finishReason,
              model,
            })
          )
        }

        if (durableRunState && convexToken) {
          const invocations: ToolInvocationForPersistence[] = toolCalls.map(
            (call) => {
              const result = toolResults.find(
                (candidate) => candidate.toolCallId === call.toolCallId
              )
              const isError = result
                ? Boolean((result as { isError?: boolean }).isError)
                : false
              const approvalDecision = runtimeApprovalByToolName.get(call.toolName)
              return {
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                source: toolMetadataResolver.source(call.toolName),
                input: call.input,
                output: result?.output,
                error: isError
                  ? String((result as { output?: unknown })?.output ?? "Tool failed")
                  : undefined,
                status: result
                  ? isError
                    ? "failed"
                    : "completed"
                  : approvalDecision?.needsApproval
                    ? "pending_approval"
                    : "called",
              }
            }
          )

          void fetchMutation(
            api.chatRuntime.recordToolInvocations,
            {
              runId: durableRunState.runId,
              chatId: chatId as Id<"chats">,
              messageId: durableRunState.assistantMessageId,
              stepNumber: stepCounter,
              invocations,
            },
            { token: convexToken }
          ).catch((error: unknown) => {
            console.warn(
              JSON.stringify({
                _tag: "canonical_tool_invocation_write_failed",
                requestId,
                chatId,
                runId: durableRunState?.runId,
                error: error instanceof Error ? error.message : String(error),
              })
            )
          })
        }

        if (finishReason === "tool-calls") {
          lastToolStepNumber = stepCounter
          lastToolNames = toolCalls.map((call) => call.toolName)
          armStalledContinuationTimer()
        } else {
          resolvePostToolContinuation()
        }
      },

      ...(Object.keys(providerOptions).length > 0 && { providerOptions }),
      ...(Object.keys(requestHeaders).length > 0 && { headers: requestHeaders }),
      ...(durableRunState && convexToken
        ? {
            experimental_transform: createRuntimeApprovalPersistenceTransform({
              chatId,
              convexToken,
              durableRunState,
              runtimeApprovalByToolName,
              toolMetadataResolver,
              approvalWritePromises,
              requestId,
            }),
          }
        : {}),

      onChunk: ({ chunk }) => {
        const now = Date.now()
        lastChunkAtMs = now
        lastProgressAtMs = now
        resolvePostToolContinuation()
        durableRunState?.snapshotTracker?.onChunk(chunk)
        if (firstChunkLatencyMs === null) {
          firstChunkLatencyMs = now - streamStartMs
        }
        if (chunk.type === "reasoning-delta" && reasoningStartMs === null) {
          reasoningStartMs = now
        }
        // When text-delta arrives after reasoning, reasoning is done
        if (
          chunk.type === "text-delta" &&
          reasoningStartMs !== null &&
          reasoningDurationMs === null
        ) {
          reasoningDurationMs = now - reasoningStartMs
        }
      },

      onError: (err: unknown) => {
        streamCompleted = true
        resolvePostToolContinuation()
        console.error("Streaming error occurred:", err)
        const errorMessage = extractErrorMessage(err)
        const errorType = classifyChatError(err)
        if (durableRunState && convexToken) {
          void fetchMutation(
            api.chatRuntime.markGenerationRunFailed,
            {
              runId: durableRunState.runId,
              messageId: durableRunState.assistantMessageId,
              error: errorMessage,
            },
            { token: convexToken }
          ).catch((error: unknown) => {
            console.warn(
              JSON.stringify({
                _tag: "durable_run_failed_write_failed",
                requestId,
                chatId,
                runId: durableRunState?.runId,
                error: error instanceof Error ? error.message : String(error),
              })
            )
          })
        }
        logBraintrustTraceMetadata(braintrustSpan, {
          ...braintrustMetadata,
          ...getBraintrustErrorMetadata(err),
          errorType,
        })

        if (isReplayShapeError(errorMessage)) {
          console.error(
            JSON.stringify({
              _tag: "replay_shape_error",
              chatId,
              provider,
              model,
              errorMessage,
              messageCount: validatedMessages.length,
              historyPartTypes: summarizeHistoryPartTypes(validatedMessages),
            })
          )
        }

        // Capture failed generations to PostHog for complete analytics
        if (phClient) {
          try {
            const latencyMs = Date.now() - startTime
            captureGeneration({
              distinctId: userId,
              traceId: chatId,
              model,
              provider,
              input: scrubForAnalytics(validatedMessages),
              output: null,
              latencyMs,
              isError: true,
              errorMessage,
              properties: {
                isAuthenticated,
              },
            })
          } catch (captureErr) {
            console.error("[PostHog] Failed to capture error event:", captureErr)
          }
        }
      },

      onAbort: async () => {
        streamCompleted = true
        resolvePostToolContinuation()
        if (durableRunState && convexToken) {
          await durableRunState.snapshotTracker?.flush().catch(() => {})
          await fetchMutation(
            api.chatRuntime.markGenerationRunAborted,
            {
              runId: durableRunState.runId,
              messageId: durableRunState.assistantMessageId,
              reason: "stream aborted",
            },
            { token: convexToken }
          )
        }
      },

      onFinish: async ({ text, usage, steps, finishReason }) => {
        streamCompleted = true
        lastProgressAtMs = Date.now()
        resolvePostToolContinuation()
        await durableRunState?.snapshotTracker?.flush().catch(() => {})
        if (steps) {
          const resolvedByCallId: ToolInvocationMetadataByCallId = {}
          for (const step of steps) {
            for (const toolCall of step.toolCalls ?? []) {
              const resolved = toolMetadataByName[toolCall.toolName]
              if (resolved) {
                resolvedByCallId[toolCall.toolCallId] = resolved
              }
            }
          }
          toolMetadataByCallId = resolvedByCallId
        }

        // Freeze reasoning duration if it wasn't already frozen by text-delta
        // (e.g. reasoning-only responses with no text output, or errors)
        if (reasoningStartMs !== null && reasoningDurationMs === null) {
          reasoningDurationMs = Date.now() - reasoningStartMs
        }

        let totalToolCalls = 0
        let failedToolCalls = 0
        let timeoutToolCalls = 0
        let budgetDeniedToolCalls = 0

        for (const step of steps ?? []) {
          for (const toolCall of step.toolCalls ?? []) {
            totalToolCalls++
            const trace = traceCollector.get(toolCall.toolCallId)
            const result = step.toolResults?.find(
              (r: { toolCallId: string }) => r.toolCallId === toolCall.toolCallId
            )
            const failed = result ? Boolean((result as { isError?: boolean }).isError) : true
            if (failed) failedToolCalls++
            if (trace?.budgetDenied) budgetDeniedToolCalls++
            if (
              isTimeoutSignal(trace?.errorCode) ||
              isTimeoutSignal(trace?.error) ||
              isTimeoutSignal(
                result &&
                  typeof (result as { output?: unknown }).output === "string"
                  ? ((result as { output?: unknown }).output as string)
                  : undefined
              )
            ) {
              timeoutToolCalls++
            }
          }
        }

        const toolOutcome: ToolExecutionOutcome =
          totalToolCalls === 0
            ? "none"
            : budgetDeniedToolCalls > 0
              ? "budget_denied"
              : timeoutToolCalls > 0
                ? "timeout"
                : failedToolCalls > 0
                ? "failure"
                  : "success"

        durableFinalUsage = {
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          totalTokens:
            typeof usage?.totalTokens === "number"
              ? usage.totalTokens
              : undefined,
        }
        durableFinalFinishReason = finishReason
        durableFinalToolCounts = { totalToolCalls, failedToolCalls }

        const totalLatencyMs = Date.now() - streamStartMs
        logBraintrustTraceMetadata(braintrustSpan, {
          ...braintrustMetadata,
          finishReason: finishReason ?? null,
          toolOutcome,
          totalToolCalls,
          failedToolCalls,
          timeoutToolCalls,
          budgetDeniedToolCalls,
          firstTokenLatencyBucket:
            firstChunkLatencyMs === null
              ? null
              : bucketLatencyMs(firstChunkLatencyMs),
          totalLatencyBucket: bucketLatencyMs(totalLatencyMs),
          usage: {
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
          },
          reasoningDurationMs,
        })
        Sentry.setTag("chat_finish_reason", finishReason ?? "unknown")
        Sentry.setTag("chat_error_type", "none")
        Sentry.setTag("chat_tool_outcome", toolOutcome)
        Sentry.setTag("chat_total_latency_bucket", bucketLatencyMs(totalLatencyMs))
        if (firstChunkLatencyMs !== null) {
          Sentry.setTag(
            "chat_first_token_latency_bucket",
            bucketLatencyMs(firstChunkLatencyMs)
          )
        }
        Sentry.setContext("chat_response", {
          requestId,
          finishReason,
          toolOutcome,
          totalToolCalls,
          failedToolCalls,
          timeoutToolCalls,
          budgetDeniedToolCalls,
          firstTokenLatencyMs: firstChunkLatencyMs,
          totalLatencyMs,
          reasoningDurationMs,
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
        })
        if (totalLatencyMs >= slowRequestThresholdMs) {
          Sentry.captureMessage("chat_slow_request", {
            level: "warning",
            tags: {
              route: "api/chat",
              chat_provider: provider,
              chat_model: model,
              chat_tool_outcome: toolOutcome,
              chat_finish_reason: finishReason ?? "unknown",
              chat_error_type: "none",
            },
            extra: {
              requestId,
              chatId,
              totalLatencyMs,
              firstTokenLatencyMs: firstChunkLatencyMs,
              thresholdMs: slowRequestThresholdMs,
              totalToolCalls,
              failedToolCalls,
              timeoutToolCalls,
              budgetDeniedToolCalls,
              inputTokens: usage?.inputTokens,
              outputTokens: usage?.outputTokens,
              isAuthenticated,
            },
          })
        }

        // ---------------------------------------------------------------
        // Finish reason observability
        // Log when the response was truncated (finishReason: "length")
        // so we can detect max_tokens exhaustion in dev and production.
        // ---------------------------------------------------------------
        if (finishReason === "length") {
          console.warn(
            `[chat] Response truncated (finishReason: "length") — model: ${model}, ` +
            `outputTokens: ${usage?.outputTokens ?? "?"}, ` +
            `inputTokens: ${usage?.inputTokens ?? "?"}`
          )
        }
        if (process.env.NODE_ENV !== "production") {
          // Log both unified and raw finish reasons. The raw reason reveals
          // provider-specific signals (e.g. Anthropic's "pause_turn" vs
          // "end_turn") that the unified reason collapses into "stop".
          const rawReason = steps?.[steps.length - 1]?.rawFinishReason
          console.log(
            `[chat] finishReason: ${finishReason}` +
            `${rawReason && rawReason !== finishReason ? ` (raw: ${rawReason})` : ""}, ` +
            `model: ${model}, ` +
            `tokens: ${usage?.inputTokens ?? "?"}in/${usage?.outputTokens ?? "?"}out, ` +
            `text: ${text?.length ?? 0} chars`
          )
        }

        if (process.env.NODE_ENV !== "production" && provider === "anthropic" && hasAnyTools) {
          console.log(
            `[chat] Anthropic tool usage — inputTokens: ${usage?.inputTokens ?? "?"}, ` +
            `toolCount: ${Object.keys(allTools).length}, ` +
            `tokenEfficient: ${isTokenEfficient}`
          )
        }

        // Manually capture LLM generation for PostHog analytics
        // This ensures accurate output capture (withTracing has issues with streaming)
        if (phClient) {
          try {
            const latencyMs = Date.now() - startTime
            captureGeneration({
              distinctId: userId,
              traceId: chatId,
              model,
              provider,
              input: scrubForAnalytics(validatedMessages),
              output: scrubForAnalytics(text),
              inputTokens: usage?.inputTokens,
              outputTokens: usage?.outputTokens,
              latencyMs,
              properties: {
                isAuthenticated,
                finishReason,
              },
            })

            // PostHog: unified tool call events — one event per tool invocation (all sources)
            // Replaces the previous MCP-only mcp_tool_call event.
            if (steps) {
              for (const step of steps) {
                if (step.toolCalls) {
                  for (const toolCall of step.toolCalls) {
                    const resolved = toolMetadataResolver.get(toolCall.toolName)
                    const mcpServer = resolved?.mcpServer

                    // Determine source and service name
                    const source = resolved?.source ?? "unknown"
                    const serviceName = resolved?.serviceName ?? "unknown"
                    const displayName = mcpServer
                      ? mcpServer.displayName
                      : (resolved?.displayName ?? toolCall.toolName)

                    const toolResult = step.toolResults?.find(
                      (r: { toolCallId: string }) => r.toolCallId === toolCall.toolCallId
                    )
                    const success = toolResult
                      ? !(toolResult as { isError?: boolean }).isError
                      : false
                    const trace = traceCollector.get(toolCall.toolCallId)

                    phClient.capture({
                      distinctId: userId,
                      event: "tool_call",
                      properties: {
                        toolName: displayName,
                        rawToolName: toolCall.toolName,
                        source,
                        serviceName,
                        success,
                        chatId,
                        chatVersion: normalizedChatVersion,
                        // Phase C: Observability enrichment
                        durationMs: trace?.durationMs ?? undefined,
                        errorCode: trace?.errorCode,
                        retryAfterSeconds: trace?.retryAfterSeconds,
                        budgetKeyMode: trace?.budgetKeyMode,
                        budgetDenied: trace?.budgetDenied,
                        requestId,
                        // MCP-specific (optional)
                        ...(mcpServer && {
                          serverId: mcpServer.serverId,
                          serverName: mcpServer.serverName,
                        }),
                      },
                    })
                  }
                }
              }
            }
          } catch (captureErr) {
            // Analytics failure should never break the response
            console.error(
              "[PostHog] Failed to capture generation event:",
              captureErr
            )
          }
        }

        // Audit log: persist MCP tool calls to toolCallLog (fire-and-forget).
        // These writes are best-effort — failures are swallowed to avoid breaking
        // the streaming response. Follows the same pattern as updateConnectionStatus
        // in lib/mcp/load-tools.ts.
        if (convexToken && steps && mcpToolServerMap.size > 0) {
          let finishStepNumber = 0

          for (const step of steps) {
            finishStepNumber++

            if (step.toolCalls) {
              for (const toolCall of step.toolCalls) {
                const serverInfo = mcpToolServerMap.get(toolCall.toolName)
                if (!serverInfo) continue

                // Find matching tool result for output preview
                const toolResult = step.toolResults?.find(
                  (r: { toolCallId: string }) =>
                    r.toolCallId === toolCall.toolCallId
                )

                const success = toolResult
                  ? !(toolResult as { isError?: boolean }).isError
                  : false

                const previewData = toolResult?.output
                const trace = traceCollector.get(toolCall.toolCallId)

                void fetchMutation(
                  api.toolCallLog.log,
                  {
                    chatId: chatId as Id<"chats">,
                    serverId: serverInfo.serverId as Id<"mcpServers">,
                    toolName: serverInfo.displayName,
                    toolCallId: toolCall.toolCallId,
                    inputPreview: JSON.stringify(toolCall.input).slice(0, 500),
                    outputPreview: previewData
                      ? JSON.stringify(previewData).slice(0, 500)
                      : undefined,
                    success,
                    durationMs: trace?.durationMs,
                    error: trace?.error,
                    source: "mcp",
                    serviceName: serverInfo.serverName,
                    // Phase C: Observability enrichment
                    stepNumber: finishStepNumber,
                    inputTokens: step.usage?.inputTokens,
                    outputTokens: step.usage?.outputTokens,
                    resultSizeBytes: trace?.resultSizeBytes,
                    requestId,
                    errorCode: trace?.errorCode,
                    retryAfterSeconds: trace?.retryAfterSeconds,
                    budgetKeyMode: trace?.budgetKeyMode,
                    budgetDenied: trace?.budgetDenied,
                    chatVersion: normalizedChatVersion,
                    toolKey: toolCall.toolName,
                  },
                  { token: convexToken }
                ).catch((err: unknown) => {
                  console.warn(JSON.stringify({
                    _tag: "tool_call_log_write_failed",
                    requestId,
                    chatId,
                    toolCallId: toolCall.toolCallId,
                    toolName: serverInfo.displayName,
                    source: "mcp",
                    stepNumber: finishStepNumber,
                    error: err instanceof Error ? err.message : String(err),
                  }))
                })
              }
            }
          }
        }

        // Audit log: persist built-in + third-party tool calls (fire-and-forget).
        // Identifies non-MCP tools by checking if the tool name is NOT in mcpToolServerMap.
        if (convexToken && steps) {
          if (toolMetadataResolver.sizeNonMcp > 0) {
            let finishStepNumber = 0

            for (const step of steps) {
              finishStepNumber++

              if (step.toolCalls) {
                for (const toolCall of step.toolCalls) {
                  // Skip MCP tools (already logged above)
                  if (toolMetadataResolver.isMcp(toolCall.toolName)) continue

                  const meta = toolMetadataResolver.getNonMcp(toolCall.toolName)
                  if (!meta) continue // Unknown tool — skip

                  const toolResult = step.toolResults?.find(
                    (r: { toolCallId: string }) =>
                      r.toolCallId === toolCall.toolCallId
                  )
                  const success = toolResult
                    ? !(toolResult as { isError?: boolean }).isError
                    : false

                  const previewData = toolResult?.output

                  const trace = traceCollector.get(toolCall.toolCallId)

                  void fetchMutation(
                    api.toolCallLog.log,
                    {
                      chatId: chatId as Id<"chats">,
                      toolName: meta.displayName,
                      toolCallId: toolCall.toolCallId,
                      inputPreview: JSON.stringify(toolCall.input).slice(0, 500),
                      outputPreview: previewData
                        ? JSON.stringify(previewData).slice(0, 500)
                        : undefined,
                      success,
                      durationMs: trace?.durationMs,
                      source: meta.source,
                      serviceName: meta.serviceName,
                      // Phase C: Observability enrichment
                      stepNumber: finishStepNumber,
                      inputTokens: step.usage?.inputTokens,
                      outputTokens: step.usage?.outputTokens,
                      resultSizeBytes: trace?.resultSizeBytes,
                      requestId,
                      errorCode: trace?.errorCode,
                      retryAfterSeconds: trace?.retryAfterSeconds,
                      budgetKeyMode: trace?.budgetKeyMode,
                      budgetDenied: trace?.budgetDenied,
                      chatVersion: normalizedChatVersion,
                      toolKey: toolCall.toolName,
                    },
                    { token: convexToken }
                  ).catch((err: unknown) => {
                    console.warn(JSON.stringify({
                      _tag: "tool_call_log_write_failed",
                      requestId,
                      chatId,
                      toolCallId: toolCall.toolCallId,
                      toolName: meta.displayName,
                      source: meta.source,
                      stepNumber: finishStepNumber,
                      error: err instanceof Error ? err.message : String(err),
                    }))
                  })
                }
              }
            }
          }
        }
      }
    })

    const result = withBraintrustTrace(
      {
        name: "POST /api/chat",
        metadata: braintrustMetadata,
        onError: (span, error) => {
          logBraintrustTraceMetadata(span, {
            ...braintrustMetadata,
            ...getBraintrustErrorMetadata(error),
            errorType: classifyChatError(error),
          })
        },
      },
      runGeneration
    )

    return result.toUIMessageStreamResponse({
      originalMessages: durableRunState?.originalMessages ?? validatedMessages,
      generateMessageId: durableRunState
        ? () => durableRunState!.assistantMessageId
        : undefined,
      sendReasoning: true,
      sendSources: true,
      consumeSseStream: consumeStream,
      messageMetadata: ({ part }) => {
        if (part.type === "start") {
          return buildStartToolInvocationStreamMetadata(toolMetadataByName)
        }
        if (part.type === "finish") {
          return buildFinishToolInvocationStreamMetadata({
            toolMetadataByCallId,
            reasoningDurationMs,
          })
        }
        return {}
      },
      onFinish: async ({ responseMessage, isAborted, finishReason }) => {
        if (!durableRunState || !convexToken) return

        await Promise.allSettled(approvalWritePromises)
        await durableRunState.snapshotTracker?.flush().catch(() => {})

        if (isAborted) {
          await fetchMutation(
            api.chatRuntime.markGenerationRunAborted,
            {
              runId: durableRunState.runId,
              messageId: durableRunState.assistantMessageId,
              reason: "ui message stream aborted",
            },
            { token: convexToken }
          )
          return
        }

        const toolCounts =
          durableFinalToolCounts ?? countToolParts(responseMessage)
        await fetchMutation(
          api.chatRuntime.markGenerationRunCompleted,
          {
            runId: durableRunState.runId,
            messageId: durableRunState.assistantMessageId,
            content: getFinalAssistantText(responseMessage),
            parts: responseMessage.parts,
            metadata: responseMessage.metadata,
            finishReason: durableFinalFinishReason ?? finishReason,
            usage: durableFinalUsage,
            totalToolCalls: toolCounts.totalToolCalls,
            failedToolCalls: toolCounts.failedToolCalls,
          },
          { token: convexToken }
        )
      },
      onError: (error: unknown) => {
        console.error("Error forwarded to client:", error)
        const errorType = classifyChatError(error)
        Sentry.captureException(error, {
          tags: {
            route: "api/chat",
            chat_model: model,
            chat_provider: provider,
            chat_is_authenticated: String(isAuthenticated),
            chat_error_type: errorType,
            chat_error_has_tool_signal: getToolDimensionForError(errorType),
          },
          extra: {
            requestId,
            chatId,
            model,
            provider,
            errorType,
            isAuthenticated,
            messageCount: validatedMessages.length,
            chatVersion: normalizedChatVersion,
          },
        })
        return extractErrorMessage(error)
      },
    });
  } catch (err: unknown) {
    // Clean up any MCP clients that were opened before the error
    await Promise.allSettled(mcpClients.map((c) => c.close()))

    console.error("Error in /api/chat:", err)
    const error = err as {
      code?: string
      message?: string
      statusCode?: number
    }
    const errorType = classifyChatError(err)
    if (durableRunState && durableConvexToken) {
      await fetchMutation(
        api.chatRuntime.markGenerationRunFailed,
        {
          runId: durableRunState.runId,
          messageId: durableRunState.assistantMessageId,
          error: extractErrorMessage(err),
        },
        { token: durableConvexToken }
      ).catch((writeError: unknown) => {
        console.warn(
          JSON.stringify({
            _tag: "durable_run_failed_write_failed",
            requestId,
            chatId: telemetryChatId,
            runId: durableRunState?.runId,
            error:
              writeError instanceof Error
                ? writeError.message
                : String(writeError),
          })
        )
      })
    }

    Sentry.captureException(err, {
      tags: {
        route: "api/chat",
        ...(telemetryModel ? { chat_model: telemetryModel } : {}),
        ...(telemetryProvider ? { chat_provider: telemetryProvider } : {}),
        chat_is_authenticated:
          telemetryIsAuthenticated === undefined
            ? "unknown"
            : String(telemetryIsAuthenticated),
        chat_error_type: errorType,
        chat_error_has_tool_signal: getToolDimensionForError(errorType),
      },
      extra: {
        requestId,
        chatId: telemetryChatId,
        model: telemetryModel,
        provider: telemetryProvider,
        errorType,
        isAuthenticated: telemetryIsAuthenticated,
        messageCount: telemetryMessageCount,
        mcpClientCount: mcpClients.length,
      },
    })

    return createErrorResponse(error)
  }
}
