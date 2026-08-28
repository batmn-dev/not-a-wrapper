import {
  buildChatTitlePrompt,
  CHAT_TITLE_INSTRUCTIONS,
  clipChatTitleInput,
} from "../chat-title-prompt"

/**
 * Terminal-usage fallback estimators (ADR-0021 cancellation amendment) —
 * pure, dependency-free, shared by the Next runtime's terminal-usage receipt
 * and the Convex Stop/deadline settlement paths. This module also owns the
 * repository's single character/token approximation vocabulary:
 * `lib/usage/platform-usage-estimate.ts` (admission) imports these constants
 * rather than declaring a second set.
 *
 * Estimates here are settlement FLOORS for cancelled work — deliberately
 * conservative in the user's favor, capped by the reservation at the
 * settlement layer — never admission ceilings.
 */

/** The repository-wide chars-per-token heuristic. */
export const CHARS_PER_TOKEN = 4

/** Structural token overhead attributed per message in a prompt. */
export const PER_MESSAGE_OVERHEAD_TOKENS = 12

/**
 * Structural overhead per assistant tool call in the partial-output estimate
 * (call framing the serialized name/arguments do not capture).
 */
export const TOOL_CALL_STRUCTURAL_OVERHEAD_TOKENS = 12

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Estimate the model-generated output tokens present in a persisted (or
 * in-flight) assistant parts array. Counts what the MODEL emitted:
 * text, reasoning, and tool-call names + serialized arguments. Excludes tool
 * RESULTS, errors, files, and sources — those are not billed model output.
 * Returns a non-negative safe integer; malformed parts count as zero.
 * Callers cap the result at the reservation's `estimatedOutputTokens`.
 */
export function estimatePartialOutputTokens(parts: unknown): number {
  if (!Array.isArray(parts)) return 0
  let chars = 0
  let toolCalls = 0
  for (const part of parts) {
    if (!isRecord(part)) continue
    const type = part.type
    if (type === "text" || type === "reasoning") {
      if (typeof part.text === "string") chars += part.text.length
      continue
    }
    const isToolPart =
      type === "dynamic-tool" ||
      (typeof type === "string" && type.startsWith("tool-"))
    if (!isToolPart) continue
    toolCalls += 1
    const toolName =
      typeof part.toolName === "string"
        ? part.toolName
        : typeof type === "string" && type.startsWith("tool-")
          ? type.slice("tool-".length)
          : ""
    chars += toolName.length
    if (part.input !== undefined) {
      try {
        chars += JSON.stringify(part.input)?.length ?? 0
      } catch {
        // Unserializable input contributes nothing rather than failing.
      }
    }
  }
  const tokens =
    Math.ceil(chars / CHARS_PER_TOKEN) +
    toolCalls * TOOL_CALL_STRUCTURAL_OVERHEAD_TOKENS
  return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : 0
}

/**
 * The title call's input-token floor for one user text: the exact clipped
 * prompt the call would send (instructions + wrapped user text) plus message
 * overhead for the instruction and user messages. Pinned onto the
 * reservation at admission (`titleEstimatedInputTokens`) so a cancelled
 * title attempt settles at its input floor instead of the full title
 * estimate.
 */
export function estimateTitleInputTokens(userText: string): number {
  const prompt = buildChatTitlePrompt(clipChatTitleInput(userText))
  const chars = CHAT_TITLE_INSTRUCTIONS.length + prompt.length
  return Math.ceil(chars / CHARS_PER_TOKEN) + 2 * PER_MESSAGE_OVERHEAD_TOKENS
}
