import { api } from "@/convex/_generated/api"
import {
  AUTH_DAILY_MESSAGE_LIMIT,
  NON_AUTH_DAILY_MESSAGE_LIMIT,
} from "@/lib/config"
import { fetchQuery } from "convex/nextjs"

export type UsageResult = {
  dailyCount: number
  dailyLimit: number
  remaining: number
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
    return {
      dailyCount: regularUsage.count ?? 0,
      dailyLimit: regularUsage.limit,
      remaining: regularUsage.remaining,
    }
  } catch (error) {
    console.error("Error fetching usage from Convex:", error)
    // Return default values on error to avoid blocking users
    return {
      dailyCount: 0,
      dailyLimit: defaultLimit,
      remaining: defaultLimit,
    }
  }
}
