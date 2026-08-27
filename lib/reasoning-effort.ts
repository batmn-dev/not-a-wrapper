import type { ModelReasoningEffort } from "@/lib/models/types"
import { isModelReasoningEffort } from "@/lib/models/types"

/**
 * Per-turn reasoning effort — client presentation and memory (ADR-0026).
 * Labels are the honest provider-level names (not invented tiers); the
 * per-model memory mirrors `lastUsedModel`: device-local, keyed by logical
 * model id, written on explicit selection.
 */

export const REASONING_EFFORT_LABELS: Record<ModelReasoningEffort, string> = {
  none: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
}

/**
 * Kill switch for the composer effort control. Enabled unless explicitly
 * disabled — per-model visibility stays catalog-driven (`effortLevels`),
 * keeping rollout gating and capability gating separate concerns.
 */
export function isReasoningEffortControlEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REASONING_EFFORT_CONTROL !== "false"
}

const STORAGE_KEY = "lastUsedEffortByModel"

function readStoredEffortMap(): Record<string, ModelReasoningEffort> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return {}
    const map: Record<string, ModelReasoningEffort> = {}
    for (const [modelId, effort] of Object.entries(parsed)) {
      if (isModelReasoningEffort(effort)) map[modelId] = effort
    }
    return map
  } catch {
    return {}
  }
}

/** Read the last effort the user chose for this model on this device. */
export function readStoredEffortForModel(
  modelId: string
): ModelReasoningEffort | undefined {
  if (typeof window === "undefined") return undefined
  return readStoredEffortMap()[modelId]
}

/**
 * Subscription half of the `useSyncExternalStore` pair over the stored map.
 * The 'storage' event only fires in OTHER tabs; same-tab writes re-render
 * through the selection state that accompanies them, and the read half
 * re-reads on every render.
 */
export function subscribeToStoredEffort(onChange: () => void): () => void {
  window.addEventListener("storage", onChange)
  return () => window.removeEventListener("storage", onChange)
}

/** Persist an explicit selection; explicit Default (undefined) clears it. */
export function writeStoredEffortForModel(
  modelId: string,
  effort: ModelReasoningEffort | undefined
): void {
  if (typeof window === "undefined") return
  try {
    const map = readStoredEffortMap()
    if (effort === undefined) delete map[modelId]
    else map[modelId] = effort
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Storage unavailable (private mode, quota): selection stays session-only.
  }
}
