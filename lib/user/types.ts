import type { UserPreferences } from "../user-preference-store/utils"

export type UserProfile = {
  id: string
  email: string
  display_name: string
  profile_image: string | null

  anonymous: boolean | null
  premium: boolean | null

  message_count: number | null
  daily_message_count: number | null
  daily_reset: string | null

  last_active_at: string | null
  created_at: string | null

  favorite_models: string[] | null
  system_prompt: string | null
  preferences?: UserPreferences
}
