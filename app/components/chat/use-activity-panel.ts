"use client"

import {
  deriveAssistantActivityPresentation,
  type AssistantActivitySection,
} from "@/lib/chat-messages/assistant-activity"
import {
  deriveAssistantTurnPhase,
  deriveAssistantTurnView,
  IDLE_REASONING_VIEW,
} from "@/lib/chat-messages/assistant-turn"
import { getServerMessageId } from "@/lib/chat-messages/metadata"
import type { UIMessage } from "@ai-sdk/react"
import { useReasoningPhase } from "./use-reasoning-phase"

type ChatStatus = "streaming" | "ready" | "submitted" | "error"

export const PENDING_ACTIVITY_TURN_ID = "__pending_activity_turn__"

/** Data the selector hands to `<ActivityPanel>` via `panelProps`. */
export type ActivityPanelProps = {
  sections: readonly AssistantActivitySection[]
  durationSeconds: number | undefined
}

export type UseActivityPanelResult = {
  /** The generation-following turn id: pending placeholder or last assistant. */
  defaultActivityTurnId: string | undefined
  /** The turn whose content is currently projected into the panel. */
  panelActivityTurnId: string | undefined
  /** True while a generation is in flight (covers the pre-stream submitted state). */
  isGenerationActive: boolean
  /** False when an explicit selection no longer resolves to a rendered turn
   * (branch switch, local delete) — Chat's signal to drop the stale selection
   * from the store instead of letting it linger and resurrect later. */
  selectedTurnPresent: boolean
  /** Whether the selected/default turn has at least one inspectable section. */
  panelCanOpen: boolean
  panelProps: ActivityPanelProps
}

export type ActivityPanelTarget = {
  defaultActivityTurnId: string | undefined
  panelActivityTurnId: string | undefined
  panelMessage: UIMessage | undefined
  isGenerationActive: boolean
  isPendingActivityTurn: boolean
  /** False when `selectedActivityTurnId` matched no rendered turn (the panel
   * silently fell back to the default). Vacuously true with no selection. */
  selectedTurnPresent: boolean
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

  return message.id ?? getServerMessageId(message.metadata)
}

function matchesActivityTurn(
  message: UIMessage | undefined,
  turnId: string | undefined
): boolean {
  if (!message || turnId === undefined) return false

  return (
    message.id === turnId || getServerMessageId(message.metadata) === turnId
  )
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
    selectedTurnPresent:
      selectedActivityTurnId === undefined ||
      selectedPendingTurn ||
      selectedMessage !== undefined,
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
 * messages stream. Individual `MessageAssistant` instances never call this hook
 * — rows reach the panel through the activity panel store seam
 * (activity/activity-panel-store.tsx), which Chat syncs with this selector's
 * output.
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
    selectedTurnPresent,
  } = selectActivityPanelTarget({
    messages,
    status,
    isSubmitting,
    selectedActivityTurnId,
  })

  // The reasoning hook runs once for the panel target. The live timer only runs
  // for the default generation turn; historical selections remain stable while a
  // newer generation streams elsewhere in the thread.
  const isPanelDefaultTurn =
    panelActivityTurnId !== undefined &&
    panelActivityTurnId === defaultActivityTurnId

  // One derivation for the panel target — the same Assistant turn view the
  // message row derives, so the trigger and the panel can never disagree.
  const panelView = panelMessage
    ? deriveAssistantTurnView(
        panelMessage,
        isPanelDefaultTurn ? status : "ready"
      )
    : undefined

  const reasoningPhase = useReasoningPhase({
    reasoning: panelView?.reasoning ?? IDLE_REASONING_VIEW,
    isLast: Boolean(panelMessage) && isPanelDefaultTurn,
    // Turn identity for the timer: a panel re-target (default-follow onto a
    // new generation, explicit selection) must restart the tick from 0, never
    // inherit the previous turn's frozen duration.
    turnKey: panelActivityTurnId,
  })

  const panelPhase = panelView
    ? deriveAssistantTurnPhase(panelView, {
        status: isPanelDefaultTurn ? status : "ready",
        isLast: isPanelDefaultTurn,
      })
    : ({ kind: "submitted" } as const)
  const presentation = panelView
    ? deriveAssistantActivityPresentation(panelView, panelPhase, {
        durationMs: reasoningPhase.durationMs,
      })
    : ({ kind: "live-status" } as const)
  const panelCanOpen = presentation.kind === "disclosure"

  const panelProps: ActivityPanelProps = isPendingActivityTurn
    ? {
        sections: [],
        durationSeconds: undefined,
      }
    : {
        sections:
          presentation.kind === "disclosure" ? presentation.sections : [],
        durationSeconds: reasoningPhase.durationSeconds,
      }

  return {
    defaultActivityTurnId,
    panelActivityTurnId,
    isGenerationActive: generationActive,
    selectedTurnPresent,
    panelCanOpen,
    panelProps,
  }
}
