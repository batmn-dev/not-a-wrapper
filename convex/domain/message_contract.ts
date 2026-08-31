import { v } from "convex/values"
import {
  DURABLE_MESSAGE_STATUSES,
  GENERATION_RUN_STATUSES,
} from "./message_facts"

export {
  DURABLE_MESSAGE_STATUSES,
  GENERATION_RUN_STATUSES,
  isActiveGenerationRunStatus,
  isAwaitingApprovalStatus,
  isTerminalGenerationRunStatus,
  isTerminalMessageStatus,
  type DurableMessageStatus,
  type GenerationRunStatus,
} from "./message_facts"

export const vMessageStatus = v.union(
  ...DURABLE_MESSAGE_STATUSES.map((status) => v.literal(status))
)

export const vGenerationRunStatus = v.union(
  ...GENERATION_RUN_STATUSES.map((status) => v.literal(status))
)
