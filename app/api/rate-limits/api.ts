import { api } from "@/convex/_generated/api"
import {
  AUTH_DAILY_MESSAGE_LIMIT,
  DAILY_LIMIT_PRO_MODELS,
  NON_AUTH_DAILY_MESSAGE_LIMIT,
} from "@/lib/config"
import { fetchQuery } from "convex/nextjs"

export type UsageResult = {
  dailyCount: number
  dailyProCount: number
  dailyLimit: number
  remaining: number
  remainingPro: number
}

/**
 * Get message usage for a user from Convex
 * @param token - Convex auth token (for authenticated users)
 * @param anonymousId - Anonymous ID (for unauthenticated users)
 * @param isAuthenticated - Whether the user is authenticated
 */
export async function getMessageUsage(
  token: string | undefined,
  anonymousId: string | undefined,
  isAuthenticated: boolean
): Promise<UsageResult> {
  // Default limit based on auth state - used for error fallback
  const defaultLimit = isAuthenticated
    ? AUTH_DAILY_MESSAGE_LIMIT
    : NON_AUTH_DAILY_MESSAGE_LIMIT

  try {
    const regularUsage = await fetchQuery(
      api.usage.checkUsage,
      { anonymousId },
      token ? { token } : undefined
    )

    // Use the limit from Convex to keep dailyLimit consistent with the enforced limit
    // (handles edge cases like anonymous authenticated users or user not found)
    // The pro-model counter tier is retired (ADR-0021): platform spend is
    // governed by the usage allowance, not a per-day pro-message count. The
    // pro fields stay in the response shape for deployed-client compatibility
    // and always report "nothing consumed".
    return {
      dailyCount: regularUsage.count ?? 0,
      dailyProCount: 0,
      dailyLimit: regularUsage.limit,
      remaining: regularUsage.remaining,
      remainingPro: DAILY_LIMIT_PRO_MODELS,
    }
  } catch (error) {
    console.error("Error fetching usage from Convex:", error)
    // Return default values on error to avoid blocking users
    return {
      dailyCount: 0,
      dailyProCount: 0,
      dailyLimit: defaultLimit,
      remaining: defaultLimit,
      remainingPro: DAILY_LIMIT_PRO_MODELS,
    }
  }
}
