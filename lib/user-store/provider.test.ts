import { describe, expect, it } from "vitest"
import type { UserProfile } from "@/lib/user/types"
import { mergeUserProfileWithConvexFields } from "./merge-user-profile"

const baseUser: UserProfile = {
  id: "user-1",
  email: "user@example.com",
  display_name: "User",
  profile_image: null,
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
}

describe("mergeUserProfileWithConvexFields", () => {
  it("reflects Convex-managed premium and usage fields in user context", () => {
    expect(
      mergeUserProfileWithConvexFields(baseUser, {
        _creationTime: 100,
        displayName: "Convex User",
        anonymous: false,
        premium: true,
        messageCount: 12,
        dailyMessageCount: 3,
        dailyReset: 200,
        dailyProMessageCount: 2,
        dailyProReset: 300,
        lastActiveAt: 400,
        favoriteModels: ["openai/gpt-5"],
        systemPrompt: "Be concise",
      })
    ).toMatchObject({
      display_name: "Convex User",
      premium: true,
      message_count: 12,
      daily_message_count: 3,
      daily_reset: "200",
      daily_pro_message_count: 2,
      daily_pro_reset: "300",
      last_active_at: "400",
      created_at: "100",
      favorite_models: ["openai/gpt-5"],
      system_prompt: "Be concise",
    })
  })
})
