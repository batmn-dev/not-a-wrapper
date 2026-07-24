/**
 * AI SDK message-notification throttle (chat-responsiveness plan, PR 2).
 *
 * Passed verbatim to `useChat({ chat, throttle })`. The installed
 * `@ai-sdk/react@4.0.23` applies it to the messages callback only (leading +
 * trailing via throttleit); status and error subscriptions stay immediate, so
 * approval/tool/terminal updates are never delayed by it, and the trailing
 * notification guarantees the final message state is always delivered.
 *
 * 50 ms was selected by direct comparison on the deterministic streams
 * (docs/measurements/2026-07-23-pr2-throttle-selection.md — −69% delivered
 * notifications at 100 chunks/s, first visible text unaffected at every
 * value) and verified against production builds
 * (2026-07-23-pr2-pr3-verification.md §4/§8). The former
 * `NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE` flag was removed in the 2026-07-23
 * pre-launch flag collapse: the throttle is permanent behavior. The old `0`
 * rollback reproduced unthrottled main-thread saturation that froze and
 * crashed tabs on large code streams
 * (2026-07-23-section6-freeze-rootcause.md exonerated the throttle and
 * showed it strictly reduces commits), so there is deliberately no way to
 * turn this off; changing the value is a code change.
 */
export const CHAT_MESSAGE_THROTTLE_MS = 50
