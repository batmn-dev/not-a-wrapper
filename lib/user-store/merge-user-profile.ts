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
  | "dailyProMessageCount"
  | "dailyProReset"
  | "lastActiveAt"
  | "favoriteModels"
  | "systemPrompt"
> & {
  displayName?: string
}

function timestampToUserProfileString(value: number | undefined): string | null {
  return value === undefined ? null : String(value)
}

export function mergeUserProfileWithConvexFields(
  user: UserProfile | null,
  convexUser: ConvexUserProfileFields | null | undefined
): UserProfile | null {
  if (!user || !convexUser) return user

  return {
    ...user,
    display_name: convexUser.displayName ?? user.display_name,
    anonymous: convexUser.anonymous ?? user.anonymous,
    premium: convexUser.premium ?? null,
    message_count: convexUser.messageCount ?? null,
    daily_message_count: convexUser.dailyMessageCount ?? null,
    daily_reset: timestampToUserProfileString(convexUser.dailyReset),
    daily_pro_message_count: convexUser.dailyProMessageCount ?? null,
    daily_pro_reset: timestampToUserProfileString(convexUser.dailyProReset),
    last_active_at: timestampToUserProfileString(convexUser.lastActiveAt),
    created_at: timestampToUserProfileString(convexUser._creationTime),
    favorite_models: convexUser.favoriteModels ?? null,
    system_prompt: convexUser.systemPrompt ?? null,
  }
}
