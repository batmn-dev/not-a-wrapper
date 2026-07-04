import type { UIMessage } from "ai"

export type AdaptationContext = {
  targetModelId: string
  hasTools: boolean
  sourceProviderHint?: string
  maxHistoryTokens?: number
}

export type AdaptationWarningCode =
  | "incomplete_triple_dropped"
  | "provider_ids_stripped"
  | "empty_message_fallback"
  | "non_final_state_dropped"
  | "role_alternation_repaired"
  | "thought_signature_injected"
  | "replay_normalization_warning"
  | "replay_compile_warning"
  | "replay_compile_fallback"

export type AdaptationWarning = {
  code: AdaptationWarningCode
  messageIndex: number
  detail: string
}

export type AdaptationStats = {
  originalMessageCount: number
  adaptedMessageCount: number
  droppedMessages: number
  partsDropped: Record<string, number>
  partsTransformed: Record<string, number>
  partsPreserved: Record<string, number>
  totalPartsOriginal: number
  totalPartsAdapted: number
  providerIdsStripped: number
}

export type AdaptationResult = {
  messages: UIMessage[]
  stats: AdaptationStats
  warnings: AdaptationWarning[]
}

/**
 * Contract for provider-specific history adaptation.
 *
 * Adapters transform canonical `UIMessage[]` history into a replay-safe shape
 * for a target provider.
 *
 * Requirements:
 * - Pure functions only (no side effects, no network calls)
 * - Idempotent (applying twice yields the same result)
 * - MUST NOT mutate input (readonly `messages` parameter)
 * - MUST drop non-final tool states via `isToolPartFinal()` before
 *   applying provider-specific logic
 *
 * Complexity tiers:
 * - `simple`: TextOnly, Default
 * - `standard`: Anthropic, OpenAICompatible
 * - `complex`: OpenAI
 * - `structural`: Google
 */
export type ProviderHistoryAdapter = {
  readonly providerId: string
  adaptMessages(
    messages: readonly UIMessage[],
    context: AdaptationContext
  ): Promise<AdaptationResult>
  readonly metadata: {
    droppedPartTypes: ReadonlySet<string>
    transformedPartTypes: ReadonlySet<string>
    tier: "simple" | "standard" | "complex" | "structural"
    description: string
  }
}

export type AdapterRegistry = Map<string, ProviderHistoryAdapter>

const FINAL_TOOL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
])

export function isToolPartFinal(part: { state?: string }): boolean {
  return part.state == null || FINAL_TOOL_STATES.has(part.state)
}

export function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool"
}

export function createEmptyStats(
  originalMessageCount: number,
  totalPartsOriginal: number
): AdaptationStats {
  return {
    originalMessageCount,
    adaptedMessageCount: 0,
    droppedMessages: 0,
    partsDropped: {},
    partsTransformed: {},
    partsPreserved: {},
    totalPartsOriginal,
    totalPartsAdapted: 0,
    providerIdsStripped: 0,
  }
}

export function incrementStat(
  record: Record<string, number>,
  key: string,
  amount = 1
): void {
  record[key] = (record[key] ?? 0) + amount
}

export function detectSourceProvider(part: {
  callProviderMetadata?: Record<string, unknown>
}): string | null {
  if (!part.callProviderMetadata) return null
  const [firstKey] = Object.keys(part.callProviderMetadata)
  return firstKey ?? null
}

export function stripCallProviderMetadata<T>(part: T): T {
  if (!part || typeof part !== "object") return part
  const maybePart = part as Record<string, unknown>
  if (!("callProviderMetadata" in maybePart)) return part
  const { callProviderMetadata: _callProviderMetadata, ...rest } = maybePart
  return rest as T
}
