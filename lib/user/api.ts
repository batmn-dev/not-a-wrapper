import { defaultPreferences } from "@/lib/user-preference-store/utils"
import type { NoUserInfo, UserInfo } from "@workos-inc/authkit-nextjs"
import { withAuth } from "@workos-inc/authkit-nextjs"
import type { User as WorkosUser } from "@workos-inc/node"
import type { UserProfile } from "./types"

type InitialAuth = Omit<UserInfo | NoUserInfo, "accessToken">

function getDisplayName(user: WorkosUser) {
  const fullName = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim()
  if (fullName) return fullName

  const [localPart] = user.email.split("@")
  return localPart || user.email
}

function toInitialAuth(auth: UserInfo | NoUserInfo): InitialAuth {
  const { accessToken: _accessToken, ...initialAuth } = auth
  return initialAuth
}

export function getUserProfileFromWorkosUser(
  user: WorkosUser | null
): UserProfile | null {
  if (!user) return null

  return {
    id: user.id,
    email: user.email,
    display_name: getDisplayName(user),
    profile_image: user.profilePictureUrl,
    anonymous: false,
    premium: null,
    message_count: null,
    daily_message_count: null,
    daily_reset: null,
    daily_pro_message_count: null,
    daily_pro_reset: null,
    last_active_at: null,
    created_at: null,
    favorite_models: null,
    system_prompt: null,
    preferences: defaultPreferences,
  }
}

/**
 * Get auth and user profile from WorkOS AuthKit.
 * Convex remains the source of truth for app-specific fields.
 */
export async function getUserAuth(): Promise<{
  initialAuth: InitialAuth
  userProfile: UserProfile | null
}> {
  const auth = await withAuth()

  return {
    initialAuth: toInitialAuth(auth),
    userProfile: getUserProfileFromWorkosUser(auth.user),
  }
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const auth = await withAuth()
  return getUserProfileFromWorkosUser(auth.user)
}
