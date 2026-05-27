import type { UserProfile } from "@/lib/user/types"
import { fetchClient } from "./fetch"

export class UsageLimitError extends Error {
  code: string
  constructor(message: string) {
    super(message)
    this.code = "DAILY_LIMIT_REACHED"
  }
}

/**
 * Checks the user's daily usage and increments both overall and daily counters.
 * Note: With Convex, this should be done via the usage.checkUsage query
 */
export async function checkRateLimits(
  userId: string,
  isAuthenticated: boolean
) {
  try {
    const res = await fetchClient(
      `/api/rate-limits?userId=${userId}&isAuthenticated=${isAuthenticated}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }
    )
    const responseData = await res.json()
    if (!res.ok) {
      throw new Error(
        responseData.error ||
          `Failed to check rate limits: ${res.status} ${res.statusText}`
      )
    }
    return responseData
  } catch (err) {
    console.error("Error checking rate limits:", err)
    throw err
  }
}

/**
 * Get or create a guest user ID
 * Note: guests can use the app without authentication or sign in with WorkOS.
 */
export const getOrCreateGuestUserId = async (
  user: UserProfile | null
): Promise<string | null> => {
  if (user?.id) return user.id

  // Generate a local guest ID if no user is authenticated.
  // This is stored in localStorage and used for local state only
  const existingGuestId = localStorage.getItem("guestUserId")
  if (existingGuestId) {
    return existingGuestId
  }

  // Generate a new guest ID
  const newGuestId = `guest_${crypto.randomUUID()}`
  localStorage.setItem("guestUserId", newGuestId)

  return newGuestId
}
