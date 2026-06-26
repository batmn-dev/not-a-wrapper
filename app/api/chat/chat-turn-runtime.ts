import * as Sentry from "@sentry/nextjs"
import { after } from "next/server"
import {
  SYSTEM_PROMPT_DEFAULT,
  MCP_MAX_STEP_COUNT,
  DEFAULT_MAX_STEP_COUNT,
  ANONYMOUS_MAX_STEP_COUNT,
  HISTORY_REPLAY_COMPILER_V1,
} from "@/lib/config"
import { getAllModels } from "@/lib/models"
import type { ModelConfig } from "@/lib/models/types"
import { getProviderForModel } from "@/lib/openproviders/provider-map"
import { createLanguageModel } from "@/lib/openproviders/create-language-model"
import { shapeRequest } from "@/lib/openproviders/request-shaping"
import {
  captureGeneration,
  flushPostHog,
  getPostHogClient,
} from "@/lib/posthog"
import { scrubForAnalytics } from "@/lib/posthog/scrub"
import type { Provider, ToolKeyMode } from "@/lib/user-keys"
import {
  UIMessage as MessageAISDK,
  consumeStream,
  stepCountIs,
  convertToModelMessages,
  validateUIMessages,
  type ModelMessage,
} from "ai"
import {
  fetchMutation as defaultFetchMutation,
  fetchQuery as defaultFetchQuery,
} from "convex/nextjs"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { projectPersistedMessageMetadata } from "@/convex/lib/messageMetadata"
import {
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
import { prepareToolRuntime, type ToolRuntime } from "@/lib/tools/runtime"
import {
  createPostHogToolCallSink,
  createToolCallLogSink,
  createToolTraceLogSink,
} from "./outcome-sinks"
import {
  buildFinishToolInvocationStreamMetadata,
  buildStartToolInvocationStreamMetadata,
  type ToolInvocationMetadataByCallId,
  type ToolInvocationMetadataByName,
} from "@/lib/tools/ui-metadata"
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
  sanitizeModelHistoryMessages,
  toDurableUiMessages,
  type DurableUiMessage,
  type ToolInvocationForPersistence,
} from "./durable-runtime"

// ---------------------------------------------------------------------------
// Chat turn runtime (CONTEXT.md): the server-side execution of one Chat turn
// for one HTTP request, prepared once and alive for the whole stream. The chat
// route (`route.ts`) is a thin HTTP adapter over this module — see
// `docs/adr/0006-chat-turn-runtime.md`. Two-phase: `prepare()` resolves the
// execution plan and may throw status-coded errors before any model call;
// `toResponse(signal)` invokes streamText, owns the stream-lifecycle state and
// both `onFinish` layers, and returns the streaming Response; `fail(error)`
// finalizes a failed run for the route's outer catch.
// ---------------------------------------------------------------------------

export type ChatEditRequest = {
  editedMessageId: string
  editCutoffTimestamp: number
  expectedChatVersion: number
  replacementMessage: {
    id: string
    role: "user"
    content: string
    parts: MessageAISDK["parts"]
  }
  title?: string
}

export type ChatRegenerationRequest = {
  targetAssistantMessageId: string
  targetAssistantCreatedAt: number
  expectedChatVersion: number
  precedingUserMessageId: string
}

export type ChatRequest = {
  messages: MessageAISDK[]
  chatId: string
  model: string
  systemPrompt: string
  enableSearch: boolean
  chatVersion?: number
  expectedVisibleMessageCount?: number
  tailMessageId?: string
  userId?: string // Client-provided userId (for anonymous users)
  edit?: ChatEditRequest
  regeneration?: ChatRegenerationRequest
}

/**
 * The validated, admitted Chat turn the route hands to the runtime: parse,
 * auth, validation 400/401, and usage admission have all happened already.
 * `model` is post-`resolveModelId`; `userId` is the resolved caller id.
 */
export type ChatTurnInput = {
  messages: MessageAISDK[]
  chatId: string
  model: string
  systemPrompt: string
  enableSearch: boolean
  chatVersion?: number
  expectedVisibleMessageCount?: number
  tailMessageId?: string
  edit?: ChatEditRequest
  regeneration?: ChatRegenerationRequest
  requestId: string
  userId: string
  anonymousId: string | undefined
  isAuthenticated: boolean
  convexToken: string | undefined
}

/**
 * Injected dependencies — defaulted to the real implementations, overridable in
 * tests so a whole turn (prepare, stream callbacks, durable writes) can run
 * without an HTTP request or a live model.
 */
export type ChatTurnDeps = {
  streamText: typeof import("ai").streamText
  fetchMutation: typeof defaultFetchMutation
  fetchQuery: typeof defaultFetchQuery
  after: typeof after
  getPostHogClient: typeof getPostHogClient
}

function resolveDeps(overrides?: Partial<ChatTurnDeps>): ChatTurnDeps {
  return {
    streamText: overrides?.streamText ?? getBraintrustStreamText(),
    fetchMutation: overrides?.fetchMutation ?? defaultFetchMutation,
    fetchQuery: overrides?.fetchQuery ?? defaultFetchQuery,
    after: overrides?.after ?? after,
    getPostHogClient: overrides?.getPostHogClient ?? getPostHogClient,
  }
}

type DurableRunState = {
  runId: Id<"generationRuns">
  assistantMessageId: Id<"messages">
  assistantOrder: number
  originalMessages: DurableUiMessage[]
  snapshotTracker: ReturnType<typeof createDurableSnapshotTracker> | null
}

type ChatStreamPhase =
  | "pre_first_chunk"
  | "post_tool_continue"
  | "post_first_chunk"
  | "unknown"

type ToolExecutionOutcome =
  | "none"
  | "success"
  | "failure"
  | "timeout"
  | "budget_denied"

type PreparedTurn = {
  aiModel: ReturnType<typeof createLanguageModel>
  modelConfig: ModelConfig
  provider: string
  normalizedChatVersion: number
  hasAnyTools: boolean
  shouldInjectSearch: boolean
  maxSteps: number
  startTime: number
  validatedMessages: MessageAISDK[]
  modelMessages: ModelMessage[]
  providerOptions: ReturnType<typeof shapeRequest>["providerOptions"]
  requestHeaders: ReturnType<typeof shapeRequest>["headers"]
  toolMetadataByName: ToolInvocationMetadataByName
  enrichedSystemPrompt: string
  braintrustMetadata: BraintrustChatMetadata
  phClient: ReturnType<typeof getPostHogClient>
}

// --- module-level pure helpers (moved verbatim from route.ts) ---------------

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

export function getToolDimensionForError(
  errorType: ChatErrorType
): "yes" | "no" {
  return errorType === "tool_timeout" || errorType === "tool_execution"
    ? "yes"
    : "no"
}

function bucketLatencyMs(latencyMs: number): string {
  if (latencyMs <= 1000) return "le_1s"
  if (latencyMs <= 3000) return "1s_3s"
  if (latencyMs <= 8000) return "3s_8s"
  if (latencyMs <= 15000) return "8s_15s"
  return "gt_15s"
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

function countWarningsByCode(
  warnings: AdaptationWarning[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const warning of warnings) {
    counts[warning.code] = (counts[warning.code] ?? 0) + 1
  }
  return counts
}

function summarizeReplayWarningDetails(
  warnings: AdaptationWarning[],
  code: "replay_normalization_warning" | "replay_compile_warning"
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const warning of warnings) {
    if (warning.code !== code) continue
    const subcode = warning.detail.split(":")[0]?.trim() || "unknown"
    counts[subcode] = (counts[subcode] ?? 0) + 1
  }
  return counts
}

export type ChatTurnRuntime = {
  /**
   * Resolve the execution plan: model/key, Tool runtime, durable-prepare,
   * history adaptation, request shaping. May throw errors carrying
   * `{ statusCode, code }` (missing key → 401, durable concurrency → 4xx) which
   * the route maps via `createErrorResponse`. Must run before `toResponse`.
   */
  prepare(): Promise<void>
  /**
   * Invoke streamText, own the stream-lifecycle state and both `onFinish`
   * layers, and return the streaming Response. The abort signal is wired to the
   * stream and to the chat lifecycle telemetry here.
   */
  toResponse(signal: AbortSignal): Response
  /**
   * Finalize a failed turn for the route's outer catch: dispose MCP clients,
   * mark the durable run failed (if one started), and capture to Sentry. Safe
   * even when the stream never started.
   */
  fail(error: unknown): Promise<void>
}

export function createChatTurnRuntime(args: {
  input: ChatTurnInput
  deps?: Partial<ChatTurnDeps>
}): ChatTurnRuntime {
  const { input } = args
  const deps = resolveDeps(args.deps)
  const {
    messages,
    chatId,
    model,
    systemPrompt,
    enableSearch,
    chatVersion,
    expectedVisibleMessageCount,
    tailMessageId,
    edit,
    regeneration,
    requestId,
    userId,
    anonymousId,
    isAuthenticated,
    convexToken,
  } = input

  // Lifecycle guard — the runtime is one-shot. `prepare()` and `toResponse()`
  // may each run at most once, in order, so a repeated call can never open a
  // second durable run or a second model stream.
  let phase: "idle" | "preparing" | "prepared" | "streaming" | "terminal" =
    "idle"

  // Failure-relevant state — assigned as soon as it exists so `fail()` can act
  // even when `prepare()` throws partway through. `provider` is mirrored into
  // `PreparedTurn` for `toResponse()`, but kept here too so `fail()` can tag it
  // on a partial prepare (it is computed before the plan is assembled).
  let toolRuntime: ToolRuntime | null = null
  let openedMcpClientCount = 0
  let durableRunState: DurableRunState | null = null
  let provider: string | undefined

  // The full execution plan, assigned at the end of a successful prepare().
  let prepared: PreparedTurn | null = null

  const slowRequestThresholdMs = getSlowRequestThresholdMs()
  const stalledContinuationThresholdMs = getStalledContinuationThresholdMs()

  async function prepare(): Promise<void> {
    if (phase !== "idle") {
      throw new Error("Chat turn runtime: prepare() may only be called once")
    }
    phase = "preparing"

    const allModels = await Sentry.startSpan(
      { name: "chat.load_models", op: "chat.config" },
      async () => getAllModels()
    )
    const modelConfig = allModels.find((m) => m.id === model)

    if (!modelConfig) {
      throw Object.assign(new Error(`Model ${model} not found`), {
        statusCode: 400,
        code: "INVALID_REQUEST",
      })
    }

    const effectiveSystemPrompt = systemPrompt || SYSTEM_PROMPT_DEFAULT

    const resolvedProvider = getProviderForModel(model)
    provider = resolvedProvider
    Sentry.setTag("chat_provider", resolvedProvider)

    let apiKey: string | undefined
    if (isAuthenticated && convexToken) {
      const { getEffectiveApiKey } = await import("@/lib/user-keys")
      apiKey =
        (await getEffectiveApiKey(
          resolvedProvider as Provider,
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
      const envKey = envKeyMap[resolvedProvider]
      if (!envKey) {
        const providerName = modelConfig.provider || resolvedProvider
        throw Object.assign(
          new Error(
            `No API key configured for ${providerName}. Please add your ${providerName} API key in settings.`
          ),
          { statusCode: 401, code: "MISSING_API_KEY" }
        )
      }
    }
    const providerToolKeyMode: ToolKeyMode = apiKey ? "byok" : "platform"

    // enableSearch is no longer passed to the model — it controls tool injection
    // below. All search is now provided via visible, auditable tool calls.
    const aiModel = createLanguageModel(modelConfig, apiKey)

    // Check if PostHog is configured for LLM analytics
    const phClient = deps.getPostHogClient()
    const normalizedChatVersion = normalizeChatVersion(chatVersion, messages)

    // Tool outcome sinks (CONTEXT.md; app/api/chat/outcome-sinks.ts): the
    // runtime assembles one Tool outcome per call at step finish and dispatches
    // it to each sink. Trace log always; analytics and audit only when their
    // destinations exist for this request.
    const outcomeSinks = [
      createToolTraceLogSink({ requestId, chatId, userId, model }),
      ...(phClient
        ? [
            createPostHogToolCallSink({
              phClient,
              distinctId: userId,
              chatId,
              requestId,
              chatVersion: normalizedChatVersion,
            }),
          ]
        : []),
      ...(convexToken
        ? [
            createToolCallLogSink({
              convexToken,
              chatId,
              requestId,
              chatVersion: normalizedChatVersion,
            }),
          ]
        : []),
    ]

    // -----------------------------------------------------------------------
    // Tool runtime (CONTEXT.md; lib/tools/runtime.ts)
    //
    // Loads the three Tool layers (Layer 1 provider-native, Layer 2 Exa
    // search/content, Layer 3 MCP), runs both Capability policy phases, enforces
    // Tool budget, applies naming governance, and prepares runtime-approval
    // decisions — all behind one interface. It owns the stream-lifecycle hooks
    // (`prepareStep`, `onStepFinish`) the turn composes with durable persistence.
    // -----------------------------------------------------------------------
    const tool = await prepareToolRuntime({
      isAuthenticated,
      convexToken,
      anonymousId,
      provider: resolvedProvider,
      apiKey,
      providerToolKeyMode,
      modelTools: modelConfig.tools,
      enableSearch,
      logContext: { requestId, chatId, userId, model },
      onMcpClientsOpened: (clientCount) => {
        openedMcpClientCount = clientCount
      },
      outcomeSinks,
    })
    toolRuntime = tool
    // Register MCP cleanup immediately — after() runs even when the response
    // errors or the client disconnects. dispose() is idempotent.
    deps.after(() => tool.dispose())

    const hasAnyTools = tool.hasTools
    const shouldInjectSearch = tool.policySummary.searchInjected

    // Anonymous users get a lower step count to limit tool call cost exposure.
    // Authenticated users get the full MCP_MAX_STEP_COUNT (20).
    const maxSteps = hasAnyTools
      ? isAuthenticated
        ? MCP_MAX_STEP_COUNT
        : ANONYMOUS_MAX_STEP_COUNT
      : DEFAULT_MAX_STEP_COUNT

    const startTime = Date.now()

    // Schedule PostHog/Braintrust flush after streaming completes. Using flush()
    // (not shutdown()) allows client reuse in warm containers.
    if (phClient) {
      deps.after(async () => {
        await flushPostHog()
      })
    }
    deps.after(async () => {
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
      if (regeneration && approvalResponses.length > 0) {
        throw Object.assign(
          new Error("Regeneration cannot continue pending approvals"),
          { statusCode: 400, code: "INVALID_REQUEST" }
        )
      }

      const latestUserMessage =
        edit || regeneration || hasApprovalResponse(messages)
          ? undefined
          : getLatestUserMessage(messages)

      const generation = await deps.fetchMutation(
        api.chatRuntime.prepareGeneration,
        {
          chatId: chatId as Id<"chats">,
          requestId,
          model,
          provider: resolvedProvider,
          chatVersion: normalizedChatVersion,
          expectedVisibleMessageCount,
          tailMessageId,
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
          edit,
          regeneration,
          approvalResponses,
        },
        { token: convexToken }
      )

      const durableMessages = sanitizeModelHistoryMessages(
        toDurableUiMessages(generation.messages)
      ) as DurableUiMessage[]
      canonicalMessages = durableMessages as MessageAISDK[]
      durableRunState = {
        runId: generation.runId,
        assistantMessageId: generation.assistantMessageId,
        assistantOrder: generation.assistantOrder,
        originalMessages: durableMessages,
        snapshotTracker: createDurableSnapshotTracker({
          convexToken,
          runId: generation.runId,
          chatId: chatId as Id<"chats">,
          messageId: generation.assistantMessageId,
          order: generation.assistantOrder,
          fetchMutation: deps.fetchMutation,
        }),
      }

      console.log(
        JSON.stringify({
          _tag: "durable_chat_runtime_prepared",
          requestId,
          chatId,
          runId: generation.runId,
          assistantMessageId: generation.assistantMessageId,
          canonicalMessageCount: canonicalMessages.length,
          approvalResponseCount: approvalResponses.length,
          hasLatestUserMessage: Boolean(latestUserMessage),
          hasRegeneration: Boolean(regeneration),
          targetAssistantMessageId: regeneration?.targetAssistantMessageId,
        })
      )
    }

    canonicalMessages = sanitizeModelHistoryMessages(
      canonicalMessages
    ) as MessageAISDK[]

    const validatedMessages = await validateUIMessages({
      messages: canonicalMessages,
      tools: tool.tools as unknown as Parameters<
        typeof validateUIMessages
      >[0]["tools"],
    })

    const textFileReferences = getTextFilePartReferences(validatedMessages)
    const trustedTextAttachments =
      durableRuntimeEnabled && convexToken && textFileReferences.length > 0
        ? await deps.fetchQuery(
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
          provider: resolvedProvider,
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
      sourceProviderHint: resolvedProvider,
    }

    const adaptStartTime = Date.now()
    const adapterResult = await adaptHistoryForProvider(
      textFileModelInput.messages,
      resolvedProvider,
      adaptationContext,
      {
        useReplayCompiler: HISTORY_REPLAY_COMPILER_V1,
      }
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
    const partsDroppedTotal = Object.values(
      adapterResult.stats.partsDropped
    ).reduce((sum, count) => sum + count, 0)

    if (HISTORY_REPLAY_COMPILER_V1) {
      console.log(
        JSON.stringify({
          _tag: "replay_normalize_stage",
          chatId,
          provider: resolvedProvider,
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
          provider: resolvedProvider,
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
          provider: resolvedProvider,
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
        provider: resolvedProvider,
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
          provider: resolvedProvider,
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
        tools: tool.tools,
        ignoreIncompleteToolCalls: true,
      }
    )

    // OpenAI responses replay hardening:
    // If conversion output still contains provider-linked response IDs
    // (msg_/rs_/ws_), fall back to a plain-text transcript to avoid
    // pairing invariant failures on follow-up turns.
    if (
      resolvedProvider === "openai" &&
      hasProviderLinkedResponseIds(modelMessages)
    ) {
      console.warn(
        JSON.stringify({
          _tag: "replay_plaintext_fallback_activated",
          chatId,
          provider: resolvedProvider,
          model,
          reason: "provider_linked_response_ids_detected_post_conversion",
          messageCount: modelMessages.length,
          compilerEnabled: HISTORY_REPLAY_COMPILER_V1,
        })
      )
      modelMessages = toPlainTextModelMessages(adapterResult.messages)
    }

    // Request shaping (CONTEXT.md; lib/openproviders/request-shaping.ts):
    // provider options and beta headers behind one seam. The module owns the
    // pause_turn search downgrade and token-efficient beta gating.
    const { providerOptions, headers: requestHeaders } = shapeRequest(
      modelConfig,
      {
        searchToolsActive: shouldInjectSearch,
        hasTools: hasAnyTools,
      }
    )

    // Transport-safe by-name display metadata, resolved by the Tool runtime's
    // metadata resolver (the four per-layer maps never escape the runtime).
    const toolMetadataByName = tool.metadata.toInvocationMetadataByName()

    // durableRunState is assigned after the tool block ran (above), so approval
    // wrapping cannot be a prepareToolRuntime flag. The runtime computed the
    // decisions eagerly; apply them exactly once here for durable runs.
    if (durableRunState) {
      tool.applyDurableApprovals()
    }

    const enrichedSystemPrompt = effectiveSystemPrompt

    const mcpServerCount = tool.mcpServerCount
    const braintrustMetadata: BraintrustChatMetadata = {
      requestId,
      route: "api/chat",
      operation: "stream_text",
      chatIdHash: await hashBraintrustIdentifier(chatId),
      model,
      provider: resolvedProvider,
      isAuthenticated,
      messageCount: validatedMessages.length,
      chatVersionBucket: bucketChatVersion(normalizedChatVersion),
      searchEnabled: shouldInjectSearch,
      hasTools: hasAnyTools,
      keyMode: providerToolKeyMode,
      exaKeyMode: tool.policySummary.keyMode ?? null,
      maxSteps,
      capabilities: {
        search: tool.policySummary.capabilities.search,
        extract: tool.policySummary.capabilities.extract,
        code: tool.policySummary.capabilities.code,
        mcp: tool.policySummary.capabilities.mcp,
        platform: tool.policySummary.capabilities.platform,
      },
      capabilityReasons: tool.policySummary.capabilityReasons,
      toolPolicy: {
        userTier: tool.policySummary.userTier,
        keyMode: tool.policySummary.keyMode ?? null,
        keyModeReason: tool.policySummary.keyModeReason,
        totalTools: tool.policySummary.totalTools,
        earlyAllowedCount: tool.policySummary.earlyAllowedCount,
        lateAllowedCount: tool.policySummary.lateAllowedCount,
      },
      toolCounts: {
        builtIn: tool.toolCounts.builtIn,
        thirdParty: tool.toolCounts.thirdParty,
        content: tool.toolCounts.content,
        mcp: tool.toolCounts.mcp,
        total: tool.toolCounts.total,
      },
      mcp: {
        serverCount: mcpServerCount,
        toolCount: tool.toolCounts.mcp,
      },
      historyAdaptation: {
        warningCount: adapterResult.warnings.length,
        warningCodes: countWarningsByCode(adapterResult.warnings),
      },
    }

    prepared = {
      aiModel,
      modelConfig,
      provider: resolvedProvider,
      normalizedChatVersion,
      hasAnyTools,
      shouldInjectSearch,
      maxSteps,
      startTime,
      validatedMessages,
      modelMessages,
      providerOptions,
      requestHeaders,
      toolMetadataByName,
      enrichedSystemPrompt,
      braintrustMetadata,
      phClient,
    }
    phase = "prepared"
  }

  function toResponse(signal: AbortSignal): Response {
    if (phase !== "prepared") {
      throw new Error(
        "Chat turn runtime: toResponse() requires a completed prepare()"
      )
    }
    phase = "streaming"

    if (!prepared) {
      throw new Error("prepare() must be called before toResponse()")
    }
    const tool = toolRuntime
    if (!tool) {
      throw new Error("Tool runtime missing after prepare()")
    }
    const durable = durableRunState
    const {
      aiModel,
      provider: resolvedProvider,
      normalizedChatVersion,
      hasAnyTools,
      shouldInjectSearch,
      maxSteps,
      startTime,
      validatedMessages,
      modelMessages,
      providerOptions,
      requestHeaders,
      toolMetadataByName,
      enrichedSystemPrompt,
      braintrustMetadata,
      phClient,
    } = prepared

    const streamStartMs = Date.now()
    let stepCounter = 0
    let toolMetadataByCallId: ToolInvocationMetadataByCallId = {}

    // Track reasoning timing for messageMetadata persistence. The first
    // reasoning chunk records a start timestamp; when text-delta arrives
    // (reasoning is done) or onFinish fires, we compute elapsed ms.
    let reasoningStartMs: number | null = null
    let reasoningDurationMs: number | null = null
    let firstChunkLatencyMs: number | null = null
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
          chat_provider: resolvedProvider,
          chat_model: model,
          chat_is_authenticated: String(isAuthenticated),
          chat_error_type: "none",
          chat_stream_phase: phase,
        },
        extra: {
          requestId,
          chatId,
          model,
          provider: resolvedProvider,
          isAuthenticated,
          messageCount: validatedMessages.length,
          chatVersion: normalizedChatVersion,
          elapsedMs: now - streamStartMs,
          firstTokenLatencyMs: firstChunkLatencyMs,
          timeSinceLastChunkMs:
            lastChunkAtMs === null ? null : now - lastChunkAtMs,
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
          mcpClientCount: tool.mcpClientCount,
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

    if (signal.aborted) {
      handleRequestAbort()
    } else {
      signal.addEventListener("abort", handleRequestAbort, { once: true })
      deps.after(() => {
        signal.removeEventListener("abort", handleRequestAbort)
      })
    }

    const streamText = deps.streamText

    const markRunAborted = async (reason: string) => {
      if (!durable || !convexToken) return

      try {
        await deps.fetchMutation(
          api.chatRuntime.markGenerationRunAborted,
          {
            runId: durable.runId,
            messageId: durable.assistantMessageId,
            reason,
          },
          { token: convexToken }
        )
      } catch (error) {
        console.warn(
          JSON.stringify({
            _tag: "durable_run_abort_write_failed",
            requestId,
            chatId,
            runId: durable.runId,
            error: error instanceof Error ? error.message : String(error),
          })
        )
      }
    }

    const runGeneration = (braintrustSpan: BraintrustTraceSpan) =>
      streamText({
        model: aiModel,
        system: enrichedSystemPrompt,
        messages: modelMessages,
        tools: tool.tools,
        stopWhen: stepCountIs(maxSteps),
        abortSignal: signal,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "api.chat.streamText",
          metadata: {
            route: "api/chat",
            operation: "stream_text",
            conversationId: chatId,
            provider: resolvedProvider,
            model,
            isAuthenticated,
            hasTools: hasAnyTools,
            enableSearch: shouldInjectSearch,
            chatVersionBucket: bucketChatVersion(normalizedChatVersion),
          },
        },

        // Centralized step gating from the Tool runtime. After
        // PREPARE_STEP_THRESHOLD, only late-step-safe tools remain; built-in
        // Tool budget is probed per step. Resolves to `undefined` when no tools.
        prepareStep: tool.prepareStep,

        // Per-step structured tracing: tool name, duration, token usage, success.
        onStepFinish: async ({ toolCalls, toolResults, usage, finishReason }) => {
          stepCounter++
          observedToolCalls += toolCalls.length
          lastProgressAtMs = Date.now()
          lastStepFinishReason = finishReason ?? null
          if (toolCalls.length === 0) return

          // Built-in Tool budget accounting plus Tool outcome recording — one
          // outcome per call, dispatched to the injected sinks. The runtime owns
          // assembly and the request-level outcome summary; the turn only
          // persists durable-run state below.
          await tool.onStepFinish({
            stepNumber: stepCounter,
            toolCalls,
            toolResults,
            usage,
            finishReason,
          })

          if (durable && convexToken) {
            const invocations: ToolInvocationForPersistence[] = toolCalls.map(
              (call) => {
                const result = toolResults.find(
                  (candidate) => candidate.toolCallId === call.toolCallId
                )
                const isError = result
                  ? Boolean((result as { isError?: boolean }).isError)
                  : false
                const approvalDecision = tool.approvalFor(call.toolName)
                return {
                  toolCallId: call.toolCallId,
                  toolName: call.toolName,
                  source: tool.metadata.source(call.toolName),
                  input: call.input,
                  output: result?.output,
                  error: isError
                    ? String(
                        (result as { output?: unknown })?.output ??
                          "Tool failed"
                      )
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

            void deps
              .fetchMutation(
                api.chatRuntime.recordToolInvocations,
                {
                  runId: durable.runId,
                  chatId: chatId as Id<"chats">,
                  messageId: durable.assistantMessageId,
                  stepNumber: stepCounter,
                  invocations,
                },
                { token: convexToken }
              )
              .catch((error: unknown) => {
                console.warn(
                  JSON.stringify({
                    _tag: "canonical_tool_invocation_write_failed",
                    requestId,
                    chatId,
                    runId: durable.runId,
                    error:
                      error instanceof Error ? error.message : String(error),
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
        ...(Object.keys(requestHeaders).length > 0 && {
          headers: requestHeaders,
        }),
        ...(durable && convexToken
          ? {
              experimental_transform: createRuntimeApprovalPersistenceTransform({
                chatId,
                convexToken,
                durableRunState: durable,
                runtimeApprovalByToolName: tool.approvalDecisionsByToolName,
                toolMetadataResolver: tool.metadata,
                approvalWritePromises,
                requestId,
                persistApprovalRequest: (approvalArgs) =>
                  deps.fetchMutation(
                    api.chatRuntime.createToolApprovalRequest,
                    approvalArgs,
                    { token: convexToken }
                  ),
              }),
            }
          : {}),

        onChunk: ({ chunk }) => {
          const now = Date.now()
          lastChunkAtMs = now
          lastProgressAtMs = now
          resolvePostToolContinuation()
          durable?.snapshotTracker?.onChunk(chunk)
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
          if (durable && convexToken) {
            void deps
              .fetchMutation(
                api.chatRuntime.markGenerationRunFailed,
                {
                  runId: durable.runId,
                  messageId: durable.assistantMessageId,
                  error: errorMessage,
                },
                { token: convexToken }
              )
              .catch((error: unknown) => {
                console.warn(
                  JSON.stringify({
                    _tag: "durable_run_failed_write_failed",
                    requestId,
                    chatId,
                    runId: durable.runId,
                    error:
                      error instanceof Error ? error.message : String(error),
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
                provider: resolvedProvider,
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
                provider: resolvedProvider,
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
          if (durable && convexToken) {
            await durable.snapshotTracker?.flush().catch(() => {})
            await markRunAborted("stream aborted")
          }
        },

        onFinish: async ({ text, usage, steps, finishReason }) => {
          streamCompleted = true
          lastProgressAtMs = Date.now()
          resolvePostToolContinuation()
          await durable?.snapshotTracker?.flush().catch(() => {})
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

          // Request-level Tool outcome aggregate — accumulated by the runtime as
          // each step's outcomes were recorded.
          const {
            totalToolCalls,
            failedToolCalls,
            timeoutToolCalls,
            budgetDeniedToolCalls,
          } = tool.outcomeSummary()

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
          Sentry.setTag(
            "chat_total_latency_bucket",
            bucketLatencyMs(totalLatencyMs)
          )
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
                chat_provider: resolvedProvider,
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

          // Finish reason observability — log truncation (finishReason: "length")
          // so we can detect max_tokens exhaustion in dev and production.
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

          if (
            process.env.NODE_ENV !== "production" &&
            resolvedProvider === "anthropic" &&
            hasAnyTools
          ) {
            console.log(
              `[chat] Anthropic tool usage — inputTokens: ${usage?.inputTokens ?? "?"}, ` +
                `toolCount: ${Object.keys(tool.tools).length}, ` +
                `tokenEfficient: ${"anthropic-beta" in requestHeaders}`
            )
          }

          // Manually capture LLM generation for PostHog analytics. This ensures
          // accurate output capture (withTracing has issues with streaming).
          if (phClient) {
            try {
              const latencyMs = Date.now() - startTime
              captureGeneration({
                distinctId: userId,
                traceId: chatId,
                model,
                provider: resolvedProvider,
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
              // Per-tool-call PostHog `tool_call` events are emitted at step
              // finish by the Tool runtime's analytics outcome sink.
            } catch (captureErr) {
              // Analytics failure should never break the response
              console.error(
                "[PostHog] Failed to capture generation event:",
                captureErr
              )
            }
          }

          // Tool call audit logging happens at step finish via the Tool
          // runtime's audit outcome sink — all sources, one unified path.
        },
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
      originalMessages: durable?.originalMessages ?? validatedMessages,
      generateMessageId: durable
        ? () => durable.assistantMessageId
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
        if (!durable || !convexToken) return

        await Promise.allSettled(approvalWritePromises)
        await durable.snapshotTracker?.flush().catch(() => {})

        if (isAborted) {
          await markRunAborted("ui message stream aborted")
          return
        }

        const toolCounts =
          durableFinalToolCounts ?? countToolParts(responseMessage)
        await deps.fetchMutation(
          api.chatRuntime.markGenerationRunCompleted,
          {
            runId: durable.runId,
            messageId: durable.assistantMessageId,
            content: getFinalAssistantText(responseMessage),
            parts: responseMessage.parts,
            metadata: projectPersistedMessageMetadata(responseMessage.metadata),
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
            chat_provider: resolvedProvider,
            chat_is_authenticated: String(isAuthenticated),
            chat_error_type: errorType,
            chat_error_has_tool_signal: getToolDimensionForError(errorType),
          },
          extra: {
            requestId,
            chatId,
            model,
            provider: resolvedProvider,
            errorType,
            isAuthenticated,
            messageCount: validatedMessages.length,
            chatVersion: normalizedChatVersion,
          },
        })
        return extractErrorMessage(error)
      },
    })
  }

  async function fail(err: unknown): Promise<void> {
    phase = "terminal"

    // Clean up any MCP clients that were opened before the error. dispose() is
    // idempotent, so this is safe even if the after() registration also runs.
    if (toolRuntime) await toolRuntime.dispose()

    if (durableRunState && convexToken) {
      await deps
        .fetchMutation(
          api.chatRuntime.markGenerationRunFailed,
          {
            runId: durableRunState.runId,
            messageId: durableRunState.assistantMessageId,
            error: extractErrorMessage(err),
          },
          { token: convexToken }
        )
        .catch((writeError: unknown) => {
          console.warn(
            JSON.stringify({
              _tag: "durable_run_failed_write_failed",
              requestId,
              chatId,
              runId: durableRunState?.runId,
              error:
                writeError instanceof Error
                  ? writeError.message
                  : String(writeError),
            })
          )
        })
    }

    const errorType = classifyChatError(err)
    Sentry.captureException(err, {
      tags: {
        route: "api/chat",
        chat_model: model,
        ...(provider ? { chat_provider: provider } : {}),
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
        messageCount: messages.length,
        mcpClientCount: toolRuntime?.mcpClientCount ?? openedMcpClientCount,
      },
    })
  }

  return { prepare, toResponse, fail }
}
