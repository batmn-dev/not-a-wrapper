import { v, type Infer } from "convex/values"

/**
 * Reasoning-effort vocabulary mirror (ADR-0026). Convex code keeps its own
 * literal copy of `REASONING_EFFORT_LEVELS` (lib/models/types.ts) so the
 * deployment stays self-contained; the bidirectional metadata type assertion
 * in lib/chat-messages/metadata.test.ts keeps the copies in lockstep.
 */
export const vReasoningEffort = v.union(
  v.literal("none"),
  v.literal("minimal"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("xhigh"),
  v.literal("max")
)

export type PersistedReasoningEffort = Infer<typeof vReasoningEffort>

/** Runtime membership check for the same vocabulary (metadata projection). */
export const REASONING_EFFORTS: ReadonlySet<string> = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] satisfies PersistedReasoningEffort[])
