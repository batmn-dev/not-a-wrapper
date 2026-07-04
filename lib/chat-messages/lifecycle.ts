import {
  isDurableMessageStatus,
  isGenerationStatus,
  type DurableMessageStatus,
  type GenerationStatus,
} from "./durable-contract"

const terminalMessageStatuses = new Set<DurableMessageStatus>([
  "completed",
  "aborted",
  "failed",
])

const terminalGenerationStatuses = new Set<GenerationStatus>([
  "completed",
  "aborted",
  "failed",
])

const activeGenerationStatuses = new Set<GenerationStatus>([
  "queued",
  "running",
  "streaming",
  "awaiting_approval",
])

export function isTerminalMessageStatus(status: unknown): boolean {
  return isDurableMessageStatus(status) && terminalMessageStatuses.has(status)
}

export function isTerminalGenerationStatus(status: unknown): boolean {
  return isGenerationStatus(status) && terminalGenerationStatuses.has(status)
}

export function isActiveGenerationStatus(status: unknown): boolean {
  return isGenerationStatus(status) && activeGenerationStatuses.has(status)
}

export function isAwaitingApprovalStatus(status: unknown): boolean {
  return status === "awaiting_approval"
}
