import type { UserProfile } from "@/lib/user/types"
import {
  createGuestUserId,
  GUEST_USER_STORAGE_KEY,
} from "./chat-store/identity"
import { fetchClient } from "./fetch"

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

export const getOrCreateGuestUserId = async (
  user: UserProfile | null
): Promise<string | null> => {
  if (user?.id) return user.id

  const existingGuestId = localStorage.getItem(GUEST_USER_STORAGE_KEY)
  if (existingGuestId) {
    return existingGuestId
  }

  const newGuestId = createGuestUserId()
  localStorage.setItem(GUEST_USER_STORAGE_KEY, newGuestId)

  return newGuestId
}
