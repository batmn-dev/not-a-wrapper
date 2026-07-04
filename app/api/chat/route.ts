import { getWorkosSession } from "@/lib/auth/workos"
import { resolveModelId } from "@/lib/models/model-id-migration"
import {
  classifyChatError,
  getToolDimensionForError,
} from "@/lib/observability/chat-error-taxonomy"
import * as Sentry from "@sentry/nextjs"
import {
  checkServerSideUsage,
  incrementServerSideUsage,
  validateAndTrackUsage,
} from "./api"
import {
  createChatTurnRuntime,
  type ChatRequest,
  type ChatTurnRuntime,
} from "./chat-turn-runtime"
import { createErrorResponse } from "./utils"

export const maxDuration = 60

function setChatConversationCorrelation(chatId: string): void {
  const sentryWithConversationApi = Sentry as typeof Sentry & {
    setConversationId?: (conversationId: string) => void
  }
  if (typeof sentryWithConversationApi.setConversationId === "function") {
    sentryWithConversationApi.setConversationId(chatId)
  }
  Sentry.setContext("chat_conversation", { id: chatId })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Thin HTTP adapter over the Chat turn runtime (CONTEXT.md;
// app/api/chat/chat-turn-runtime.ts; docs/adr/0006-chat-turn-runtime.md). The
// route owns only HTTP concerns: parse, cookie→token, validation 400/401, usage
// admission, and returning the Response. The runtime owns prepare + stream +
// the durable-persistence timeline.
export async function POST(req: Request) {
  const requestId = crypto.randomUUID()
  // Pre-runtime telemetry fallbacks: read by the catch when the error is thrown
  // before the runtime exists (parse / validation / usage admission). Once the
  // runtime is constructed, its `fail()` owns the rich capture.
  let telemetryChatId: string | undefined
  let telemetryModel: string | undefined
  let telemetryIsAuthenticated: boolean | undefined
  let telemetryMessageCount: number | undefined
  let turn: ChatTurnRuntime | null = null

  try {
    Sentry.setTag("route", "api/chat")
    Sentry.setTag("chat_route", "/api/chat")
    Sentry.setTag("chat_operation", "stream_text")

    // Server-side authentication — derive user ID from WorkOS AuthKit session.
    const authSession = await getWorkosSession()
    const authUserId = authSession.user?.id
    const isAuthenticated = !!authUserId
    telemetryIsAuthenticated = isAuthenticated

    // Convex token for authenticated usage tracking + durable persistence.
    const convexToken = isAuthenticated ? authSession.accessToken : undefined

    // A body that isn't valid JSON is a client error, not a server fault —
    // classify it as 400 INVALID_REQUEST instead of letting the SyntaxError
    // fall through to the generic 500 catch (which would page via Sentry).
    let parsedBody: ChatRequest
    try {
      parsedBody = (await req.json()) as ChatRequest
    } catch {
      throw Object.assign(new Error("Request body is not valid JSON"), {
        statusCode: 400,
        code: "INVALID_REQUEST",
      })
    }
    const {
      messages,
      chatId,
      model: requestedModel,
      systemPrompt,
      enableSearch,
      chatVersion,
      expectedVisibleMessageCount,
      tailMessageId,
      userId: clientUserId,
      edit,
      regeneration,
    } = parsedBody
    const model = resolveModelId(requestedModel)
    telemetryChatId = chatId
    telemetryModel = model
    telemetryMessageCount = Array.isArray(messages)
      ? messages.length
      : undefined
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

    if (edit && regeneration) {
      throw Object.assign(
        new Error("Regeneration cannot be combined with edit generation"),
        { statusCode: 400, code: "INVALID_REQUEST" }
      )
    }

    // For anonymous users, require a guest ID for usage tracking. The client
    // provides a stable guest ID (format: "guest_<uuid>") from localStorage.
    if (!isAuthenticated && !clientUserId) {
      return new Response(
        JSON.stringify({
          error: "Guest ID required for anonymous users",
          code: "MISSING_GUEST_ID",
        }),
        { status: 400 }
      )
    }

    // Use authenticated userId, or client-provided ID for anonymous users.
    const userId = authUserId ?? clientUserId!
    // For anonymous users, use clientUserId for rate limiting.
    const anonymousId = !isAuthenticated ? clientUserId! : undefined

    // Server-side usage admission — enforces rate limits before a turn runs.
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
        await incrementServerSideUsage(convexToken, model, anonymousId)
      }
    )

    turn = createChatTurnRuntime({
      input: {
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
      },
    })

    await turn.prepare()
    return turn.toResponse(req.signal)
  } catch (err: unknown) {
    console.error("Error in /api/chat:", err)
    const error = err as {
      code?: string
      message?: string
      statusCode?: number
    }

    if (turn) {
      // Post-runtime error: the turn owns MCP cleanup, the durable-run failure
      // write, and the rich Sentry capture.
      try {
        await turn.fail(err)
      } catch (failError) {
        const originalErrorType = classifyChatError(err)
        console.warn(
          JSON.stringify({
            _tag: "chat_turn_fail_failed",
            requestId,
            chatId: telemetryChatId,
            error: getErrorMessage(failError),
          })
        )
        Sentry.captureException(failError, {
          tags: {
            route: "api/chat",
            ...(telemetryModel ? { chat_model: telemetryModel } : {}),
            chat_is_authenticated:
              telemetryIsAuthenticated === undefined
                ? "unknown"
                : String(telemetryIsAuthenticated),
            chat_error_type: originalErrorType,
            chat_error_has_tool_signal:
              getToolDimensionForError(originalErrorType),
            chat_failure_stage: "turn_fail",
          },
          extra: {
            requestId,
            chatId: telemetryChatId,
            model: telemetryModel,
            errorType: originalErrorType,
            isAuthenticated: telemetryIsAuthenticated,
            messageCount: telemetryMessageCount,
            originalError: getErrorMessage(err),
          },
        })
      }
    } else {
      // Pre-runtime error (parse / validation / usage admission). No durable
      // failure write is needed here precisely because durable state (the
      // generationRuns row) is created only inside the runtime — after `turn`
      // is assigned above. So any error that could leave a durable run open has
      // `turn != null` and routes to `turn.fail()`; this branch only captures.
      // Keep durable-state creation inside the runtime to preserve that split.
      const errorType = classifyChatError(err)
      Sentry.captureException(err, {
        tags: {
          route: "api/chat",
          ...(telemetryModel ? { chat_model: telemetryModel } : {}),
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
          errorType,
          isAuthenticated: telemetryIsAuthenticated,
          messageCount: telemetryMessageCount,
          mcpClientCount: 0,
        },
      })
    }

    return createErrorResponse(error)
  }
}
