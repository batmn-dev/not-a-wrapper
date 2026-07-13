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
 *    the message ROW renders (tool signature, reasoning phase, metadata
 *    identity, server id) — deliberately NOT `reasoning.text` or `sources`,
 *    so streaming reasoning/source deltas do not churn the row body (the
 *    activity panel owns that state; the trigger's source count settles on
 *    the status flip). Message text is compared by the row's `children` prop.
 */
import type { ToolUIPart, UIMessage } from "ai"
import { getStaticToolName, isStaticToolUIPart } from "ai"
import type { DurableMessageStatus } from "./durable-contract"
import { getReasoningDurationMs, getServerMessageId } from "./metadata"
import { extractTextFromMessageParts, getToolRenderSignature } from "./parts"
import { getSources, type AssistantSourceResult } from "./sources"

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
  /** Ordered reasoning blocks whose original text contains visible content. */
  displayableBlocks: ReadonlyArray<{ text: string }>
  /** Any reasoning part or durable duration was observed, visible or opaque. */
  hasObservedActivity: boolean
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
  displayableBlocks: [],
  hasObservedActivity: false,
  isStreaming: false,
  isOpaque: false,
  persistedDurationMs: undefined,
}

export type AssistantTurnView = {
  /**
   * Original message-part order, retained as the normalized chronology seam.
   * Activity presentation derives from this array once; renderers must not
   * rebuild ordering from the type-specific projections below.
   */
  orderedParts: UIMessage["parts"]
  /** Ordered text content across all text parts. */
  text: string
  /** Static tool parts, for phase detection and non-timeline result rendering. */
  toolParts: ToolUIPart[]
  /** Immutable snapshot of rendered tool input/output for memo comparison. */
  toolRenderSignature: string
  /** Normalized sources across source-url parts and tool outputs. */
  sources: AssistantSourceResult[]
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
  const persistedDurationMs = getReasoningDurationMs(metadata)

  // A persisted duration is durable evidence that reasoning happened even
  // when the stored parts carry no reasoning part (the persist layer drops
  // empty opaque reasoning). Without this, a turn that read "Thought for Ns"
  // while settling would lose its trigger the moment the durable snapshot is
  // adopted — the same turn rendering two different settled states.
  if (reasoningParts.length === 0 && persistedDurationMs !== undefined) {
    return {
      phase: "complete",
      text: "",
      displayableBlocks: [],
      hasObservedActivity: true,
      isStreaming: false,
      isOpaque: true,
      persistedDurationMs,
    }
  }

  let phase: ReasoningView["phase"] = "idle"
  let text = ""

  // A raw "streaming" part state only means "thinking" while the chat status
  // itself is live. An abort/stop/error freezes part states in place without a
  // terminal transition, so a stuck "streaming" part on a settled turn must
  // read as complete — otherwise the trigger shimmers and the panel timer
  // ticks forever after Stop.
  const isLiveStatus = status === "streaming" || status === "submitted"
  const isAnyStreaming =
    isLiveStatus &&
    reasoningParts.some((p) => (p as { state?: string }).state === "streaming")

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
    displayableBlocks: reasoningParts
      .filter((part) => part.text.trim().length > 0)
      .map((part) => ({ text: part.text })),
    hasObservedActivity:
      reasoningParts.length > 0 || persistedDurationMs !== undefined,
    isStreaming: isAnyStreaming,
    isOpaque: phase !== "idle" && !text.trim(),
    persistedDurationMs,
  }
}

function getSearchImageResults(toolParts: ToolUIPart[]): SearchImageResult[] {
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
    orderedParts: parts ?? [],
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
 * True when any of the turn's visible thread content survived: text, tool
 * cards, or image results. The aborted/failed banners' "Partial response
 * preserved." claim must hold only when this is true — reasoning alone lives
 * in the Activity panel and is not preserved response content, so a stop that
 * lands mid-thinking reads as a bare "Generation stopped."
 */
export function hasPreservedResponseContent(view: AssistantTurnView): boolean {
  return (
    view.text.length > 0 ||
    view.toolParts.length > 0 ||
    view.searchImageResults.length > 0
  )
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
 * and must not churn the streaming row body (the R3 memo contract). The row's
 * sources presentations (the trigger's source count, the footer sources
 * badge) render from `sources` but ONLY on settled turns, and every path into
 * settled re-renders the row through compared fields — the client status
 * flip, an isLast handoff, or the durable snapshot's metadata identity change
 * — so excluding `sources` can neither churn a live row nor swallow the
 * settle that reveals them.
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

/**
 * The canonical Assistant turn phase — the single answer to "what is this
 * turn doing right now?", derived once per row render. Every loading/progress
 * affordance on the row (activity trigger, loaders, tool chips, panel timer)
 * is a PRESENTATION of this value; none re-derives its own gate from raw
 * parts/status, which is how two indicators used to be true at once.
 *
 * Discriminated union, not booleans: the kinds are mutually exclusive by
 * construction (a first-match ladder), so a new capability adds a kind or a
 * presentation — it cannot add a second simultaneous indicator.
 */
export type AssistantTurnPhase =
  | { kind: "submitted" }
  | { kind: "thinking"; visibility: "visible" | "opaque" }
  | { kind: "generating-image" }
  | { kind: "tooling"; toolNames: string[] }
  | { kind: "awaiting-approval" }
  | { kind: "responding" }
  | { kind: "settled" }

/**
 * The row render status the phase ladder consumes: the client stream status
 * for the turn this client owns, plus the durable settled/paused sub-states
 * adopted from the server (aborted/failed/awaiting_approval). Durable LIVE
 * statuses (submitted/streaming) are deliberately not trusted here — after a
 * Stop or a dropped stream the server-side run can lag its terminal
 * transition by up to a minute, and the row must settle on the client's
 * verdict immediately.
 */
export type AssistantTurnRenderStatus = ChatStatus | DurableMessageStatus

const IMAGE_GENERATION_TOOL_NAMES = new Set([
  "imageGeneration",
  "image_generation",
])

/**
 * Tool part states that mean "work is in flight". Approval states are
 * deliberately excluded: `approval-requested` is the paused awaiting-approval
 * phase (rendering it as "Running" contradicted the Review chip), and a
 * denied `approval-responded` will never run. An approved response is
 * in flight — the tool is about to execute.
 */
function isInFlightToolPart(part: ToolUIPart): boolean {
  if (part.state === "input-streaming" || part.state === "input-available") {
    return true
  }
  return (
    part.state === "approval-responded" &&
    "approval" in part &&
    (part as { approval?: { approved?: boolean } }).approval?.approved === true
  )
}

/**
 * Derive the canonical turn phase. A first-match ladder over one liveness
 * fact: only the last turn, while THIS client's stream is submitted/streaming,
 * is ever in a live phase. Everything else — historical rows, stopped or
 * errored streams, turns another session may still be running — is settled,
 * so raw in-progress part states frozen by an abort can never keep a live
 * indicator on screen.
 */
export function deriveAssistantTurnPhase(
  view: AssistantTurnView,
  {
    status,
    isLast,
  }: {
    status: AssistantTurnRenderStatus
    isLast: boolean
  }
): AssistantTurnPhase {
  // A durable approval pause is authoritative wherever it appears.
  if (status === "awaiting_approval") return { kind: "awaiting-approval" }

  const isLive = isLast && (status === "submitted" || status === "streaming")
  if (!isLive) return { kind: "settled" }

  if (status === "submitted") return { kind: "submitted" }

  if (view.toolParts.some((part) => part.state === "approval-requested")) {
    return { kind: "awaiting-approval" }
  }

  const inFlightToolParts = view.toolParts.filter(isInFlightToolPart)
  if (
    inFlightToolParts.some((part) =>
      IMAGE_GENERATION_TOOL_NAMES.has(getStaticToolName(part))
    )
  ) {
    return { kind: "generating-image" }
  }
  if (inFlightToolParts.length > 0) {
    return {
      kind: "tooling",
      toolNames: Array.from(
        new Set(inFlightToolParts.map((part) => getStaticToolName(part)))
      ),
    }
  }

  if (view.reasoning.phase === "thinking") {
    return {
      kind: "thinking",
      visibility: view.reasoning.isOpaque ? "opaque" : "visible",
    }
  }

  // Substance = anything of this turn already on screen (text, tool cards,
  // image results) or invisible-but-real activity (opaque reasoning that
  // finished). A bare stream remains in the universal Thinking phase.
  const hasSubstance =
    view.text.trim().length > 0 ||
    view.toolParts.length > 0 ||
    view.searchImageResults.length > 0 ||
    view.reasoning.phase !== "idle"
  return hasSubstance
    ? { kind: "responding" }
    : { kind: "thinking", visibility: "opaque" }
}
