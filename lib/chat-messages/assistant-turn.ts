/**
 * Assistant turn view — the single pure derivation of everything renderers
 * need from one assistant message. See CONTEXT.md "Assistant turn view".
 *
 * Before this module, "is this message thinking?", "which sources?", and
 * "which tool parts?" were re-derived from raw `parts`/`metadata` at three
 * sites (the message row, the activity trigger, and the activity panel), two
 * of which bypassed the Message metadata module. The trigger and the panel
 * could disagree on screen because they read the same facts through different
 * paths.
 *
 * Invariants:
 *  - Pure and derived PER RENDER. The AI SDK mutates part objects in place
 *    during streaming without changing array/object references, so this
 *    derivation must never be memoized by `parts` or message reference.
 *  - All metadata reads go through the Message metadata module's readers
 *    (ADR-0002) — never `metadata as Record<string, unknown>`.
 *  - `assistantTurnViewsEqual` is the render-gate: it compares only the facts
 *    the message ROW renders (tool signature, reasoning phase, source count,
 *    metadata identity) — deliberately NOT `reasoning.text`, so streaming
 *    reasoning deltas do not churn the row body (the activity panel owns that
 *    state). Message text is compared by the row's `children` prop.
 */
import type { UIMessage } from "ai"
import type { SourceUrlUIPart, ToolUIPart } from "ai"
import { getStaticToolName, isStaticToolUIPart } from "ai"
import { getReasoningDurationMs, getServerMessageId } from "./metadata"
import {
  extractTextFromMessageParts,
  getToolRenderSignature,
} from "./parts"
import { getSources } from "./sources"

type ChatStatus = "streaming" | "ready" | "submitted" | "error"

export type SearchImageResult = {
  title: string
  imageUrl: string
  sourceUrl: string
}

export type ReasoningView = {
  phase: "idle" | "thinking" | "complete"
  /** Concatenated reasoning text across reasoning parts. */
  text: string
  /**
   * True only while a reasoning part is LITERALLY streaming (raw part state)
   * — deliberately not derived from `phase`. `phase` may infer "thinking"
   * from chat status for state-less stored parts, which is right for the
   * panel's completion inference but must not make a HISTORICAL row's trigger
   * shimmer "Thinking" whenever some other turn streams.
   */
  isStreaming: boolean
  /** Reasoning happened but produced no visible text (opaque providers). */
  isOpaque: boolean
  /** Server-persisted duration, read via the metadata module. */
  persistedDurationMs: number | undefined
}

export const IDLE_REASONING_VIEW: ReasoningView = {
  phase: "idle",
  text: "",
  isStreaming: false,
  isOpaque: false,
  persistedDurationMs: undefined,
}

export type AssistantTurnView = {
  /** Ordered text content across all text parts. */
  text: string
  /** Static tool parts, for inline tool rendering and the panel timeline. */
  toolParts: ToolUIPart[]
  /** Immutable snapshot of rendered tool input/output for memo comparison. */
  toolRenderSignature: string
  /** Normalized sources across source-url parts and tool outputs. */
  sources: SourceUrlUIPart[]
  /** Image-search results extracted from tool outputs. */
  searchImageResults: SearchImageResult[]
  reasoning: ReasoningView
  /** Durable identity, read via the metadata module. */
  serverMessageId: string | undefined
  /**
   * The message's metadata reference. The metadata writers preserve reference
   * identity on no-op (ADR-0002), so identity comparison of this field is a
   * meaningful change signal (durable status, persisted duration, tool display
   * metadata all arrive as a new metadata object).
   */
  metadata: unknown
}

type MessageLike = { parts?: UIMessage["parts"]; metadata?: unknown }

/**
 * Derive the reasoning phase from parts + chat status. Ported verbatim from
 * the pure half of use-reasoning-phase; the live timer stays in that hook.
 */
export function deriveReasoningView(
  parts: UIMessage["parts"] | undefined,
  status: ChatStatus,
  metadata?: unknown
): ReasoningView {
  const reasoningParts = parts?.filter((p) => p.type === "reasoning") ?? []

  let phase: ReasoningView["phase"] = "idle"
  let text = ""

  const isAnyStreaming = reasoningParts.some(
    (p) => (p as { state?: string }).state === "streaming"
  )

  if (reasoningParts.length > 0) {
    const joined = reasoningParts.map((p) => p.text).join("\n\n")

    if (isAnyStreaming) {
      phase = "thinking"
      text = joined
    } else {
      const isAnyDone = reasoningParts.some(
        (p) => (p as { state?: string }).state === "done"
      )

      if (isAnyDone || status === "ready" || status === "error") {
        phase = "complete"
        text = joined
      } else if (joined.trim()) {
        phase = "complete"
        text = joined
      } else {
        phase = "thinking"
        text = ""
      }
    }
  }

  return {
    phase,
    text,
    isStreaming: isAnyStreaming,
    isOpaque: phase !== "idle" && !text.trim(),
    persistedDurationMs: getReasoningDurationMs(metadata),
  }
}

function getSearchImageResults(
  toolParts: ToolUIPart[]
): SearchImageResult[] {
  return toolParts
    .filter(
      (part) =>
        part.state === "output-available" &&
        getStaticToolName(part) === "imageSearch" &&
        (part.output as { content?: Array<{ type: string }> })?.content?.[0]
          ?.type === "images"
    )
    .flatMap((part) => {
      const output = part.output as {
        content?: Array<{ type: string; results?: SearchImageResult[] }>
      }
      return output?.content?.[0]?.results ?? []
    })
}

export function deriveAssistantTurnView(
  message: MessageLike,
  status: ChatStatus
): AssistantTurnView {
  const parts = message.parts
  const toolParts =
    parts?.filter((part): part is ToolUIPart => isStaticToolUIPart(part)) ?? []

  return {
    text: extractTextFromMessageParts(parts),
    toolParts,
    toolRenderSignature: getToolRenderSignature(parts),
    sources: getSources(parts ?? []),
    searchImageResults: getSearchImageResults(toolParts),
    reasoning: deriveReasoningView(parts, status, message.metadata),
    serverMessageId: getServerMessageId(message.metadata),
    metadata: message.metadata,
  }
}

/**
 * The row's render gate. Views are fresh objects every render (in-place part
 * mutation forbids reference memoization), so equality is content-based over
 * exactly the facts the message row renders:
 *  - `toolRenderSignature` — inline tool cards + image results (tool outputs)
 *  - `reasoning.phase` — the activity trigger's thinking/thought state
 *  - `metadata` identity — durable status, persisted duration, tool display
 *    metadata (the metadata writers preserve reference on no-op)
 *  - `serverMessageId` — the trigger's panel-turn identity
 * Deliberately excluded: `text` (compared via the row's `children` prop) and
 * `reasoning.text` / `sources` — reasoning and source deltas are panel-owned
 * and must not churn the streaming row body (the R3 memo contract; the
 * trigger's source count settles when the stream's status flip re-renders).
 */
export function assistantTurnViewsEqual(
  a: AssistantTurnView | undefined,
  b: AssistantTurnView | undefined
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.toolRenderSignature === b.toolRenderSignature &&
    a.reasoning.phase === b.reasoning.phase &&
    a.metadata === b.metadata &&
    a.serverMessageId === b.serverMessageId
  )
}

export type AssistantLoadingState = {
  showDots: boolean
  showToolProgress: boolean
  showImageGenProgress: boolean
  activeToolNames: string[]
}

const IMAGE_GENERATION_TOOL_NAMES = new Set([
  "imageGeneration",
  "image_generation",
])

/**
 * Loading affordances for a streaming assistant row, derived from the view.
 * Folded from the former use-loading-state hook (it held no state — only a
 * memo over the same part-derivations this module now owns).
 */
export function deriveAssistantLoadingState(
  view: AssistantTurnView,
  {
    status,
    isLast,
    contentNullOrEmpty,
    showToolInvocations,
  }: {
    status: ChatStatus
    isLast: boolean
    contentNullOrEmpty: boolean
    showToolInvocations: boolean
  }
): AssistantLoadingState {
  const isLastStreaming = status === "streaming" && isLast

  // Suppress generating dots only when reasoning has visible text.
  const hasVisibleReasoning = view.reasoning.phase !== "idle"

  const hasVisibleTools = Boolean(
    view.toolParts.length > 0 && showToolInvocations
  )
  const inProgressToolParts = view.toolParts.filter(
    (part) => part.state !== "output-available"
  )
  const activeToolNames = Array.from(
    new Set(inProgressToolParts.map((part) => getStaticToolName(part)))
  )
  const showToolProgress =
    isLastStreaming && showToolInvocations && inProgressToolParts.length > 0

  const showImageGenProgress =
    isLastStreaming &&
    inProgressToolParts.some((part) =>
      IMAGE_GENERATION_TOOL_NAMES.has(getStaticToolName(part))
    )

  const hasVisibleImages = view.searchImageResults.length > 0

  const showDots =
    isLastStreaming &&
    contentNullOrEmpty &&
    !hasVisibleReasoning &&
    !hasVisibleTools &&
    !hasVisibleImages &&
    !showToolProgress &&
    !showImageGenProgress

  return {
    showDots,
    showToolProgress,
    showImageGenProgress,
    activeToolNames,
  }
}
