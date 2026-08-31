import type { UIMessage } from "ai"

export type AdaptationContext = {
  /** Logical model identity used for model-specific replay behavior. */
  targetModelId: string
  /** Resolved execution route used to identify wrapped providers. */
  targetRouteId?: string
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

type AdaptationSession = Pick<AdaptationResult, "stats" | "warnings">

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
 * - Adapters that preserve Tool parts MUST route non-final states through
 *   `dropNonFinalToolPart()` before applying provider-specific logic
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

type HistoryAdapterDefinition = Omit<
  ProviderHistoryAdapter,
  "adaptMessages"
> & {
  adaptMessages(
    messages: readonly UIMessage[],
    context: AdaptationContext,
    session: AdaptationSession
  ): Promise<UIMessage[]>
}

export type AdapterRegistry = Map<string, ProviderHistoryAdapter>

const FINAL_TOOL_STATES = new Set<string>([
  "output-available",
  "output-error",
  "output-denied",
])

function isToolPartFinal(part: { state?: unknown }): boolean {
  return (
    part.state == null ||
    (typeof part.state === "string" && FINAL_TOOL_STATES.has(part.state))
  )
}

export function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool"
}

function countParts(messages: readonly UIMessage[]): number {
  return messages.reduce((sum, message) => sum + message.parts.length, 0)
}

function beginAdaptation(messages: readonly UIMessage[]): AdaptationSession {
  return {
    stats: {
      originalMessageCount: messages.length,
      adaptedMessageCount: 0,
      droppedMessages: 0,
      partsDropped: {},
      partsTransformed: {},
      partsPreserved: {},
      totalPartsOriginal: countParts(messages),
      totalPartsAdapted: 0,
      providerIdsStripped: 0,
    },
    warnings: [],
  }
}

function finishAdaptation(
  messages: UIMessage[],
  session: AdaptationSession
): AdaptationResult {
  const { stats, warnings } = session
  stats.adaptedMessageCount = messages.length
  stats.droppedMessages = Math.max(
    stats.droppedMessages,
    stats.originalMessageCount - stats.adaptedMessageCount
  )
  stats.totalPartsAdapted = countParts(messages)
  return { messages, stats, warnings }
}

export function defineHistoryAdapter({
  adaptMessages,
  ...definition
}: HistoryAdapterDefinition): ProviderHistoryAdapter {
  return {
    ...definition,
    async adaptMessages(messages, context) {
      const session = beginAdaptation(messages)
      const adapted = await adaptMessages(messages, context, session)
      return finishAdaptation(adapted, session)
    },
  }
}

export function incrementStat(
  record: Record<string, number>,
  key: string,
  amount = 1
): void {
  record[key] = (record[key] ?? 0) + amount
}

export function dropNonFinalToolPart(
  part: { type: string; state?: unknown },
  messageIndex: number,
  session: AdaptationSession
): boolean {
  if (!isToolPart(part) || isToolPartFinal(part)) return false

  incrementStat(session.stats.partsDropped, part.type)
  session.warnings.push({
    code: "non_final_state_dropped",
    messageIndex,
    detail: `Dropped non-final tool state "${String(part.state ?? "unknown")}" (${part.type})`,
  })
  return true
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
