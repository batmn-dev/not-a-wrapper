import { getWorkosSession } from "@/lib/auth/workos"
import { resolveModelSelection } from "@/lib/models/catalog"
import {
  classifyChatError,
  getToolDimensionForError,
} from "@/lib/observability/chat-error-taxonomy"
import {
  CHAT_PERF_ID_HEADER,
  createChatPerfServerSession,
} from "@/lib/observability/chat-performance"
import {
  getSanitizedExceptionSummary,
  sanitizeExceptionForTelemetry,
} from "@/lib/observability/sentry-scrubbing"
import * as Sentry from "@sentry/nextjs"
import {
  checkServerSideUsage,
  incrementServerSideUsage,
  validateAndResolveChatCredential,
} from "./api"
import { parseChatTurnRequest } from "@/lib/chat-messages/chat-turn-contract"
import {
  createChatTurnRuntime,
  type ChatTurnRuntime,
} from "./chat-turn-runtime"
import { createErrorResponse } from "./utils"

// Top-line chat-turn budget. Next.js statically analyzes segment config, so
// this must stay a literal; it must equal CHAT_ROUTE_MAX_DURATION_SECONDS in
// lib/chat-turn/execution-budget.ts (pinned by route.test.ts) — every other
// generation deadline derives from that module.
export const maxDuration = 300

function setChatConversationCorrelation(chatId: string): void {
  const sentryWithConversationApi = Sentry as typeof Sentry & {
    setConversationId?: (conversationId: string) => void
  }
  if (typeof sentryWithConversationApi.setConversationId === "function") {
    sentryWithConversationApi.setConversationId(chatId)
  }
  Sentry.setContext("chat_conversation", { id: chatId })
}

// Thin HTTP adapter over the Chat turn runtime (CONTEXT.md;
// app/api/chat/chat-turn-runtime.ts; docs/adr/0006-chat-turn-runtime.md). The
// route owns only HTTP concerns: parse, cookie→token, validation 400/401, usage
// admission, and returning the Response. The runtime owns prepare + stream +
// the durable-persistence timeline.
export async function POST(req: Request) {
  const requestId = crypto.randomUUID()
  // Sampled chat-performance session (PR 0b): off unless CHAT_PERF_SAMPLE_RATE
  // is set. The client's x-chat-perf-id is validated here and carried only
  // through perf spans — never persisted to chat/run/message docs and never
  // used as an admission idempotency key. (`requestId` above is generated
  // after arrival, so it cannot correlate earlier client marks.)
  const perf = createChatPerfServerSession(
    req.headers.get(CHAT_PERF_ID_HEADER)
  )
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
    const authSession = await perf.span("auth_session", () =>
      getWorkosSession()
    )
    const authUserId = authSession.user?.id
    const isAuthenticated = !!authUserId
    telemetryIsAuthenticated = isAuthenticated

    // Convex token for authenticated usage tracking + durable persistence.
    const convexToken = isAuthenticated ? authSession.accessToken : undefined

    // A body that isn't valid JSON is a client error, not a server fault —
    // classify it as 400 INVALID_REQUEST instead of letting the SyntaxError
    // fall through to the generic 500 catch (which would page via Sentry).
    let jsonBody: unknown
    try {
      jsonBody = await req.json()
    } catch {
      return new Response(
        JSON.stringify({
          error: "Request body is not valid JSON",
          code: "INVALID_REQUEST",
        }),
        { status: 400 }
      )
    }

    // Validate against the Chat turn wire contract — the one statement of the
    // request shape, shared with the client builder
    // (lib/chat-messages/chat-turn-contract.ts). Identity stays session-derived:
    // the parser only uses `isAuthenticated` for the guest-id rule.
    const parsed = parseChatTurnRequest(jsonBody, { isAuthenticated })
    if (!parsed.ok) {
      // Routine bad input (missing fields, malformed JSON, absent guest id) is
      // an expected 400 and stays silent. An `unexpected` rejection is a
      // client-contract violation our own client should never produce (e.g.
      // edit+regeneration together), so capture it — this is the one
      // validation 400 that carried a Sentry signal before the contract move.
      if (parsed.unexpected) {
        Sentry.captureException(new Error(parsed.error), {
          tags: {
            route: "api/chat",
            chat_is_authenticated: String(isAuthenticated),
            chat_failure_stage: "request_validation",
          },
          extra: { requestId, code: parsed.code },
        })
      }
      return new Response(
        JSON.stringify({
          error: parsed.error,
          code: parsed.code,
          ...(parsed.details ? { details: parsed.details } : {}),
        }),
        { status: parsed.status }
      )
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
    } = parsed.request
    // Logical identity (ADR-0020): aliases, successions, and old routed ids
    // all normalize to the logical model id; the route resolver below decides
    // the concrete execution route (and re-derives the legacy hint itself).
    const model = resolveModelSelection(requestedModel).modelId
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

    // Use authenticated userId, or client-provided ID for anonymous users
    // (the wire contract guarantees a guest ID is present when unauthenticated).
    const userId = authUserId ?? clientUserId!
    // For anonymous users, use clientUserId for rate limiting.
    const anonymousId = !isAuthenticated ? clientUserId! : undefined

    // Server-side usage admission — enforces rate limits before a turn runs.
    const admission = await Sentry.startSpan(
      {
        name: "chat.usage_checks",
        op: "chat.validation",
        attributes: {
          "chat.id": chatId,
          "chat.model": model,
          "chat.is_authenticated": isAuthenticated,
        },
      },
      () =>
        perf.span("usage_admission", async () => {
          await checkServerSideUsage(convexToken, model, anonymousId)
          const resolvedAdmission = await perf.span(
            "credential_resolution",
            () =>
              validateAndResolveChatCredential({
                // The RAW selection: the resolver re-derives the legacy
                // route hint an old `openrouter:*` chat id carries.
                model: requestedModel,
                isAuthenticated,
                token: convexToken,
                messages,
              })
          )
          await incrementServerSideUsage(convexToken, model, anonymousId)
          return resolvedAdmission
        })
    )
    Sentry.setTag("chat_route_id", admission.route.routeId)

    turn = createChatTurnRuntime({
      input: {
        messages,
        chatId,
        model,
        systemPrompt,
        enableSearch: enableSearch ?? false,
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
        credential: admission.credential,
        route: admission.route,
        perf,
      },
    })

    await perf.span("prepare_total", () => turn!.prepare())
    return await turn.toResponse(req.signal)
  } catch (err: unknown) {
    console.error(
      JSON.stringify({
        _tag: "chat_route_error",
        requestId,
        ...getSanitizedExceptionSummary(err),
      })
    )

    if (turn) {
      // Post-runtime error: the turn owns MCP cleanup, the durable-run failure
      // write, and the rich Sentry capture.
      try {
        await turn.fail(err)
      } catch (failError) {
        const originalErrorType = classifyChatError(err)
        const failSummary = getSanitizedExceptionSummary(failError)
        console.warn(
          JSON.stringify({
            _tag: "chat_turn_fail_failed",
            requestId,
            ...failSummary,
          })
        )
        Sentry.captureException(sanitizeExceptionForTelemetry(failError), {
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
            model: telemetryModel,
            errorType: originalErrorType,
            isAuthenticated: telemetryIsAuthenticated,
            messageCount: telemetryMessageCount,
            originalErrorName: getSanitizedExceptionSummary(err).errorName,
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
      Sentry.captureException(sanitizeExceptionForTelemetry(err), {
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
          model: telemetryModel,
          errorType,
          isAuthenticated: telemetryIsAuthenticated,
          messageCount: telemetryMessageCount,
          mcpClientCount: 0,
        },
      })
    }

    return createErrorResponse(err)
  }
}
