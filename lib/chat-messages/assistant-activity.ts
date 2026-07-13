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
import {
  classifyToolName,
  deriveTurnEvidence,
  resolveEntryStatus,
  type ResolvedEntryStatus,
  type ToolCallEvidence,
  type ToolLifecycle,
} from "./turn-evidence"

export type NonEmptyTuple<T> = readonly [T, ...T[]]

export type ActivityEntryStatus = ResolvedEntryStatus

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
  sources?: readonly AssistantSourceResult[]
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

function toolDetail(item: ToolCallEvidence): AssistantActivityToolDetail {
  const { lifecycle } = item
  return {
    toolName: item.toolName,
    displayName: humanizeToolName(item.toolName),
    code: toolCode(item.input),
    approvalId:
      lifecycle.kind === "awaiting-approval" ? lifecycle.approvalId : undefined,
    approvalReason:
      lifecycle.kind === "denied" && lifecycle.via === "output-denied"
        ? lifecycle.reason
        : undefined,
    approved:
      lifecycle.kind === "in-flight" && lifecycle.via === "approval-approved"
        ? true
        : lifecycle.kind === "denied" && lifecycle.via === "approval-responded"
          ? false
          : undefined,
  }
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
  if (status === "denied") return `${label} denied`
  if (status === "stopped") return `${label} stopped`
  return status === "running" ? `Using ${label}` : `Used ${label}`
}

/** Fallback copy over lifecycle facts — English stays out of the evidence. */
function errorDetail(lifecycle: ToolLifecycle): string | undefined {
  if (lifecycle.kind === "errored") {
    return lifecycle.via === "output-error"
      ? lifecycle.message || "Tool failed"
      : "Tool reported an error"
  }
  if (lifecycle.kind === "denied") {
    return lifecycle.reason || "Approval denied"
  }
  return undefined
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
  const hasError = entries.some(
    (entry) => entry.status === "error" || entry.status === "denied"
  )
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
 * The single chronological activity derivation: a presentation mapping over
 * the Turn evidence timeline. Chronology, stable call-id identity, and source
 * attribution are the evidence walk's invariants; this function owns only
 * copy (titles, details, markers' status vocabulary) and the completion row.
 */
export function deriveAssistantActivityModel(
  view: AssistantTurnView,
  phase: AssistantTurnPhase,
  options?: {
    durationMs?: number
    status?: AssistantTurnRenderStatus
  }
): AssistantActivityModel | undefined {
  const settled = phase.kind === "settled"
  const evidence = deriveTurnEvidence(view.orderedParts)
  const entries: AssistantActivityEntry[] = []

  for (const item of evidence.timeline) {
    if (item.kind === "reasoning") {
      const status = resolveEntryStatus(item, settled)
      reasoningSteps(item.text).forEach((step, stepIndex) => {
        entries.push({
          id: `reasoning-${item.partIndex}-${stepIndex}`,
          kind: "reasoning",
          title: step.title,
          detail: step.detail,
          status,
        })
      })
      continue
    }

    if (item.kind === "implied-search") {
      entries.push({
        id: item.id,
        kind: "search",
        title: "Searching the web",
        status: resolveEntryStatus(item, settled),
        sources: item.sources,
      })
      continue
    }

    const status = resolveEntryStatus(item, settled)
    const label =
      getToolDisplayName(view.metadata, item.toolName, item.toolCallId) ??
      humanizeToolName(item.toolName)
    const kind =
      item.classification === "search"
        ? "search"
        : item.classification === "image-generation"
          ? "image"
          : "tool"
    entries.push({
      id: item.id,
      kind,
      title:
        kind === "search" && item.searchQuery
          ? `Searching for ${item.searchQuery}`
          : toolActionTitle(label, item.input, status),
      detail: errorDetail(item.lifecycle),
      status,
      tool: toolDetail(item),
      sources: kind === "search" ? item.sources : undefined,
    })
  }

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
      if (classifyToolName(toolName) === "search") {
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
