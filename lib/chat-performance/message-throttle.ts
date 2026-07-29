/**
 * AI SDK message-notification throttle (chat-responsiveness plan PR 2).
 *
 * Passed verbatim to `useChat({ chat, throttle })`. The installed
 * `@ai-sdk/react@4.0.23` applies it to the messages callback only (leading +
 * trailing via throttleit); status and error subscriptions stay immediate, so
 * approval/tool/terminal updates are never delayed by it, and the trailing
 * notification guarantees the final message state is always delivered.
 *
 * 16 ms — the approved 2026-07-28 streaming-renderer target after sparse
 * metadata removed per-delta protocol amplification. This is one browser-
 * frame coalescing window on a 60 Hz display, not a presentation scheduler:
 * React always reads the latest canonical AI SDK snapshot, and terminal
 * status/error subscriptions remain immediate. Production Chrome normal/4×
 * validation decides whether this remains 16 ms; 32 ms is the single rollback
 * value if a gate fails. The value is deliberately a code constant, not a
 * flag.
 */
export const CHAT_MESSAGE_THROTTLE_MS = 16
