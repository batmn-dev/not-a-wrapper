import {
  computeUsageCredits,
  type PricingSnapshot,
} from "@/convex/domain/usage_accounting"
import { CHAT_TITLE_MAX_OUTPUT_TOKENS } from "@/lib/chat-title-prompt"
import {
  CHARS_PER_TOKEN,
  estimateTitleInputTokens,
  PER_MESSAGE_OVERHEAD_TOKENS,
} from "@/lib/usage/terminal-usage-estimate"
import type { UIMessage } from "ai"

/**
 * Platform usage estimation (ADR-0021) — pure admission-control math, NOT the
 * final charge. The estimate reserves credits before provider execution;
 * settlement afterward refunds the unused difference or records the overrun.
 *
 * Documented heuristics:
 *  - Input tokens ≈ ceil(chars / 4) over system prompt + history text, plus a
 *    per-message structural overhead, a flat per-image allowance, and a flat
 *    tool allowance when search/tools are active (tool definitions plus
 *    expected tool-step re-sends).
 *  - Output tokens: the route-aware funding reservation resolved in
 *    `lib/openproviders/output-budget.ts`. It can differ from the AI SDK's
 *    `maxOutputTokens` value when a provider adapter adds fixed reasoning
 *    tokens. We deliberately do NOT reserve the theoretical context window.
 *  - Title generation: always included (first-turn detection is not reliable
 *    at admission time); a turn that runs no title call settles that
 *    component back to zero.
 *
 * Multi-step tool turns can exceed the reservation; the overrun settles
 * honestly (negative balances are recorded, never clamped).
 */

// Character/token vocabulary shared with the terminal-usage estimators —
// declared once in lib/usage/terminal-usage-estimate.ts.
const IMAGE_ATTACHMENT_TOKENS = 1_100
const TOOL_ALLOWANCE_TOKENS = 2_000
const TITLE_INPUT_TOKENS_MAX = 1_000 // 4000-char title input cap / 4
const TITLE_OUTPUT_TOKENS = CHAT_TITLE_MAX_OUTPUT_TOKENS

export type PlatformUsageEstimate = {
  estimatedInputTokens: number
  estimatedOutputTokens: number
  /** Title component ceiling, priced at the title route's own rates. */
  titleEstimatedCredits: number
  /**
   * Input-only title floor for the ACTUAL prompt this turn's title call
   * would send (clipped user text + instructions + wrapper). Pinned on the
   * reservation so a cancelled title attempt settles at its input floor
   * instead of the full title estimate (ADR-0021 cancellation amendment).
   */
  titleEstimatedInputTokens: number
  /** Total admission-control reservation, title included. */
  estimatedCredits: number
}

function estimateMessageTokens(message: UIMessage): number {
  let chars = 0
  let imageParts = 0
  for (const part of message.parts ?? []) {
    if (part.type === "text" || part.type === "reasoning") {
      chars += typeof part.text === "string" ? part.text.length : 0
    } else if (part.type === "file") {
      const mediaType = (part as { mediaType?: unknown }).mediaType
      if (typeof mediaType === "string" && mediaType.startsWith("image/")) {
        imageParts += 1
      } else {
        // Non-image files reach the model as inlined text; approximate from
        // the part's url/text payload size when present.
        const inline = (part as { url?: unknown }).url
        chars += typeof inline === "string" ? inline.length : 0
      }
    } else {
      // Tool parts, sources, and other structured history re-enter the
      // prompt as JSON-ish content; approximate conservatively.
      try {
        chars += JSON.stringify(part).length
      } catch {
        chars += 200
      }
    }
  }
  return (
    Math.ceil(chars / CHARS_PER_TOKEN) +
    PER_MESSAGE_OVERHEAD_TOKENS +
    imageParts * IMAGE_ATTACHMENT_TOKENS
  )
}

export function estimatePlatformUsage(args: {
  messages: UIMessage[]
  systemPrompt?: string
  /** Tools may run this turn (search enabled or tool layers active). */
  toolsLikely: boolean
  pricingSnapshot: PricingSnapshot
  /** Route-specific worst-case billable output reservation. */
  outputTokenBudget: number
}): PlatformUsageEstimate {
  let inputTokens = Math.ceil(
    (args.systemPrompt?.length ?? 0) / CHARS_PER_TOKEN
  )
  for (const message of args.messages) {
    inputTokens += estimateMessageTokens(message)
  }
  if (args.toolsLikely) {
    inputTokens += TOOL_ALLOWANCE_TOKENS
  }

  const outputTokens = args.outputTokenBudget

  const primaryCredits = computeUsageCredits(args.pricingSnapshot.primary, {
    inputTokens,
    outputTokens,
  })
  const titleRate = args.pricingSnapshot.title ?? args.pricingSnapshot.primary
  // Floor from the actual title prompt; ceiling from whichever is larger, so
  // the reserved title component always covers a settled input floor.
  const titleEstimatedInputTokens = estimateTitleInputTokens(
    firstUserMessageText(args.messages)
  )
  const titleEstimatedCredits = computeUsageCredits(titleRate, {
    inputTokens: Math.max(TITLE_INPUT_TOKENS_MAX, titleEstimatedInputTokens),
    outputTokens: TITLE_OUTPUT_TOKENS,
  })

  return {
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    titleEstimatedCredits,
    titleEstimatedInputTokens,
    estimatedCredits: primaryCredits + titleEstimatedCredits,
  }
}

/** The text the title call names the chat from: the first user message. */
function firstUserMessageText(messages: UIMessage[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue
    let text = ""
    for (const part of message.parts ?? []) {
      if (part.type === "text" && typeof part.text === "string") {
        text += part.text
      }
    }
    return text
  }
  return ""
}
