export const DURABLE_MESSAGE_STATUSES = [
  "submitted",
  "streaming",
  "completed",
  "aborted",
  "failed",
  "awaiting_approval",
] as const

export type DurableMessageStatus = (typeof DURABLE_MESSAGE_STATUSES)[number]

// Convex generation runs currently distinguish pre-stream setup from active
// streaming with queued/running states. There is no stored "pending" run state.
export const GENERATION_STATUSES = [
  "queued",
  "running",
  "streaming",
  "awaiting_approval",
  "completed",
  "aborted",
  "failed",
] as const

export type GenerationStatus = (typeof GENERATION_STATUSES)[number]

const durableMessageStatusSet = new Set<unknown>(DURABLE_MESSAGE_STATUSES)
const generationStatusSet = new Set<unknown>(GENERATION_STATUSES)

export function isDurableMessageStatus(
  value: unknown
): value is DurableMessageStatus {
  return durableMessageStatusSet.has(value)
}

export function isGenerationStatus(value: unknown): value is GenerationStatus {
  return generationStatusSet.has(value)
}
