export const CHAT_ERROR_RECOVERIES = [
  "retry_with_shorter_generation_budget",
] as const

export type ChatErrorRecovery = (typeof CHAT_ERROR_RECOVERIES)[number]

export function isChatErrorRecovery(
  value: unknown
): value is ChatErrorRecovery {
  return (CHAT_ERROR_RECOVERIES as readonly unknown[]).includes(value)
}

export const OPENROUTER_AFFORDABILITY_MESSAGE =
  "Your OpenRouter balance cannot cover this request's maximum output allowance. Retry with a 16K generation budget or add credits in OpenRouter."
