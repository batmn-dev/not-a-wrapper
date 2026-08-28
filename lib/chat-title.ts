// Prompt-shape constants (instructions, clip, wrapper, output cap) live on
// lib/chat-title-prompt.ts, shared with the platform-usage estimators so the
// title input estimate can never drift from the prompt actually sent.
import {
  buildChatTitlePrompt,
  CHAT_TITLE_INSTRUCTIONS,
  CHAT_TITLE_MAX_OUTPUT_TOKENS,
  clipChatTitleInput,
} from "@/lib/chat-title-prompt"
import type { ModelConfig } from "@/lib/models/types"
import { APICallError, type LanguageModel } from "ai"

export const CHAT_TITLE_PLACEHOLDER = "New chat"
export const INITIAL_CHAT_TITLE_GENERATION = 1

// A sidebar row shows roughly 25-30 characters before the ellipsis; the
// character cap is the operative bound for languages without spaces.
const CHAT_TITLE_MAX_CHARACTERS = 32
const CHAT_TITLE_MAX_WORDS = 4
const CHAT_TITLE_TIMEOUT_MS = 8_000

function stripModelFormatting(value: string): string {
  const withoutThinking = value.replace(/<think>[\s\S]*?<\/think>/gi, " ")
  const firstLine = withoutThinking
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  return (firstLine ?? "")
    .replace(/^(?:title|chat title|conversation title)\s*:\s*/i, "")
    .replace(/^[\s`*_#"'“”‘’«»]+|[\s`*_#"'“”‘’«»]+$/g, "")
    .replace(/[.!?。！？:;]+$/u, "")
    .replace(/\s+/g, " ")
    .trim()
}

function truncateTitle(value: string): string {
  const words = value.split(/\s+/u).filter(Boolean)
  const wordBounded =
    words.length > CHAT_TITLE_MAX_WORDS
      ? words.slice(0, CHAT_TITLE_MAX_WORDS).join(" ")
      : value

  if (wordBounded.length <= CHAT_TITLE_MAX_CHARACTERS) return wordBounded
  const characterBounded = wordBounded.slice(0, CHAT_TITLE_MAX_CHARACTERS)
  const lastSpace = characterBounded.lastIndexOf(" ")
  return (
    lastSpace > 0 ? characterBounded.slice(0, lastSpace) : characterBounded
  ).trim()
}

function isSimpleGreeting(value: string): boolean {
  return /^(?:hi|hello|hey|hiya|howdy|good\s+(?:morning|afternoon|evening))[\s!.?]*$/i.test(
    value.trim()
  )
}

export function fallbackChatTitle(userText: string): string {
  if (isSimpleGreeting(userText)) return "Greeting Exchange"

  const normalized = stripModelFormatting(userText)
  const fallback = truncateTitle(normalized)
  return fallback || CHAT_TITLE_PLACEHOLDER
}

export function sanitizeGeneratedChatTitle(
  generatedText: string,
  userText: string
): string {
  const sanitized = truncateTitle(stripModelFormatting(generatedText))
  return sanitized || fallbackChatTitle(userText)
}

/** Pick a small same-provider model so title generation reuses the resolved
 * credential without inheriting the answer model's cost or thinking budget. */
export function selectChatTitleModelConfig(
  models: ModelConfig[],
  selectedModel: ModelConfig
): ModelConfig {
  const candidates = models.filter(
    (model) =>
      model.providerId === selectedModel.providerId &&
      model.catalogStatus === "visible"
  )
  if (candidates.length === 0) return selectedModel

  return [...candidates].sort((left, right) => {
    const score = (model: ModelConfig) => [
      model.reasoningText === true ? 1 : 0,
      model.speed === "Fast" ? 0 : model.speed === "Medium" ? 1 : 2,
      model.tags?.includes("cheap") ? 0 : 1,
      model.inputCost ?? Number.POSITIVE_INFINITY,
      model.outputCost ?? Number.POSITIVE_INFINITY,
    ]
    const leftScore = score(left)
    const rightScore = score(right)
    for (let index = 0; index < leftScore.length; index++) {
      const difference = leftScore[index]! - rightScore[index]!
      if (difference !== 0) return difference
    }
    return left.id.localeCompare(right.id)
  })[0]!
}

/**
 * The title call's identity and usage ride alongside the title so the
 * platform-allowance settlement can meter the title as its own billable
 * operation at the concrete route's pinned rates (ADR-0021), including when a
 * retired title route falls back to the answer route.
 */
export type GeneratedChatTitle = {
  title: string
  /** Concrete model route the call executed on (for attribution). */
  routeId: string
  /** Selects one of the immutable reservation snapshot's known rates. */
  pricingRole: "title" | "primary"
  usage: { inputTokens?: number; outputTokens?: number }
}

export type ChatTitleModelRoute = {
  model: LanguageModel
  /** Route id of `model`, reported back for cost attribution. */
  routeId: string
}

/**
 * A provider answering 404 for the title route means the catalog entry is
 * stale (retired or renamed upstream) — e.g. Google's "no longer available to
 * new users" — not that the request was bad. Any other failure propagates.
 */
function isRetiredModelError(error: unknown): boolean {
  return APICallError.isInstance(error) && error.statusCode === 404
}

export async function generateChatTitle(args: {
  generateText: typeof import("ai").generateText
  model: LanguageModel
  /** Route id of `model`, reported back for cost attribution. */
  routeId: string
  /**
   * Tried once when the title route is retired upstream (404). The answer
   * model is the natural choice: it just accepted the same credential.
   */
  fallback?: ChatTitleModelRoute
  userText: string
  abortSignal?: AbortSignal
  /**
   * Fired immediately before each concrete provider attempt (initial title
   * route, then the primary fallback on a 404). Cancellation settlement uses
   * it to charge a started-but-unfinished title at its input floor for the
   * exact attempted route (ADR-0021).
   */
  onAttemptStart?: (attempt: {
    routeId: string
    pricingRole: "title" | "primary"
  }) => void
}): Promise<GeneratedChatTitle> {
  const userText = clipChatTitleInput(args.userText)
  if (!userText) {
    return {
      title: CHAT_TITLE_PLACEHOLDER,
      routeId: args.routeId,
      pricingRole: "title",
      usage: { inputTokens: 0, outputTokens: 0 },
    }
  }

  const generate = async (
    route: ChatTitleModelRoute,
    pricingRole: GeneratedChatTitle["pricingRole"]
  ) => {
    args.onAttemptStart?.({ routeId: route.routeId, pricingRole })
    const result = await args.generateText({
      model: route.model,
      instructions: CHAT_TITLE_INSTRUCTIONS,
      prompt: buildChatTitlePrompt(userText),
      maxOutputTokens: CHAT_TITLE_MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      timeout: CHAT_TITLE_TIMEOUT_MS,
      abortSignal: args.abortSignal,
    })
    return {
      title: sanitizeGeneratedChatTitle(result.text, userText),
      routeId: route.routeId,
      pricingRole,
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      },
    }
  }

  try {
    return await generate({ model: args.model, routeId: args.routeId }, "title")
  } catch (error) {
    if (!args.fallback || !isRetiredModelError(error)) throw error
    return generate(args.fallback, "primary")
  }
}
