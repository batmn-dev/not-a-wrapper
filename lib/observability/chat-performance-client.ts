"use client"

/**
 * Client-side chat-performance marks (PR 0b): turn marks, navigation marks,
 * and the per-turn correlation id. Everything is a no-op unless
 * `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION === "true"` (build-time flag).
 *
 * Timing honesty: marks fire from React effects, so they measure commit
 * time — a close post-paint approximation, not literal first-pixel paint.
 * The measurement runbook pairs them with trace-level paint events when
 * exact paint timing matters.
 */
import { useEffect, useRef } from "react"
import {
  CHAT_PERF_ID_HEADER,
  createChatPerfCorrelationId,
  isChatPerfClientEnabled,
  markChatPerf,
  type ChatPerfFields,
} from "./chat-performance"

// ---------------------------------------------------------------------------
// Per-turn correlation id
// ---------------------------------------------------------------------------

let currentTurnId: string | undefined
let pendingHeaderTurnId: string | undefined

/**
 * Starts a new instrumented turn: mints a fresh correlation id (never reused
 * across turns), arms it for exactly ONE outgoing request header, and marks
 * `chat_send_intent`. Returns undefined when instrumentation is off.
 */
export function beginChatPerfTurn(): string | undefined {
  if (!isChatPerfClientEnabled()) return undefined
  currentTurnId = createChatPerfCorrelationId()
  pendingHeaderTurnId = currentTurnId
  markChatPerf("chat_send_intent", { correlationId: currentTurnId })
  return currentTurnId
}

/**
 * One-shot header payload for the chat transport. Consuming clears the armed
 * id so an automatic follow-up request (e.g. an approval continuation) never
 * reuses a prior turn's correlation id.
 */
export function takeChatPerfHeader(): Record<string, string> {
  if (!isChatPerfClientEnabled() || !pendingHeaderTurnId) return {}
  const headers = { [CHAT_PERF_ID_HEADER]: pendingHeaderTurnId }
  pendingHeaderTurnId = undefined
  return headers
}

function turnFields(): ChatPerfFields {
  return currentTurnId ? { correlationId: currentTurnId } : {}
}

// ---------------------------------------------------------------------------
// Turn marks (status-transition driven)
// ---------------------------------------------------------------------------

type ChatStreamStatus = "submitted" | "streaming" | "ready" | "error"

type TurnPerfInput = {
  status: ChatStreamStatus
  /** True once the live assistant message has any nonempty visible text. */
  hasVisibleAssistantText: boolean
  /** Id of the trailing user message, used to observe the optimistic paint. */
  lastUserMessageId: string | undefined
}

/**
 * Emits the turn marks from observable stream-state transitions:
 * `request_dispatched` (→ submitted), `first_chunk_received` (→ streaming),
 * `optimistic_message_painted` (new trailing user message during a live
 * turn), `first_visible_text` (first nonempty assistant text), and
 * `stream_terminal` (streaming/submitted → ready|error).
 */
export function useChatTurnPerfMarks(input: TurnPerfInput): void {
  const previousStatus = useRef<ChatStreamStatus>(input.status)
  const sawVisibleText = useRef(false)
  const paintedUserMessageId = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!isChatPerfClientEnabled()) return
    const previous = previousStatus.current
    const next = input.status
    if (previous === next) return
    previousStatus.current = next

    if (next === "submitted") {
      markChatPerf("request_dispatched", turnFields())
      sawVisibleText.current = false
    } else if (next === "streaming") {
      markChatPerf("first_chunk_received", turnFields())
    } else if (previous === "streaming" || previous === "submitted") {
      markChatPerf("stream_terminal", {
        ...turnFields(),
        outcome: next === "error" ? "error" : "finish",
      })
    }
  }, [input.status])

  useEffect(() => {
    if (!isChatPerfClientEnabled()) return
    if (input.status !== "submitted" && input.status !== "streaming") return
    if (
      input.lastUserMessageId &&
      paintedUserMessageId.current !== input.lastUserMessageId
    ) {
      paintedUserMessageId.current = input.lastUserMessageId
      markChatPerf("optimistic_message_painted", turnFields())
    }
  }, [input.lastUserMessageId, input.status])

  useEffect(() => {
    if (!isChatPerfClientEnabled()) return
    if (input.status !== "streaming") return
    if (input.hasVisibleAssistantText && !sawVisibleText.current) {
      sawVisibleText.current = true
      markChatPerf("first_visible_text", turnFields())
    }
  }, [input.hasVisibleAssistantText, input.status])
}

// ---------------------------------------------------------------------------
// Navigation / chat-switch marks and the settlement receipt
// ---------------------------------------------------------------------------

type NavigationPerfInput = {
  chatId: string | null
  /** True while the authoritative selected-conversation query is loading. */
  isAuthoritativeLoading: boolean
  authoritativeMessageCount: number
  totalMessageCount: number
  selectedRunStatus: string | null
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "aborted"])

/**
 * Chat-switch responsiveness marks (plan PR 0 step 3): route commit,
 * cache hit/miss at commit, first thread content, authoritative content
 * arrival, and the durable settlement receipt (selected-run terminal
 * transition). All keyed per chat id.
 */
export function useChatNavigationPerfMarks(input: NavigationPerfInput): void {
  const committedChatId = useRef<string | null>(null)
  const paintedForChatId = useRef<string | null>(null)
  const authoritativeForChatId = useRef<string | null>(null)
  const previousRunStatus = useRef<string | null>(null)
  // Latest-value ref: hit/miss is a fact about the moment the route
  // committed, so the commit effect reads it from a ref instead of taking
  // loading/count churn as dependencies. Updated in its own effect (declared
  // FIRST so it runs before the commit effect within the same commit).
  const cacheStateAtCommit = useRef<"hit" | "miss">("miss")
  useEffect(() => {
    cacheStateAtCommit.current =
      input.authoritativeMessageCount > 0 || !input.isAuthoritativeLoading
        ? "hit"
        : "miss"
  })

  useEffect(() => {
    if (!isChatPerfClientEnabled()) return
    if (committedChatId.current === input.chatId) return
    committedChatId.current = input.chatId
    paintedForChatId.current = null
    authoritativeForChatId.current = null
    if (input.chatId === null) return
    markChatPerf("chat_route_state_committed")
    markChatPerf("navigation_cache_hit_or_miss", {
      cache: cacheStateAtCommit.current,
    })
  }, [input.chatId])

  useEffect(() => {
    if (!isChatPerfClientEnabled()) return
    if (input.chatId === null) return
    if (
      input.totalMessageCount > 0 &&
      paintedForChatId.current !== input.chatId
    ) {
      paintedForChatId.current = input.chatId
      markChatPerf("first_thread_content_painted", {
        messageCount: input.totalMessageCount,
      })
    }
    if (
      input.authoritativeMessageCount > 0 &&
      authoritativeForChatId.current !== input.chatId
    ) {
      authoritativeForChatId.current = input.chatId
      markChatPerf("authoritative_thread_content_received", {
        messageCount: input.authoritativeMessageCount,
      })
    }
  }, [input.chatId, input.totalMessageCount, input.authoritativeMessageCount])

  useEffect(() => {
    if (!isChatPerfClientEnabled()) return
    const previous = previousRunStatus.current
    previousRunStatus.current = input.selectedRunStatus
    if (
      input.selectedRunStatus &&
      TERMINAL_RUN_STATUSES.has(input.selectedRunStatus) &&
      previous !== null &&
      previous !== input.selectedRunStatus
    ) {
      markChatPerf("durable_settlement_receipt", {
        outcome: input.selectedRunStatus as "completed" | "failed" | "aborted",
      })
    }
  }, [input.selectedRunStatus])
}
