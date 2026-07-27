/**
 * Streaming code rendering (chat-responsiveness plan, PR 3).
 *
 * The TERMINAL, still-growing code block of a live message keeps its
 * highlighted look but re-highlights at most once per
 * `GROWING_HIGHLIGHT_THROTTLE_MS` (leading edge immediately, then trailing);
 * settled, non-terminal, and non-live blocks highlight immediately. Stale
 * async completions are invalidated by generation token in
 * `components/ui/code-block.tsx`; the stability classification (terminal
 * block of a streaming message) lives in `components/ui/markdown.tsx`.
 *
 * This is the sole behavior since the 2026-07-23 pre-launch flag collapse.
 * The former `NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE` flag and its other two
 * modes were removed after verification: `legacy` (full re-highlight per
 * delta) froze and crashed tabs on large code streams, and
 * `plain-while-growing` lost the variant bake-off on ChatGPT-fidelity
 * (docs/measurements/2026-07-23-pr3-streaming-code-decision.md,
 * 2026-07-23-pr2-pr3-verification.md,
 * 2026-07-23-section6-freeze-rootcause.md). Note the throttled highlight only
 * bounds Shiki work — the per-delta React commit cost is bounded by the
 * message throttle (`lib/chat-performance/message-throttle.ts`); the
 * mode-only cell without it froze like legacy
 * (2026-07-23-perf-followup-measurements.md §3).
 */

/**
 * Re-highlight interval for the growing terminal block. A named constant for
 * measurement comparability — deliberately not a public product setting.
 *
 * Language normalization moved to `lib/markdown/shiki-client.ts`
 * (`resolveShikiLanguage`): with demand-loaded grammars (streaming plan
 * PR C) the support surface is the static allowlist, not whatever the old
 * eager highlighter happened to have loaded.
 */
export const GROWING_HIGHLIGHT_THROTTLE_MS = 300
