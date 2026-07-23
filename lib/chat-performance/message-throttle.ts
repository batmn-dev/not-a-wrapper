/**
 * AI SDK message-notification throttle (chat-responsiveness plan, PR 2).
 *
 * One value, one seam: `NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE` carries the
 * throttle interval in milliseconds and is passed verbatim to
 * `useChat({ chat, throttle })`. The installed `@ai-sdk/react@4.0.23` applies
 * it to the messages callback only (leading + trailing via throttleit);
 * status and error subscriptions stay immediate. `0` or unset disables the
 * throttle entirely — that is the rollback path (plan §PR 2), and the SDK
 * treats `0` as "no throttle" (`throttleWaitMs ? throttle(fn) : fn`).
 *
 * Seam contract (docs/chat-performance-rollout-seam.md): NEXT_PUBLIC_ flags
 * are build-time-inlined — changing the value is a redeploy, not a live
 * toggle. Consumers must resolve the value ONCE per mount (a `useState`
 * initializer) and never change it during an active subscription; the SDK
 * would re-subscribe mid-stream on a changed value, which the plan forbids.
 */

/**
 * The value selected by the PR 2 local comparison (0/32/50/100 ms on the
 * deterministic streams; see docs/measurements/2026-07-23-pr2-throttle-selection.md).
 * Deployments enable the throttle by setting
 * `NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE` to this value; the constant is the
 * recorded recommendation, not a runtime default — unset stays disabled so
 * the legacy path remains the build-time default through the soak.
 */
export const RECOMMENDED_CHAT_MESSAGE_THROTTLE_MS = 50

/**
 * Anything above this is treated as a configuration error and fails safe to
 * the legacy unthrottled path: a mistyped large interval would visibly delay
 * approval/tool/terminal updates (plan §9.4 rollback trigger) rather than
 * merely batching renders.
 */
const MAX_CHAT_MESSAGE_THROTTLE_MS = 1000

/**
 * Resolves the raw flag value to the number passed to `useChat`. Returns `0`
 * (disabled) for unset, empty, non-numeric, negative, non-finite, or
 * out-of-range values. Fractional values are floored — the SDK forwards the
 * number to `setTimeout`, which has millisecond granularity anyway.
 */
export function resolveChatMessageThrottleMs(
  raw: string | undefined = process.env.NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE
): number {
  if (raw === undefined || raw.trim() === "") return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 0
  const floored = Math.floor(parsed)
  if (floored < 0 || floored > MAX_CHAT_MESSAGE_THROTTLE_MS) return 0
  return floored
}
