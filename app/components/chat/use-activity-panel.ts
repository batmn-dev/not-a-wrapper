"use client"

import type { ChatMessageMetadata } from "@/lib/chat-messages/branch"
import { getServerMessageId } from "@/lib/chat-messages/metadata"
import type { UIMessage } from "@ai-sdk/react"
import type { SourceUrlUIPart, ToolUIPart } from "ai"
import { isStaticToolUIPart } from "ai"
import { getSources } from "./get-sources"
import { useReasoningPhase, type ReasoningPhase } from "./use-reasoning-phase"

type ChatStatus = "streaming" | "ready" | "submitted" | "error"

export const PENDING_ACTIVITY_TURN_ID = "__pending_activity_turn__"

/**
 * The Chat-owned Activity-panel controls, forwarded as ONE object from Chat
 * through Conversation → Message → MessageAssistant to the assistant trigger
 * (replacing three individually-drilled props). Chat retains ownership of the
 * state; this is read-only plumbing. Inner names match the trigger primitive.
 */
export type ActivityPanelControls = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Stable id of the panel surface; emitted as the trigger's `aria-controls`. */
  panelId?: string
}

/**
 * Data the selector hands to `<ActivityPanel>` via `panelProps`.
 *
 * NOTE — `phase`, `steps`, and `isReasoningStreaming` are intentional
 * ChatGPT-replication scaffolding for an upcoming live-timeline pass; the panel
 * does not consume them yet (kept deliberately, not dead). See the annotated
 * `ActivityPanelProps` in `activity/activity-panel.tsx` and TODO.md.
 */
export type ActivityPanelProps = {
  phase: ReasoningPhase["phase"]
  steps: ToolUIPart[]
  sources: SourceUrlUIPart[]
  durationSeconds: number | undefined
  reasoningText: string
  isReasoningStreaming: boolean
  isOpaqueReasoning: boolean
}

export type UseActivityPanelResult = {
  /** The owning turn id — the last assistant message in the rendered path. */
  activeTurnId: string | undefined
  /** True while a generation is in flight (covers the pre-stream submitted state). */
  isGenerationActive: boolean
  panelProps: ActivityPanelProps
}

/**
 * True while a generation is in flight (covers the pre-stream submitted state).
 * Shared by `useActivityPanel` and `Conversation` so the gate can't drift. (A
 * third, private copy lives in `chat-turn.ts`, out of this module's scope.)
 */
export function isGenerationActive(
  status: ChatStatus,
  isSubmitting: boolean
): boolean {
  return isSubmitting || status === "submitted" || status === "streaming"
}

/**
 * useActivityPanel — the single, chat-owned selector for the Activity panel
 * (plan §4, GA §6.7). Called ONCE by `Chat` after `useChatCore` returns the
 * already-projected selected path; it does NOT recompute `projectSelectedPath`.
 *
 * Ownership keys off the last assistant message in that rendered array
 * (`activeTurnId`), not per-message positional `isLast`. The reasoning hook runs
 * once for that tail, so its `isLast` now means "panel-active turn". Individual
 * `MessageAssistant` instances never call this hook.
 */
export function useActivityPanel({
  messages,
  status,
  isSubmitting,
}: {
  messages: UIMessage[]
  status: ChatStatus
  isSubmitting: boolean
}): UseActivityPanelResult {
  const hasPendingAssistantTurn =
    status === "submitted" && messages[messages.length - 1]?.role === "user"

  // Scan from the end for the last assistant message (the selected-path tail).
  // During submit preflight, the next assistant turn has no server/client id yet,
  // so the panel is owned by the pending placeholder instead of the previous
  // assistant response.
  let tail: UIMessage | undefined
  if (!hasPendingAssistantTurn) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        tail = messages[i]
        break
      }
    }
  }

  // Prefer the optimistic id; the server id is the cross-key used downstream
  // (message.tsx / message-assistant.tsx) when the optimistic id hasn't anchored
  // yet (mirrors selected-path.ts identity keys).
  const tailMetadata = tail?.metadata as ChatMessageMetadata | undefined
  const activeTurnId = hasPendingAssistantTurn
    ? PENDING_ACTIVITY_TURN_ID
    : (tail?.id ?? getServerMessageId(tailMetadata))

  const persistedDurationMs =
    typeof tailMetadata?.reasoningDurationMs === "number"
      ? tailMetadata.reasoningDurationMs
      : undefined

  // The reasoning hook runs once for the selected tail. `isLast` is now the
  // panel-active-turn gate (the live timer runs only while the tail is thinking).
  const {
    phase,
    reasoningText,
    durationSeconds,
    isReasoningStreaming,
    isOpaqueReasoning,
  } = useReasoningPhase({
    parts: tail?.parts,
    status,
    isLast: Boolean(tail),
    persistedDurationMs,
  })

  const sources = getSources(tail?.parts ?? [])
  const steps =
    tail?.parts?.filter((part): part is ToolUIPart =>
      isStaticToolUIPart(part)
    ) ?? []

  const panelProps: ActivityPanelProps = hasPendingAssistantTurn
    ? {
        phase: "thinking",
        steps: [],
        sources: [],
        durationSeconds: undefined,
        reasoningText: "",
        isReasoningStreaming: true,
        isOpaqueReasoning: true,
      }
    : {
        phase,
        steps,
        sources,
        durationSeconds,
        reasoningText,
        isReasoningStreaming,
        isOpaqueReasoning,
      }

  return {
    activeTurnId,
    isGenerationActive: isGenerationActive(status, isSubmitting),
    panelProps,
  }
}
