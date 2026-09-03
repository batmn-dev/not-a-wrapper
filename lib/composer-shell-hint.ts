import {
  isLogicalModelId,
  resolveLogicalModelEffortLevels,
  resolveModelSelection,
} from "@/lib/models/catalog"
import {
  isModelReasoningEffort,
  type ModelReasoningEffort,
} from "@/lib/models/types"

/**
 * Composer shell hint (ADR-0032): a cookie mirror of the device memory the
 * new-chat Composer resolves from — the last-used model and that model's
 * stored effort — so the server-rendered shell paints the saved selection on
 * first paint instead of the tier default. localStorage stays the source of
 * truth; the cookie is written at the two device-memory writers
 * (`ModelProvider.setLastUsedModel`, Turn context `setReasoningEffort`) and
 * re-synced after hydration only when the live memory drifted from it.
 *
 * The value is untrusted request input: `parseComposerShellHint` validates
 * against the catalog and the effort union, so a stale or forged cookie can
 * never paint an invalid label. Selectability for the auth state is the
 * resolver's job (`resolvePreferredModelId`), the same as for localStorage.
 */

export const COMPOSER_SHELL_HINT_COOKIE = "composer_shell"
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export type ComposerShellHint = {
  /** Logical model id (ADR-0020): the device's last-used model. */
  modelId: string
  /** The stored per-model effort for that model; absent = Default. */
  effort?: ModelReasoningEffort
}

export function parseComposerShellHint(
  raw: string | undefined
): ComposerShellHint | null {
  if (!raw) return null
  let parsed: unknown
  try {
    // `next/headers` hands the value back URL-decoded; `document.cookie` does
    // not. Either way the JSON starts with a brace once decoded.
    parsed = JSON.parse(raw.startsWith("{") ? raw : decodeURIComponent(raw))
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const { m, e } = parsed as { m?: unknown; e?: unknown }
  if (typeof m !== "string") return null
  const modelId = resolveModelSelection(m).modelId
  if (!isLogicalModelId(modelId)) return null
  const levels = resolveLogicalModelEffortLevels(modelId) ?? []
  return isModelReasoningEffort(e) && levels.includes(e)
    ? { modelId, effort: e }
    : { modelId }
}

export function serializeComposerShellHint(hint: ComposerShellHint): string {
  return encodeURIComponent(
    JSON.stringify({
      m: hint.modelId,
      ...(hint.effort === undefined ? {} : { e: hint.effort }),
    })
  )
}

/** Client-side mirror write; `null` clears the cookie. */
export function writeComposerShellHintCookie(
  hint: ComposerShellHint | null
): void {
  if (typeof document === "undefined") return
  const value = hint ? serializeComposerShellHint(hint) : ""
  const maxAge = hint ? MAX_AGE_SECONDS : 0
  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${COMPOSER_SHELL_HINT_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`
}
