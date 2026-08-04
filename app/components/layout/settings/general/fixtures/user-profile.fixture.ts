import type { UserProfile } from "@/lib/user/types"

export const userProfileFixture = {
  id: "user_fixture_001",
  email: "avery@example.test",
  display_name: "Avery Chen",
  profile_image: null,
  anonymous: false,
  premium: false,
  message_count: 0,
  daily_message_count: 0,
  daily_reset: null,
  daily_pro_message_count: 0,
  daily_pro_reset: null,
  last_active_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  favorite_models: [],
  system_prompt: null,
} satisfies UserProfile
