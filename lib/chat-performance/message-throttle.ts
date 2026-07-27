/**
 * AI SDK message-notification throttle (chat-responsiveness plan PR 2;
 * re-selected by the streaming plan PR D after the renderer rework).
 *
 * Passed verbatim to `useChat({ chat, throttle })`. The installed
 * `@ai-sdk/react@4.0.23` applies it to the messages callback only (leading +
 * trailing via throttleit); status and error subscriptions stay immediate, so
 * approval/tool/terminal updates are never delayed by it, and the trailing
 * notification guarantees the final message state is always delivered.
 *
 * 32 ms (was 50 ms) — re-measured 2026-07-27 after incremental Markdown
 * projection (PR B) and lazy Shiki (PR C) made per-notification commit cost
 * track the mutable tail (~1–3 ms at every accumulated size) instead of the
 * full response. On the deterministic 100 chunks/s replay
 * (benchmarks/chat-performance/cadence-selection.test.tsx, table in
 * docs/measurements/2026-07-27-streaming-renderer-results.md): 32 ms costs
 * 3.8% of stream time vs 3.3% at 50 ms while delivering ~2× finer visible
 * text granularity; unthrottled measured 11% — viable on fast hardware but
 * without 4× CPU headroom, so the throttle stays. The value is deliberately
 * a code constant, not a flag: the 2026-07-23 flag collapse removed the
 * runtime override after the old `0` rollback froze tabs pre-PR-B, and the
 * historical freeze class (full re-parse + full re-highlight per delta) has
 * since been removed at the renderer level.
 */
export const CHAT_MESSAGE_THROTTLE_MS = 32
