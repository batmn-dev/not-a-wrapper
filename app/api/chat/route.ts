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
import { resolveModelId } from "@/lib/models/model-id-migration"
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
  prepareToolRuntime,
  type ToolRuntime,
} from "@/lib/tools/runtime"
import {
  createPostHogToolCallSink,
  createToolCallLogSink,
  createToolTraceLogSink,
} from "./outcome-sinks"
import {
  buildFinishToolInvocationStreamMetadata,
  buildStartToolInvocationStreamMetadata,
  type ToolInvocationMetadataByCallId,
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

export const maxDuration = 60

type ChatRequest = {
  messages: MessageAISDK[]
  chatId: string
  model: string
  systemPrompt: string
  enableSearch: boolean
  chatVersion?: number
  userId?: string // Client-provided userId (for anonymous users)
  edit?: ChatEditRequest
}

type ChatEditRequest = {
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

type DurableRunState = {
  runId: Id<"generationRuns">
  assistantMessageId: Id<"messages">
  assistantOrder: number
  originalMessages: DurableUiMessage[]
  snapshotTracker: ReturnType<typeof createDurableSnapshotTracker> | null
}

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
  // Tool runtime — declared outside try so the catch can dispose() its MCP
  // clients and read mcpClientCount even when the tool block itself threw.
  let runtime: ToolRuntime | null = null
  // Mirrors the pre-runtime `mcpClients.length` in the catch path: counts MCP
  // clients opened even when prepareToolRuntime throws before returning.
  let openedMcpClientCount = 0
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
      edit,
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
    // Tool runtime (CONTEXT.md; lib/tools/runtime.ts)
    //
    // Loads the three Tool layers (Layer 1 provider-native, Layer 2 Exa
    // search/content, Layer 3 MCP), runs both Capability policy phases, enforces
    // Tool budget, applies naming governance, and prepares runtime-approval
    // decisions — all behind one interface. enableSearch is the master switch
    // for search injection; the runtime gates it against the model's search
    // capability. All search is visible, auditable tool calls.
    //
    // The runtime owns the stream-lifecycle hooks: it exposes `prepareStep`
    // (step gating) and `onStepFinish` (built-in Tool budget accounting plus
    // Tool outcome recording), which the route passes through / composes with
    // its durable-run persistence.
    // -----------------------------------------------------------------------
    // Check if PostHog is configured for LLM analytics
    const phClient = getPostHogClient()

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

    const toolRuntime = await prepareToolRuntime({
      isAuthenticated,
      convexToken,
      anonymousId,
      provider,
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
    runtime = toolRuntime
    // Register MCP cleanup immediately — after() runs even when the response
    // errors or the client disconnects. dispose() is idempotent.
    after(() => toolRuntime.dispose())

    const hasAnyTools = toolRuntime.hasTools
    const shouldInjectSearch = toolRuntime.policySummary.searchInjected

    // Anonymous users get a lower step count to limit tool call cost exposure.
    // Authenticated users get the full MCP_MAX_STEP_COUNT (20).
    const maxSteps = hasAnyTools
      ? (isAuthenticated ? MCP_MAX_STEP_COUNT : ANONYMOUS_MAX_STEP_COUNT)
      : DEFAULT_MAX_STEP_COUNT

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
      const latestUserMessage = edit
        ? undefined
        : hasApprovalResponse(messages)
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
          edit,
          approvalResponses,
        },
        { token: convexToken }
      )

      const durableMessages = sanitizeModelHistoryMessages(
        toDurableUiMessages(prepared.messages)
      ) as DurableUiMessage[]
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

    canonicalMessages = sanitizeModelHistoryMessages(
      canonicalMessages
    ) as MessageAISDK[]

    const validatedMessages = await validateUIMessages({
      messages: canonicalMessages,
      tools: toolRuntime.tools as unknown as Parameters<typeof validateUIMessages>[0]["tools"],
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
        tools: toolRuntime.tools,
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

    // Request shaping (CONTEXT.md; lib/openproviders/request-shaping.ts):
    // provider options (thinking/reasoning config, per-model thinking budgets)
    // and provider beta headers, resolved behind one seam. The module owns the
    // pause_turn search downgrade and token-efficient beta gating — the route
    // never branches on provider.
    const { providerOptions, headers: requestHeaders } = shapeRequest(
      modelConfig,
      {
        searchToolsActive: shouldInjectSearch,
        hasTools: hasAnyTools,
      }
    )

    // Transport-safe by-name display metadata, resolved by the Tool runtime's
    // metadata resolver (the four per-layer maps never escape the runtime).
    const toolMetadataByName = toolRuntime.metadata.toInvocationMetadataByName()

    // durableRunState is assigned after the tool block ran (below), so approval
    // wrapping cannot be a prepareToolRuntime flag. The runtime computed the
    // decisions eagerly; apply them exactly once here for durable runs.
    if (durableRunState) {
      toolRuntime.applyDurableApprovals()
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
          mcpClientCount: toolRuntime.mcpClientCount,
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

    const mcpServerCount = toolRuntime.mcpServerCount
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
      exaKeyMode: toolRuntime.policySummary.keyMode ?? null,
      maxSteps,
      capabilities: {
        search: toolRuntime.policySummary.capabilities.search,
        extract: toolRuntime.policySummary.capabilities.extract,
        code: toolRuntime.policySummary.capabilities.code,
        mcp: toolRuntime.policySummary.capabilities.mcp,
        platform: toolRuntime.policySummary.capabilities.platform,
      },
      capabilityReasons: toolRuntime.policySummary.capabilityReasons,
      toolPolicy: {
        userTier: toolRuntime.policySummary.userTier,
        keyMode: toolRuntime.policySummary.keyMode ?? null,
        keyModeReason: toolRuntime.policySummary.keyModeReason,
        totalTools: toolRuntime.policySummary.totalTools,
        earlyAllowedCount: toolRuntime.policySummary.earlyAllowedCount,
        lateAllowedCount: toolRuntime.policySummary.lateAllowedCount,
      },
      toolCounts: {
        builtIn: toolRuntime.toolCounts.builtIn,
        thirdParty: toolRuntime.toolCounts.thirdParty,
        content: toolRuntime.toolCounts.content,
        mcp: toolRuntime.toolCounts.mcp,
        total: toolRuntime.toolCounts.total,
      },
      mcp: {
        serverCount: mcpServerCount,
        toolCount: toolRuntime.toolCounts.mcp,
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
      tools: toolRuntime.tools,
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

      // Centralized step gating from the Tool runtime. After
      // PREPARE_STEP_THRESHOLD, only late-step-safe tools remain (currently
      // read_only risk class); built-in Tool budget is probed per step. The
      // runtime owns the gate and resolves to `undefined` when no tools loaded.
      prepareStep: toolRuntime.prepareStep,

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

        // Built-in Tool budget accounting plus Tool outcome recording — one
        // outcome per call, dispatched to the injected sinks (trace log,
        // analytics, audit). The runtime owns assembly and the request-level
        // outcome summary; the route only persists durable-run state below.
        await toolRuntime.onStepFinish({
          stepNumber: stepCounter,
          toolCalls,
          toolResults,
          usage,
          finishReason,
        })

        if (durableRunState && convexToken) {
          const invocations: ToolInvocationForPersistence[] = toolCalls.map(
            (call) => {
              const result = toolResults.find(
                (candidate) => candidate.toolCallId === call.toolCallId
              )
              const isError = result
                ? Boolean((result as { isError?: boolean }).isError)
                : false
              const approvalDecision = toolRuntime.approvalFor(call.toolName)
              return {
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                source: toolRuntime.metadata.source(call.toolName),
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
              runtimeApprovalByToolName: toolRuntime.approvalDecisionsByToolName,
              toolMetadataResolver: toolRuntime.metadata,
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

        // Request-level Tool outcome aggregate — accumulated by the runtime as
        // each step's outcomes were recorded.
        const {
          totalToolCalls,
          failedToolCalls,
          timeoutToolCalls,
          budgetDeniedToolCalls,
        } = toolRuntime.outcomeSummary()

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
            `toolCount: ${Object.keys(toolRuntime.tools).length}, ` +
            `tokenEfficient: ${"anthropic-beta" in requestHeaders}`
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
            // Per-tool-call PostHog `tool_call` events are emitted at step
            // finish by the Tool runtime's analytics outcome sink — see
            // outcome-sinks.ts.
          } catch (captureErr) {
            // Analytics failure should never break the response
            console.error(
              "[PostHog] Failed to capture generation event:",
              captureErr
            )
          }
        }

        // Tool call audit logging happens at step finish via the Tool
        // runtime's audit outcome sink (outcome-sinks.ts) — all sources, one
        // unified path, written even when the stream never reaches onFinish.
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
    // Clean up any MCP clients that were opened before the error. dispose() is
    // idempotent, so this is safe even if the after() registration also runs.
    if (runtime) await runtime.dispose()

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
        mcpClientCount: runtime?.mcpClientCount ?? openedMcpClientCount,
      },
    })

    return createErrorResponse(error)
  }
}
