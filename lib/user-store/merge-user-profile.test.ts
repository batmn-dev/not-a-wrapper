import type { Doc } from "@/convex/_generated/dataModel"
import type { UserProfile } from "@/lib/user/types"
import { describe, expect, it } from "vitest"
import { mergeUserProfileWithConvexFields } from "./merge-user-profile"

describe("mergeUserProfileWithConvexFields", () => {
  it("prefers an app-managed profile image over the WorkOS image", () => {
    const user = {
      id: "workos-user-1",
      email: "user@example.com",
      display_name: "User",
      profile_image: "https://workos.test/avatar.png",
      anonymous: false,
      premium: false,
      message_count: 0,
      daily_message_count: 0,
      daily_reset: null,
      daily_pro_message_count: 0,
      daily_pro_reset: null,
      last_active_at: null,
      created_at: null,
      favorite_models: [],
      system_prompt: null,
    } satisfies UserProfile
    const convexUser = {
      _id: "user-1",
      _creationTime: 1,
      workosUserId: user.id,
      email: user.email,
      profileImageOverride: "https://images.test/avatar.png",
    } as Doc<"users">

    expect(
      mergeUserProfileWithConvexFields(user, convexUser)?.profile_image
    ).toBe("https://images.test/avatar.png")
  })

  it("restores the WorkOS image when an app-managed override is cleared", () => {
    const user = {
      id: "workos-user-1",
      email: "user@example.com",
      display_name: "User",
      profile_image: "https://images.test/avatar.png",
      anonymous: false,
      premium: false,
      message_count: 0,
      daily_message_count: 0,
      daily_reset: null,
      daily_pro_message_count: 0,
      daily_pro_reset: null,
      last_active_at: null,
      created_at: null,
      favorite_models: [],
      system_prompt: null,
    } satisfies UserProfile
    const convexUser = {
      _id: "user-1",
      _creationTime: 1,
      workosUserId: user.id,
      email: user.email,
      profileImage: "https://workos.test/avatar.png",
    } as Doc<"users">

    expect(
      mergeUserProfileWithConvexFields(user, convexUser)?.profile_image
    ).toBe("https://workos.test/avatar.png")
  })
})
