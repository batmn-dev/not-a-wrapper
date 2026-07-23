/**
 * Streaming code rendering mode (chat-responsiveness plan, PR 3).
 *
 * `NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE` selects how the TERMINAL, still-
 * growing code block of a live message renders in `CodeBlockCode`:
 *
 * - `legacy` (default): the pre-PR-3 behavior — a full Shiki highlight for
 *   every (code, language, theme) change, growing or not. The rollback path.
 * - `throttled-highlight`: the growing block keeps its highlighted look but
 *   re-highlights at most once per `GROWING_HIGHLIGHT_THROTTLE_MS`; stale
 *   async completions are invalidated by generation token.
 * - `plain-while-growing`: the growing block renders as escaped React text;
 *   an inactivity debounce (`GROWING_HIGHLIGHT_DEBOUNCE_MS`) highlights it if
 *   deltas pause, and any later delta immediately returns it to plain.
 *
 * Settled, non-terminal, and non-live blocks highlight normally in every
 * mode. The stability classification itself (terminal block + live message)
 * lives in `components/ui/markdown.tsx`; this module owns only the flag seam
 * and the measurement constants.
 *
 * Seam contract (docs/chat-performance-rollout-seam.md): build-time env flag,
 * redeploy to change, resolved once per mount by consumers.
 */

export type StreamingCodeRenderMode =
  | "legacy"
  | "throttled-highlight"
  | "plain-while-growing"

/**
 * Re-highlight interval for `throttled-highlight`. A named constant for
 * measurement comparability — deliberately not a public product setting
 * (plan PR 3 flag note).
 */
export const GROWING_HIGHLIGHT_THROTTLE_MS = 300

/** Inactivity debounce for `plain-while-growing` (initial experimental value). */
export const GROWING_HIGHLIGHT_DEBOUNCE_MS = 150

/** Unknown or invalid flag values fail safe to `legacy`. */
export function resolveStreamingCodeRenderMode(
  raw: string | undefined = process.env.NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE
): StreamingCodeRenderMode {
  return raw === "throttled-highlight" || raw === "plain-while-growing"
    ? raw
    : "legacy"
}

/**
 * Language ids Shiki treats as the built-in plain language; they need no
 * grammar and never load. Everything else must be a loaded language (aliases
 * included — `getLoadedLanguages()` registers them) or it normalizes to
 * `text`, replacing the legacy path's exception-driven fallback.
 */
const PLAIN_LANGUAGE_IDS = new Set(["", "plain", "plaintext", "text", "txt"])

export function normalizeShikiLanguage(
  language: string | undefined,
  loadedLanguages: readonly string[]
): string {
  const candidate = (language ?? "").trim().toLowerCase()
  if (PLAIN_LANGUAGE_IDS.has(candidate)) return "text"
  return loadedLanguages.includes(candidate) ? candidate : "text"
}
