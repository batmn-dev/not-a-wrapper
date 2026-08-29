/**
 * Streaming code rendering.
 *
 * The TERMINAL, still-growing code block of a live message renders every
 * canonical code change immediately as escaped plain code. Shiki runs only
 * after `GROWING_HIGHLIGHT_IDLE_MS` without another tuple change; settled,
 * non-terminal, and non-live blocks highlight immediately. Completed
 * highlights are associated with their exact code/language/theme tuple so
 * stale HTML is never shown for newer canonical code. The stability
 * classification (terminal block of a streaming message) lives in
 * `components/ui/markdown.tsx`.
 * The frame-aligned message subscription separately bounds React commit work.
 */

/**
 * Inactivity boundary for the growing terminal block. Every code, language,
 * or theme change restarts this timer. This is a measurement constant, not a
 * public product setting. Language support comes from
 * `resolveShikiLanguage`'s static allowlist (ADR-0016).
 */
export const GROWING_HIGHLIGHT_IDLE_MS = 150
