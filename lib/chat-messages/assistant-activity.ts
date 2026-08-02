import { formatDuration, toCompletedDurationSeconds } from "../format-duration"
import { humanizeToolName } from "../tools/ui-metadata"
import type {
  AssistantTurnPhase,
  AssistantTurnRenderStatus,
  AssistantTurnView,
  SearchImageResult,
} from "./assistant-turn"
import { parseSafeExternalUrl } from "../url-safety"
import { getToolDisplayName } from "./metadata"
import { dedupeSources, type AssistantSourceResult } from "./sources"
import {
  classifyToolName,
  deriveTurnEvidence,
  resolveEntryStatus,
  type ResolvedEntryStatus,
  type ToolCallEvidence,
  type ToolLifecycle,
  type WebActivityAction,
} from "./turn-evidence"

export type NonEmptyTuple<T> = readonly [T, ...T[]]

export type ActivityEntryStatus = ResolvedEntryStatus

/**
 * The entry algebra is closed: one variant per timeline row shape, each
 * carrying exactly the fields the Activity panel renders for it and exactly
 * the statuses its Turn evidence arm can resolve to. Illegal rows — a
 * reasoning step with an approval marker, a tool card without its detail, an
 * approval row without the id its buttons need — are unrepresentable.
 */
export type AssistantActivityToolDetail = {
  toolName: string
  displayName: string
  code?: string
}

type ActivityEntryBase = {
  /** Stable across streaming updates: part index for reasoning, call id for tools. */
  id: string
  title: string
}

/** The only variant whose detail renders as Markdown. */
export type AssistantActivityReasoningEntry = ActivityEntryBase & {
  kind: "reasoning"
  status: "running" | "complete"
  detail?: string
}

/**
 * Tool-backed and implied searches share one presentation variant — the
 * panel renders them identically. An implied search only ever constructs
 * running|complete; a search awaiting approval renders its marker but no
 * actions (approval controls live on the tool variant only).
 */
export type AssistantActivitySearchEntry = ActivityEntryBase & {
  kind: "search"
  status: ActivityEntryStatus
  detail?: string
  /** Sources remain attached to the search step that produced them. */
  sources: readonly AssistantSourceResult[]
}

export type AssistantActivityImageEntry = ActivityEntryBase & {
  kind: "image"
  status: ActivityEntryStatus
  detail?: string
}

/**
 * The only variant that renders the tool card. Discriminated a second time
 * on status: an approval row must carry the approvalId its Approve/Deny
 * buttons submit; every other status cannot carry one.
 */
export type AssistantActivityToolEntry = ActivityEntryBase & {
  kind: "tool"
  detail?: string
} & (
    | {
        status: "approval"
        tool: AssistantActivityToolDetail & { approvalId: string }
      }
    | {
        status: Exclude<ActivityEntryStatus, "approval">
        tool: AssistantActivityToolDetail & { approvalId?: undefined }
      }
  )

/** Chronological evidence rows — the completion row is not a member. */
export type AssistantActivityTimelineEntry =
  | AssistantActivityReasoningEntry
  | AssistantActivitySearchEntry
  | AssistantActivityImageEntry
  | AssistantActivityToolEntry

/** The terminal row: at most one per model, structurally last. */
export type AssistantActivityCompletion = {
  kind: "completion"
  id: "completion"
  status: "complete" | "error" | "stopped"
  title: string
  detail: string
}

/** What a single Activity panel row can receive. */
export type AssistantActivityEntry =
  | AssistantActivityTimelineEntry
  | AssistantActivityCompletion

export type AssistantActivityModel = {
  entries: NonEmptyTuple<AssistantActivityTimelineEntry>
  /**
   * Present exactly when the run has an outcome to report. Uniqueness, last
   * position, and never-without-evidence are structural, not conventions.
   */
  completion?: AssistantActivityCompletion
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
  return {
    toolName: item.toolName,
    displayName: humanizeToolName(item.toolName),
    code: toolCode(item.input),
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

function browsedDomain(url: string): string {
  return parseSafeExternalUrl(url)?.hostname ?? url
}

/**
 * The page a browse action visited, presented through the same chip idiom as
 * search sources. Fabricated at presentation — the evidence keeps action
 * facts and citation sources distinct.
 */
function browsedPageSource(url: string): AssistantSourceResult {
  return {
    type: "source-url",
    sourceId: url,
    url,
    title: browsedDomain(url),
  }
}

type BrowseAction = Extract<
  WebActivityAction,
  { kind: "opened-page" | "found-in-page" }
>

/**
 * Browse-row copy is a local product decision pending a settled ChatGPT
 * exemplar (see research/chatgpt-activity-timeline-2026-07-12.md): the
 * reference's live idiom is "Reading {domain}", and its settled panels never
 * show a bare generic tool row.
 */
function browseTitle(action: BrowseAction, status: ActivityEntryStatus): string {
  const domain = browsedDomain(action.url)
  return status === "running" ? `Reading ${domain}` : `Read ${domain}`
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

function deriveCompletion(
  entries: readonly AssistantActivityTimelineEntry[],
  durationSeconds: number | undefined,
  status: AssistantTurnRenderStatus | undefined
): AssistantActivityCompletion {
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
  const hasNonReasoningActivity = entries.some(
    (entry) => entry.kind !== "reasoning"
  )
  return {
    id: "completion",
    kind: "completion",
    title:
      durationSeconds === undefined
        ? "Finished"
        : durationSeconds < 1
          ? hasNonReasoningActivity
            ? "Finished"
            : "Thought"
          : hasNonReasoningActivity
          ? `Worked for ${formatDuration(durationSeconds)}`
          : `Thought for ${formatDuration(durationSeconds)}`,
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
    workDurationMs?: number
    reasoningDurationMs?: number
    status?: AssistantTurnRenderStatus
  }
): AssistantActivityModel | undefined {
  const settled = phase.kind === "settled"
  const evidence = deriveTurnEvidence(view.orderedParts)
  const entries: AssistantActivityTimelineEntry[] = []

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
    if (item.classification === "search") {
      const activity = item.webActivity
      if (
        activity &&
        (activity.kind === "opened-page" || activity.kind === "found-in-page")
      ) {
        entries.push({
          id: item.id,
          kind: "search",
          title: browseTitle(activity, status),
          detail:
            errorDetail(item.lifecycle) ??
            (activity.kind === "found-in-page" && activity.pattern
              ? `Finding “${activity.pattern}”`
              : undefined),
          status,
          sources: dedupeSources([
            browsedPageSource(activity.url),
            ...item.sources,
          ]),
        })
        continue
      }
      const query = activity?.kind === "searched" ? activity.query : undefined
      entries.push({
        id: item.id,
        kind: "search",
        title: query
          ? `Searching for ${query}`
          : toolActionTitle(label, item.input, status),
        detail: errorDetail(item.lifecycle),
        status,
        sources: item.sources,
      })
      continue
    }
    if (item.classification === "image-generation") {
      entries.push({
        id: item.id,
        kind: "image",
        title:
          status === "running"
            ? (inputAction(item.input) ?? "Generating image")
            : toolActionTitle(label, item.input, status),
        detail: errorDetail(item.lifecycle),
        status,
      })
      continue
    }
    if (item.lifecycle.kind === "awaiting-approval" && status === "approval") {
      entries.push({
        id: item.id,
        kind: "tool",
        title: toolActionTitle(label, item.input, "approval"),
        detail: errorDetail(item.lifecycle),
        status: "approval",
        tool: { ...toolDetail(item), approvalId: item.lifecycle.approvalId },
      })
      continue
    }
    entries.push({
      id: item.id,
      kind: "tool",
      title: toolActionTitle(label, item.input, status),
      detail: errorDetail(item.lifecycle),
      // Safe: live awaiting-approval is the only lifecycle resolveEntryStatus
      // maps to "approval", and that arm was handled above. Settled approval
      // requests resolve to "stopped" and intentionally carry no approval id.
      status: status as Exclude<ActivityEntryStatus, "approval">,
      tool: toolDetail(item),
    })
  }

  const nonEmptyEntries = asNonEmpty(entries)
  if (!nonEmptyEntries) return undefined

  const hasNonReasoningActivity = nonEmptyEntries.some(
    (entry) => entry.kind !== "reasoning"
  )
  const durationSeconds = toCompletedDurationSeconds(
    hasNonReasoningActivity
      ? (options?.workDurationMs ?? view.persistedWorkDurationMs)
      : (options?.reasoningDurationMs ?? view.reasoning.persistedDurationMs)
  )
  const completion =
    phase.kind === "settled" || phase.kind === "responding"
      ? deriveCompletion(nonEmptyEntries, durationSeconds, options?.status)
      : undefined

  return {
    entries: nonEmptyEntries,
    completion,
    sourceResults: view.sources,
    imageResults: view.searchImageResults,
  }
}

function resolveLiveStatus(
  view: AssistantTurnView,
  phase: AssistantTurnPhase,
  activity: AssistantActivityModel | undefined
): Omit<
  Extract<AssistantActivityPresentation, { kind: "live-status" }>,
  "kind"
> {
  const active = activity?.entries.findLast(
    (entry) => entry.status === "running" || entry.status === "approval"
  )
  if (active) {
    if (active.status === "approval") {
      return {
        semanticKind: "approval",
        label: active.title,
        motion: "none",
      }
    }
    return {
      semanticKind: active.kind === "reasoning" ? "thinking" : active.kind,
      label: active.title,
      motion: "shimmer",
    }
  }

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
  return durationSeconds === undefined || durationSeconds < 1
    ? "Thought"
    : `Thought for ${formatDuration(durationSeconds)}`
}

export function deriveAssistantActivityPresentation(
  view: AssistantTurnView,
  phase: AssistantTurnPhase,
  options?: {
    workDurationMs?: number
    reasoningDurationMs?: number
    status?: AssistantTurnRenderStatus
  }
): AssistantActivityPresentation {
  const activity = deriveAssistantActivityModel(view, phase, options)
  const isLive = phase.kind !== "settled" && phase.kind !== "responding"
  const hasNonReasoningActivity = activity?.entries.some(
    (entry) => entry.kind !== "reasoning"
  )
  const durationSeconds = toCompletedDurationSeconds(
    isLive || hasNonReasoningActivity
      ? (options?.workDurationMs ?? view.persistedWorkDurationMs)
      : (options?.reasoningDurationMs ?? view.reasoning.persistedDurationMs)
  )
  const displayDurationSeconds =
    durationSeconds !== undefined && durationSeconds > 0
      ? durationSeconds
      : undefined

  if (isLive) {
    const status = resolveLiveStatus(view, phase, activity)
    if (activity) {
      return {
        kind: "disclosure",
        label: status.label,
        motion: status.motion,
        activity,
        durationSeconds: displayDurationSeconds,
      }
    }
    return { kind: "live-status", ...status }
  }

  if (phase.kind === "responding" && !activity) return { kind: "none" }

  if (activity) {
    const hasReasoning = activity.entries.some((entry) => entry.kind === "reasoning")
    const label =
      displayDurationSeconds !== undefined
        ? hasNonReasoningActivity
          ? `Worked for ${formatDuration(displayDurationSeconds)}`
          : `Thought for ${formatDuration(displayDurationSeconds)}`
        : durationSeconds === 0 && hasNonReasoningActivity
          ? "Activity"
          : hasReasoning
            ? "Thought"
            : "Activity"
    return {
      kind: "disclosure",
      label,
      motion: "none",
      activity,
      durationSeconds: displayDurationSeconds,
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
