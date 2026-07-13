import {
  getStaticToolName,
  isStaticToolUIPart,
  type SourceUrlUIPart,
  type ToolUIPart,
} from "ai"
import { formatDuration, toCompletedDurationSeconds } from "../format-duration"
import { humanizeToolName } from "../tools/ui-metadata"
import type {
  AssistantTurnPhase,
  AssistantTurnRenderStatus,
  AssistantTurnView,
  SearchImageResult,
} from "./assistant-turn"
import { getToolDisplayName } from "./metadata"
import type { AssistantSourceResult } from "./sources"

export type NonEmptyTuple<T> = readonly [T, ...T[]]

export type ActivityEntryStatus =
  "running" | "complete" | "approval" | "error" | "stopped"

export type AssistantActivityToolDetail = {
  toolName: string
  displayName: string
  code?: string
  approvalId?: string
  approvalReason?: string
  approved?: boolean
}

export type AssistantActivityEntry = {
  /** Stable across streaming updates: part index for reasoning, call id for tools. */
  id: string
  kind: "reasoning" | "tool" | "search" | "image" | "completion"
  title: string
  detail?: string
  status: ActivityEntryStatus
  tool?: AssistantActivityToolDetail
  /** Sources remain attached to the search step that produced them. */
  sources?: readonly SourceUrlUIPart[]
}

export type AssistantActivityModel = {
  entries: NonEmptyTuple<AssistantActivityEntry>
  /** Full results shown after the timeline, matching the reference hierarchy. */
  sourceResults: readonly AssistantSourceResult[]
  imageResults: readonly SearchImageResult[]
}

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
      activity: AssistantActivityModel
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

function isSearchTool(toolName: string): boolean {
  return toolName === "web_search" || toolName === "google_search"
}

function isImageTool(toolName: string): boolean {
  return toolName === "imageGeneration" || toolName === "image_generation"
}

function toolStatus(
  step: ToolUIPart,
  phase: AssistantTurnPhase
): ActivityEntryStatus {
  if (isErrorStep(step)) return "error"
  if (isApprovalStep(step)) {
    if (step.state === "approval-requested") return "approval"
    if (step.state === "output-denied") return "error"
    return step.approval?.approved ? "running" : "error"
  }
  if (step.state === "output-available") return "complete"
  return phase.kind === "settled" ? "stopped" : "running"
}

function toolCode(input: unknown): string | undefined {
  if (typeof input === "string") return input
  if (typeof input !== "object" || input === null) return undefined
  for (const key of ["command", "code", "script", "query"]) {
    const value = (input as Record<string, unknown>)[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return Object.keys(input).length > 0
    ? JSON.stringify(input, null, 2)
    : undefined
}

function toolDetail(
  step: ToolUIPart,
  toolName: string
): AssistantActivityToolDetail {
  const input = "input" in step ? step.input : undefined
  return {
    toolName,
    displayName: humanizeToolName(toolName),
    code: toolCode(input),
    approvalId:
      step.state === "approval-requested" ? step.approval.id : undefined,
    approvalReason:
      step.state === "output-denied" ? step.approval.reason : undefined,
    approved:
      step.state === "approval-responded" ? step.approval.approved : undefined,
  }
}

function inputQuery(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("query" in input)) {
    return undefined
  }
  const query = (input as { query?: unknown }).query
  return typeof query === "string" && query.trim() ? query.trim() : undefined
}

function inputAction(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined
  for (const key of ["description", "action", "task", "operation"]) {
    const value = (input as Record<string, unknown>)[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function toolActionTitle(
  label: string,
  input: unknown,
  status: ActivityEntryStatus
): string {
  const action = inputAction(input)
  if (action) return action
  if (status === "approval") return `Review ${label}`
  if (status === "error") return `${label} failed`
  if (status === "stopped") return `${label} stopped`
  return status === "running" ? `Using ${label}` : `Used ${label}`
}

function errorDetail(step: ToolUIPart): string | undefined {
  if (step.state === "output-error") return step.errorText || "Tool failed"
  if (step.state === "output-denied") {
    return step.approval.reason || "Approval denied"
  }
  return isErrorStep(step) ? "Tool reported an error" : undefined
}

/**
 * Split provider-visible reasoning into stable summary steps when it uses the
 * common markdown-heading convention. This preserves the part's chronology
 * without exposing a second reasoning-only presentation system.
 */
function reasoningSteps(
  text: string
): Array<{ title: string; detail?: string }> {
  const trimmed = text.trim()
  if (!trimmed) return []

  const boldHeadings = [...trimmed.matchAll(/\*\*([^*\n]{1,120})\*\*/g)]
  if (boldHeadings.length > 0) {
    return boldHeadings.map((match, index) => {
      const next = boldHeadings[index + 1]
      const detail = trimmed
        .slice((match.index ?? 0) + match[0].length, next?.index)
        .trim()
      return { title: match[1].trim(), detail: detail || undefined }
    })
  }

  const lines = trimmed.split("\n")
  const result: Array<{ title: string; detail?: string }> = []
  let title: string | undefined
  let body: string[] = []

  const flush = () => {
    if (!title) return
    const detail = body.join("\n").trim()
    result.push({ title, detail: detail || undefined })
    body = []
  }

  for (const line of lines) {
    const match = line.trim().match(/^(?:#{1,4}\s+|\*\*)(.+?)(?:\*\*)?$/)
    if (match && match[1].trim().length <= 120) {
      flush()
      title = match[1].trim()
    } else if (title) {
      body.push(line)
    }
  }
  flush()
  if (result.length > 0) return result

  const firstLine = lines[0].trim()
  if (lines.length > 1 && firstLine.length <= 120) {
    return [{ title: firstLine, detail: lines.slice(1).join("\n").trim() }]
  }
  return [{ title: "Thinking", detail: trimmed }]
}

function completionEntry(
  entries: readonly AssistantActivityEntry[],
  durationSeconds: number | undefined,
  status: AssistantTurnRenderStatus | undefined
): AssistantActivityEntry {
  const hasError = entries.some((entry) => entry.status === "error")
  const hasStopped = entries.some((entry) => entry.status === "stopped")
  if (hasError || status === "error" || status === "failed") {
    return {
      id: "completion",
      kind: "completion",
      title: "Run failed",
      detail: "Error",
      status: "error",
    }
  }
  if (hasStopped || status === "aborted") {
    return {
      id: "completion",
      kind: "completion",
      title: "Generation stopped",
      detail: "Stopped",
      status: "stopped",
    }
  }
  return {
    id: "completion",
    kind: "completion",
    title:
      durationSeconds === undefined
        ? "Finished"
        : `Worked for ${formatDuration(durationSeconds)}`,
    detail: "Done",
    status: "complete",
  }
}

/**
 * The single chronological activity derivation. It walks the normalized turn
 * exactly once, updates repeated tool-call states in place, and never buckets
 * entries by type. Streaming therefore enriches existing rows without moving
 * them or duplicating call ids.
 */
export function deriveAssistantActivityModel(
  view: AssistantTurnView,
  phase: AssistantTurnPhase,
  options?: {
    durationMs?: number
    status?: AssistantTurnRenderStatus
  }
): AssistantActivityModel | undefined {
  const entries: AssistantActivityEntry[] = []
  const toolEntryIndexes = new Map<string, number>()
  let latestSearchIndex: number | undefined

  view.orderedParts.forEach((part, partIndex) => {
    if (part.type === "reasoning") {
      reasoningSteps(part.text).forEach((step, stepIndex) => {
        const isPartStreaming =
          phase.kind !== "settled" &&
          (part as { state?: string }).state === "streaming"
        entries.push({
          id: `reasoning-${partIndex}-${stepIndex}`,
          kind: "reasoning",
          title: step.title,
          detail: step.detail,
          status: isPartStreaming ? "running" : "complete",
        })
      })
      return
    }

    if (part.type === "source-url") {
      if (latestSearchIndex === undefined) {
        latestSearchIndex = entries.length
        entries.push({
          id: `search-sources-${partIndex}`,
          kind: "search",
          title: "Searching the web",
          status: phase.kind === "settled" ? "complete" : "running",
          sources: [part],
        })
      } else {
        const searchEntry = entries[latestSearchIndex]
        searchEntry.sources = [...(searchEntry.sources ?? []), part]
      }
      return
    }

    if (!isStaticToolUIPart(part)) return
    const toolName = getStaticToolName(part)
    const label =
      getToolDisplayName(view.metadata, toolName, part.toolCallId) ??
      humanizeToolName(toolName)
    const query = inputQuery("input" in part ? part.input : undefined)
    const kind = isSearchTool(toolName)
      ? "search"
      : isImageTool(toolName)
        ? "image"
        : "tool"
    const status = toolStatus(part, phase)
    const input = "input" in part ? part.input : undefined
    const entry: AssistantActivityEntry = {
      id: `tool-${part.toolCallId}`,
      kind,
      title:
        kind === "search" && query
          ? `Searching for ${query}`
          : toolActionTitle(label, input, status),
      detail: errorDetail(part),
      status,
      tool: toolDetail(part, toolName),
    }
    const existingIndex = toolEntryIndexes.get(part.toolCallId)
    if (existingIndex === undefined) {
      const index = entries.length
      toolEntryIndexes.set(part.toolCallId, index)
      entries.push(entry)
      if (kind === "search") latestSearchIndex = index
    } else {
      entry.sources = entries[existingIndex].sources
      entries[existingIndex] = entry
      if (kind === "search") latestSearchIndex = existingIndex
    }
  })

  const durationSeconds = toCompletedDurationSeconds(
    options?.durationMs ?? view.reasoning.persistedDurationMs
  )
  if (
    entries.length > 0 &&
    (phase.kind === "settled" || phase.kind === "responding")
  ) {
    entries.push(completionEntry(entries, durationSeconds, options?.status))
  }

  const nonEmptyEntries = asNonEmpty(entries)
  if (!nonEmptyEntries) return undefined
  return {
    entries: nonEmptyEntries,
    sourceResults: view.sources,
    imageResults: view.searchImageResults,
  }
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
      if (isSearchTool(toolName)) {
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
  options?: {
    durationMs?: number
    status?: AssistantTurnRenderStatus
  }
): AssistantActivityPresentation {
  const durationMs = options?.durationMs ?? view.reasoning.persistedDurationMs
  const durationSeconds = toCompletedDurationSeconds(durationMs)
  const activity = deriveAssistantActivityModel(view, phase, options)
  const isLive = phase.kind !== "settled" && phase.kind !== "responding"

  if (isLive) {
    const status = resolveLiveStatus(view, phase)
    if (activity) {
      return {
        kind: "disclosure",
        label: status.label,
        motion: status.motion,
        activity,
        durationSeconds,
      }
    }
    return { kind: "live-status", ...status }
  }

  if (phase.kind === "responding" && !activity) return { kind: "none" }

  if (activity) {
    const hasReasoning = activity.entries.some(
      (entry) => entry.kind === "reasoning"
    )
    const label =
      durationSeconds !== undefined
        ? `Worked for ${formatDuration(durationSeconds)}`
        : hasReasoning
          ? "Thought"
          : "Activity"
    return {
      kind: "disclosure",
      label,
      motion: "none",
      activity,
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
