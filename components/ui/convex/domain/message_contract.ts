import { v } from "convex/values"

export const DURABLE_MESSAGE_STATUSES = [
  "submitted",
  "streaming",
  "completed",
  "aborted",
  "failed",
  "awaiting_approval",
] as const

export type DurableMessageStatus =
  (typeof DURABLE_MESSAGE_STATUSES)[number]

export const GENERATION_RUN_STATUSES = [
  "queued",
  "running",
  "streaming",
  "awaiting_approval",
  "completed",
  "aborted",
  "failed",
] as const

export type GenerationRunStatus =
  (typeof GENERATION_RUN_STATUSES)[number]

export const vMessageStatus = v.union(
  v.literal("submitted"),
  v.literal("streaming"),
  v.literal("completed"),
  v.literal("aborted"),
  v.literal("failed"),
  v.literal("awaiting_approval")
)

export const vGenerationRunStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("streaming"),
  v.literal("awaiting_approval"),
  v.literal("completed"),
  v.literal("aborted"),
  v.literal("failed")
)

const terminalMessageStatuses = new Set<unknown>([
  "completed",
  "aborted",
  "failed",
])

const terminalGenerationRunStatuses = new Set<unknown>([
  "completed",
  "aborted",
  "failed",
])

const activeGenerationRunStatuses = new Set<unknown>([
  "queued",
  "running",
  "streaming",
  "awaiting_approval",
])

export function isTerminalMessageStatus(status: unknown): boolean {
  return terminalMessageStatuses.has(status)
}

export function isTerminalGenerationRunStatus(status: unknown): boolean {
  return terminalGenerationRunStatuses.has(status)
}

export function isActiveGenerationRunStatus(status: unknown): boolean {
  return activeGenerationRunStatuses.has(status)
}

export function isAwaitingApprovalStatus(status: unknown): boolean {
  return status === "awaiting_approval"
}
