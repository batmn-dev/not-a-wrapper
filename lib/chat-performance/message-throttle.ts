/**
 * AI SDK message-notification throttle (chat-responsiveness plan PR 2).
 *
 * Passed verbatim to `useChat({ chat, throttle })`. The installed
 * `@ai-sdk/react@4.0.23` applies it to the messages callback only (leading +
 * trailing via throttleit); status and error subscriptions stay immediate, so
 * approval/tool/terminal updates are never delayed by it, and the trailing
 * notification guarantees the final message state is always delivered.
 *
 * 50 ms — selected on production builds 2026-07-23
 * (docs/measurements/2026-07-23-pr2-throttle-selection.md,
 * 2026-07-23-pr2-pr3-verification.md) and RETAINED by the 2026-07-27
 * streaming plan PR D after review: the incremental-projection renderer
 * makes 32 ms (and even unthrottled) cheap in the deterministic jsdom
 * replay (benchmarks/chat-performance/cadence-selection.test.tsx — ~1–3 ms
 * per commit at every cadence, kept in CI as a long-task canary), but the
 * plan's selection rule requires production-browser paint traces across the
 * 12 KB/100 KB/code payloads, composer typing, autoscroll, and a 4× CPU
 * profile before changing a production cadence, and those have not been
 * collected. Lowering to 32/16 ms is a candidate change gated on that
 * evidence — see docs/measurements/2026-07-27-streaming-renderer-results.md
 * §PR D. The value is deliberately a code constant, not a flag (2026-07-23
 * flag collapse; the historical unthrottled tab-freeze class was removed at
 * the renderer level by PR B, but headroom claims still require traces).
 */
export const CHAT_MESSAGE_THROTTLE_MS = 50
