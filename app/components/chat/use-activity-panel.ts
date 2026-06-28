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
 * Chat retains ownership of panel open/selection state; assistant rows only
 * request a turn selection or close the shared surface.
 */
export type ActivityPanelControls = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Id of the turn currently shown by the single Activity panel surface. */
  panelTurnId?: string
  /** Selects a turn and opens the single Chat-owned Activity panel surface. */
  onOpenTurn: (turnId: string) => void
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
  /** The generation-following turn id: pending placeholder or last assistant. */
  defaultActivityTurnId: string | undefined
  /** The turn whose content is currently projected into the panel. */
  panelActivityTurnId: string | undefined
  /** True while a generation is in flight (covers the pre-stream submitted state). */
  isGenerationActive: boolean
  panelProps: ActivityPanelProps
}

export type ActivityPanelTarget = {
  defaultActivityTurnId: string | undefined
  panelActivityTurnId: string | undefined
  panelMessage: UIMessage | undefined
  isGenerationActive: boolean
  isPendingActivityTurn: boolean
}

export function selectExplicitActivityTurnOnOpen({
  requestedTurnId,
  defaultActivityTurnId,
}: {
  requestedTurnId: string
  defaultActivityTurnId: string | undefined
}): string | undefined {
  return requestedTurnId === defaultActivityTurnId ? undefined : requestedTurnId
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

function getActivityTurnId(message: UIMessage | undefined): string | undefined {
  if (!message) return undefined

  const metadata = message.metadata as ChatMessageMetadata | undefined
  return message.id ?? getServerMessageId(metadata)
}

function matchesActivityTurn(
  message: UIMessage | undefined,
  turnId: string | undefined
): boolean {
  if (!message || turnId === undefined) return false

  const metadata = message.metadata as ChatMessageMetadata | undefined
  return message.id === turnId || getServerMessageId(metadata) === turnId
}

function findAssistantTurn(
  messages: UIMessage[],
  turnId: string | undefined
): UIMessage | undefined {
  if (turnId === undefined) return undefined

  return messages.find(
    (message) =>
      message.role === "assistant" && matchesActivityTurn(message, turnId)
  )
}

function findLastAssistantTurn(messages: UIMessage[]): UIMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i]
  }

  return undefined
}

export function selectActivityPanelTarget({
  messages,
  status,
  isSubmitting,
  selectedActivityTurnId,
}: {
  messages: UIMessage[]
  status: ChatStatus
  isSubmitting: boolean
  selectedActivityTurnId?: string
}): ActivityPanelTarget {
  const generationActive = isGenerationActive(status, isSubmitting)
  const hasPendingAssistantTurn =
    generationActive && messages[messages.length - 1]?.role === "user"

  // During submit preflight, the next assistant turn has no server/client id
  // yet, so the generation-following default is the pending placeholder.
  const defaultMessage = hasPendingAssistantTurn
    ? undefined
    : findLastAssistantTurn(messages)
  const defaultActivityTurnId = hasPendingAssistantTurn
    ? PENDING_ACTIVITY_TURN_ID
    : getActivityTurnId(defaultMessage)

  const selectedPendingTurn =
    hasPendingAssistantTurn &&
    selectedActivityTurnId === PENDING_ACTIVITY_TURN_ID
  const selectedMessage = selectedPendingTurn
    ? undefined
    : findAssistantTurn(messages, selectedActivityTurnId)

  const panelActivityTurnId = selectedPendingTurn
    ? PENDING_ACTIVITY_TURN_ID
    : (getActivityTurnId(selectedMessage) ?? defaultActivityTurnId)

  return {
    defaultActivityTurnId,
    panelActivityTurnId,
    panelMessage: selectedMessage ?? defaultMessage,
    isGenerationActive: generationActive,
    isPendingActivityTurn: panelActivityTurnId === PENDING_ACTIVITY_TURN_ID,
  }
}

/**
 * useActivityPanel — the single, chat-owned selector for the Activity panel
 * (plan §4, GA §6.7). Called ONCE by `Chat` after `useChatCore` returns the
 * already-projected selected path; it does NOT recompute `projectSelectedPath`.
 *
 * The default target follows the latest generation/pending assistant. An
 * explicit selected turn, when still present in the rendered path, overrides
 * that default so historical Activity panel content stays addressable while new
 * messages stream. Individual `MessageAssistant` instances never call this hook.
 */
export function useActivityPanel({
  messages,
  status,
  isSubmitting,
  selectedActivityTurnId,
}: {
  messages: UIMessage[]
  status: ChatStatus
  isSubmitting: boolean
  selectedActivityTurnId?: string
}): UseActivityPanelResult {
  const {
    defaultActivityTurnId,
    panelActivityTurnId,
    panelMessage,
    isGenerationActive: generationActive,
    isPendingActivityTurn,
  } = selectActivityPanelTarget({
    messages,
    status,
    isSubmitting,
    selectedActivityTurnId,
  })

  const panelMetadata = panelMessage?.metadata as
    | ChatMessageMetadata
    | undefined

  const persistedDurationMs =
    typeof panelMetadata?.reasoningDurationMs === "number"
      ? panelMetadata.reasoningDurationMs
      : undefined

  // The reasoning hook runs once for the panel target. The live timer only runs
  // for the default generation turn; historical selections remain stable while a
  // newer generation streams elsewhere in the thread.
  const isPanelDefaultTurn =
    panelActivityTurnId !== undefined &&
    panelActivityTurnId === defaultActivityTurnId
  const {
    phase,
    reasoningText,
    durationSeconds,
    isReasoningStreaming,
    isOpaqueReasoning,
  } = useReasoningPhase({
    parts: panelMessage?.parts,
    status,
    isLast: Boolean(panelMessage) && isPanelDefaultTurn,
    persistedDurationMs,
  })

  const sources = getSources(panelMessage?.parts ?? [])
  const steps =
    panelMessage?.parts?.filter((part): part is ToolUIPart =>
      isStaticToolUIPart(part)
    ) ?? []

  const panelProps: ActivityPanelProps = isPendingActivityTurn
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
    defaultActivityTurnId,
    panelActivityTurnId,
    isGenerationActive: generationActive,
    panelProps,
  }
}
