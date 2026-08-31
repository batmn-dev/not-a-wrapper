import {
  OPENROUTER_AFFORDABILITY_MESSAGE,
  type ChatErrorRecovery,
} from "@/lib/chat-errors"
import { collectChatErrorEvidence } from "@/lib/observability/chat-error-evidence"
import type { Provider } from "@/lib/provider-identity"
import type { ApiKeySource } from "@/lib/user-keys"

export type PublicChatErrorCode =
  | "AUTHENTICATION_ERROR"
  | "PAYMENT_REQUIRED"
  | "RATE_LIMIT_EXCEEDED"
  | "PROVIDER_ERROR"
  | "UNKNOWN_ERROR"

export type PublicChatErrorContext = {
  provider?: Provider
  credentialSource?: ApiKeySource
}

export type PublicChatError = {
  code: PublicChatErrorCode
  message: string
  retryable: boolean
  provider?: Provider
  credentialSource?: ApiKeySource
  recovery?: ChatErrorRecovery
}

const PROVIDER_NAMES: Record<Provider, string> = {
  openai: "OpenAI",
  mistral: "Mistral",
  perplexity: "Perplexity",
  google: "Google",
  anthropic: "Anthropic",
  xai: "xAI",
  openrouter: "OpenRouter",
}

function includesAny(values: string[], needles: string[]): boolean {
  return values.some((value) =>
    needles.some((needle) => value.includes(needle))
  )
}

function providerName(provider?: Provider): string | undefined {
  return provider ? PROVIDER_NAMES[provider] : undefined
}

function paymentMessage(context: PublicChatErrorContext): string {
  const name = providerName(context.provider)
  if (!name) return "Insufficient credits or payment required."
  if (context.credentialSource === "byok") {
    return `Your ${name} API account has insufficient credits or requires payment. Check ${name} billing or update your API key in settings.`
  }
  if (context.credentialSource === "platform") {
    return `${name} is temporarily unavailable because the app's provider account requires payment. Try again later or add your own ${name} API key in settings.`
  }
  return `Insufficient credits or payment required for ${name}.`
}

function authenticationMessage(context: PublicChatErrorContext): string {
  const name = providerName(context.provider)
  if (!name) return "Invalid API key or authentication failed."
  if (context.credentialSource === "byok") {
    return `Your ${name} API key was rejected. Update it in settings.`
  }
  if (context.credentialSource === "platform") {
    return `${name} authentication is temporarily unavailable. Try again later or add your own ${name} API key in settings.`
  }
  return `Invalid API key or authentication failed for ${name}.`
}

function rateLimitMessage(context: PublicChatErrorContext): string {
  const name = providerName(context.provider)
  return name
    ? `${name} rate limit exceeded. Please try again later.`
    : "Rate limit exceeded. Please try again later."
}

/**
 * Convert an arbitrary provider/AI SDK error into the one public result used by
 * the stream, durable persistence, analytics, and UI. Provider attribution is
 * accepted only from the already-resolved runtime context; raw messages and
 * stacks are never treated as routing facts.
 */
export function normalizeChatError(
  error: unknown,
  context: PublicChatErrorContext = {}
): PublicChatError {
  const evidence = collectChatErrorEvidence(error)
  const internalMissingApiKeyMessage =
    evidence.root?.code === "MISSING_API_KEY" &&
    evidence.root.statuses.includes(401) &&
    evidence.root.message
      ? evidence.root.message
      : null
  const base = {
    ...(context.provider ? { provider: context.provider } : {}),
    ...(context.credentialSource
      ? { credentialSource: context.credentialSource }
      : {}),
  }

  if (evidence.codes.includes("missing_api_key")) {
    return {
      ...base,
      code: "AUTHENTICATION_ERROR",
      message: internalMissingApiKeyMessage ?? authenticationMessage(context),
      retryable: false,
    }
  }

  if (
    evidence.statuses.includes(401) ||
    includesAny(evidence.codes, [
      "authentication",
      "unauthorized",
      "invalid_api_key",
    ]) ||
    includesAny(evidence.messages, [
      "invalid x-api-key",
      "authentication_error",
      "incorrect api key",
      "invalid api key",
    ])
  ) {
    return {
      ...base,
      code: "AUTHENTICATION_ERROR",
      message: authenticationMessage(context),
      retryable: false,
    }
  }

  if (
    evidence.statuses.includes(402) ||
    includesAny(evidence.codes, ["payment_required", "insufficient_quota"]) ||
    includesAny(evidence.errorTypes, [
      "payment_required",
      "token_limit_exceeded",
    ]) ||
    includesAny(evidence.messages, [
      "payment required",
      "insufficient credit",
      "insufficient quota",
      "billing",
      "credits",
    ])
  ) {
    const openRouterAffordability =
      context.provider === "openrouter" &&
      context.credentialSource === "byok" &&
      (evidence.errorTypes.includes("token_limit_exceeded") ||
        (includesAny(evidence.messages, ["max_tokens", "maximum output"]) &&
          includesAny(evidence.messages, ["afford", "credit", "balance"])))
    return {
      ...base,
      code: "PAYMENT_REQUIRED",
      message: openRouterAffordability
        ? OPENROUTER_AFFORDABILITY_MESSAGE
        : paymentMessage(context),
      retryable: false,
      ...(openRouterAffordability
        ? { recovery: "retry_with_shorter_generation_budget" as const }
        : {}),
    }
  }

  if (
    evidence.statuses.includes(429) ||
    includesAny(evidence.codes, ["rate_limit", "too_many_requests"]) ||
    includesAny(evidence.messages, ["rate limit", "too many requests"])
  ) {
    return {
      ...base,
      code: "RATE_LIMIT_EXCEEDED",
      message: rateLimitMessage(context),
      retryable: true,
    }
  }

  if (evidence.messages.length > 0) {
    return {
      ...base,
      code: "PROVIDER_ERROR",
      message: "An error occurred. Please try again.",
      retryable: true,
    }
  }

  return {
    ...base,
    code: "UNKNOWN_ERROR",
    message: "An error occurred. Please try again.",
    retryable: true,
  }
}
