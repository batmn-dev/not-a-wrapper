import type { Doc } from "@/convex/_generated/dataModel"
import type { UserProfile } from "@/lib/user/types"

type ConvexUserProfileFields = Pick<
  Doc<"users">,
  | "_creationTime"
  | "premium"
  | "anonymous"
  | "messageCount"
  | "dailyMessageCount"
  | "dailyReset"
  | "lastActiveAt"
  | "favoriteModels"
  | "systemPrompt"
  | "profileImage"
  | "profileImageOverride"
> & {
  displayName?: string
}

function timestampToUserProfileString(
  value: number | undefined,
  fallback: string | null
): string | null {
  return value === undefined ? fallback : String(value)
}

export function mergeUserProfileWithConvexFields(
  user: UserProfile | null,
  convexUser: ConvexUserProfileFields | null | undefined,
  pendingProfileImage?: string
): UserProfile | null {
  if (!user || !convexUser) return user

  return {
    ...user,
    display_name: convexUser.displayName ?? user.display_name,
    profile_image:
      pendingProfileImage ??
      convexUser.profileImageOverride ??
      convexUser.profileImage ??
      null,
    anonymous: convexUser.anonymous ?? user.anonymous,
    premium: convexUser.premium ?? user.premium,
    message_count: convexUser.messageCount ?? user.message_count,
    daily_message_count:
      convexUser.dailyMessageCount ?? user.daily_message_count,
    daily_reset: timestampToUserProfileString(
      convexUser.dailyReset,
      user.daily_reset
    ),
    last_active_at: timestampToUserProfileString(
      convexUser.lastActiveAt,
      user.last_active_at
    ),
    created_at: String(convexUser._creationTime),
    favorite_models: convexUser.favoriteModels ?? user.favorite_models,
    system_prompt: convexUser.systemPrompt ?? user.system_prompt,
  }
}
