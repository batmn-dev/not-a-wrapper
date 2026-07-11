import { getStaticToolName, type SourceUrlUIPart, type ToolUIPart } from "ai"
import { formatDuration, toCompletedDurationSeconds } from "../format-duration"
import { humanizeToolName } from "../tools/ui-metadata"
import type {
  AssistantTurnPhase,
  AssistantTurnView,
  SearchImageResult,
} from "./assistant-turn"
import { getToolDisplayName } from "./metadata"

export type NonEmptyTuple<T> = readonly [T, ...T[]]

export type AssistantActivityToolEntry = {
  id: string
  label: string
  description: string
}

export type AssistantActivitySection =
  | {
      kind: "reasoning"
      blocks: NonEmptyTuple<{ text: string }>
      isStreaming: boolean
    }
  | { kind: "sources"; sources: NonEmptyTuple<SourceUrlUIPart> }
  | { kind: "tool-steps"; entries: NonEmptyTuple<AssistantActivityToolEntry> }
  | { kind: "approvals"; entries: NonEmptyTuple<AssistantActivityToolEntry> }
  | { kind: "images"; results: NonEmptyTuple<SearchImageResult> }
  | { kind: "tool-errors"; entries: NonEmptyTuple<AssistantActivityToolEntry> }

export type ActivityMotionIntent = "none" | "shimmer"

export type AssistantActivityPresentation =
  | { kind: "none" }
  | {
      kind: "live-status"
      semanticKind: "thinking" | "search" | "image" | "approval" | "tool"
      label: string
      detail?: string
      motion: ActivityMotionIntent
    }
  | { kind: "passive"; label: string; durationSeconds: number }
  | {
      kind: "disclosure"
      label: string
      motion: ActivityMotionIntent
      sections: NonEmptyTuple<AssistantActivitySection>
      passiveLabel?: string
      durationSeconds?: number
    }

function asNonEmpty<T>(values: readonly T[]): NonEmptyTuple<T> | undefined {
  return values.length > 0 ? (values as NonEmptyTuple<T>) : undefined
}

function isApprovalStep(step: ToolUIPart): boolean {
  return (
    step.state === "approval-requested" ||
    step.state === "approval-responded" ||
    step.state === "output-denied"
  )
}

function isErrorStep(step: ToolUIPart): boolean {
  if (step.state === "output-error") return true
  if (step.state !== "output-available") return false
  return (
    typeof step.output === "object" &&
    step.output !== null &&
    "isError" in step.output &&
    (step.output as { isError?: unknown }).isError === true
  )
}

function toolStepDescription(step: ToolUIPart): string {
  switch (step.state) {
    case "approval-requested":
      return "Approval required before this tool can run."
    case "approval-responded":
      return step.approval.approved ? "Approved" : "Denied"
    case "output-denied":
      return step.approval.reason ? `Denied: ${step.approval.reason}` : "Denied"
    case "output-error":
      return step.errorText || "Failed"
    case "input-streaming":
    case "input-available":
      return "In progress"
    case "output-available":
      return isErrorStep(step) ? "Tool reported an error" : "Completed"
  }
}

function toToolEntries(
  view: AssistantTurnView,
  steps: NonEmptyTuple<ToolUIPart>
): NonEmptyTuple<AssistantActivityToolEntry> {
  const toEntry = (step: ToolUIPart): AssistantActivityToolEntry => {
    const toolName = getStaticToolName(step)
    return {
      id: step.toolCallId,
      label:
        getToolDisplayName(view.metadata, toolName, step.toolCallId) ??
        humanizeToolName(toolName),
      description: toolStepDescription(step),
    }
  }
  const [first, ...rest] = steps
  return [toEntry(first), ...rest.map(toEntry)]
}

export function deriveAssistantActivitySections(
  view: AssistantTurnView
): AssistantActivitySection[] {
  const sections: AssistantActivitySection[] = []
  const reasoningBlocks = asNonEmpty(view.reasoning.displayableBlocks)
  if (reasoningBlocks) {
    sections.push({
      kind: "reasoning",
      blocks: reasoningBlocks,
      isStreaming: view.reasoning.isStreaming,
    })
  }

  const sources = asNonEmpty(view.sources)
  if (sources) sections.push({ kind: "sources", sources })

  const images = asNonEmpty(view.searchImageResults)
  if (images) sections.push({ kind: "images", results: images })

  const approvals = asNonEmpty(view.toolParts.filter(isApprovalStep))
  if (approvals) {
    sections.push({
      kind: "approvals",
      entries: toToolEntries(view, approvals),
    })
  }

  const errors = asNonEmpty(view.toolParts.filter(isErrorStep))
  if (errors) {
    sections.push({
      kind: "tool-errors",
      entries: toToolEntries(view, errors),
    })
  }

  const toolSteps = asNonEmpty(
    view.toolParts.filter((step) => !isApprovalStep(step) && !isErrorStep(step))
  )
  if (toolSteps) {
    sections.push({
      kind: "tool-steps",
      entries: toToolEntries(view, toolSteps),
    })
  }

  return sections
}

function resolveLiveStatus(
  view: AssistantTurnView,
  phase: AssistantTurnPhase
): Omit<
  Extract<AssistantActivityPresentation, { kind: "live-status" }>,
  "kind"
> {
  switch (phase.kind) {
    case "generating-image":
      return {
        semanticKind: "image",
        label: "Generating image",
        motion: "shimmer",
      }
    case "awaiting-approval":
      return {
        semanticKind: "approval",
        label: "Awaiting approval",
        motion: "none",
      }
    case "tooling": {
      if (phase.toolNames.length !== 1) {
        return {
          semanticKind: "tool",
          label: "Running tools",
          motion: "shimmer",
        }
      }
      const toolName = phase.toolNames[0]
      if (toolName === "web_search" || toolName === "google_search") {
        return {
          semanticKind: "search",
          label: "Searching the web",
          motion: "shimmer",
        }
      }
      const displayName = getToolDisplayName(view.metadata, toolName)
      return {
        semanticKind: "tool",
        label: `Using ${displayName ?? humanizeToolName(toolName)}`,
        motion: "shimmer",
      }
    }
    case "submitted":
    case "thinking":
    case "responding":
    case "settled":
      return { semanticKind: "thinking", label: "Thinking", motion: "shimmer" }
  }
}

function completedReasoningLabel(durationSeconds: number | undefined): string {
  return durationSeconds === undefined
    ? "Thought"
    : `Thought for ${formatDuration(durationSeconds)}`
}

export function deriveAssistantActivityPresentation(
  view: AssistantTurnView,
  phase: AssistantTurnPhase,
  options?: { durationMs?: number }
): AssistantActivityPresentation {
  const durationMs = options?.durationMs ?? view.reasoning.persistedDurationMs
  const durationSeconds = toCompletedDurationSeconds(durationMs)
  const sections = asNonEmpty(deriveAssistantActivitySections(view))
  const isLive = phase.kind !== "settled" && phase.kind !== "responding"

  if (isLive) {
    const status = resolveLiveStatus(view, phase)
    if (sections) {
      return {
        kind: "disclosure",
        label: status.label,
        motion: status.motion,
        sections,
        durationSeconds,
      }
    }
    return { kind: "live-status", ...status }
  }

  if (phase.kind === "responding" && !sections) return { kind: "none" }

  if (sections) {
    const hasReasoning = sections.some(
      (section) => section.kind === "reasoning"
    )
    const label = hasReasoning
      ? completedReasoningLabel(durationSeconds)
      : view.sources.length > 0 && sections.length === 1
        ? `${view.sources.length} source${view.sources.length === 1 ? "" : "s"}`
        : "Activity"
    return {
      kind: "disclosure",
      label,
      motion: "none",
      sections,
      durationSeconds,
      passiveLabel:
        !hasReasoning && durationSeconds !== undefined
          ? completedReasoningLabel(durationSeconds)
          : undefined,
    }
  }

  if (view.reasoning.hasObservedActivity && durationSeconds !== undefined) {
    return {
      kind: "passive",
      label: completedReasoningLabel(durationSeconds),
      durationSeconds,
    }
  }

  return { kind: "none" }
}
