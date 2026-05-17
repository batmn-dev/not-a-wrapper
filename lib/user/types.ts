import type { UserPreferences } from "../user-preference-store/utils"

/**
 * User profile type
 *
 * This type represents the user profile data used throughout the application.
 * User data is sourced from:
 * - WorkOS AuthKit for authentication (id, email, name, image)
 * - Convex for application-specific data (preferences, usage tracking)
 */
export type UserProfile = {
  // Identity (from WorkOS AuthKit)
  id: string
  email: string
  display_name: string
  profile_image: string | null

  // Status
  anonymous: boolean | null
  premium: boolean | null

  // Usage tracking
  message_count: number | null
  daily_message_count: number | null
  daily_reset: string | null
  daily_pro_message_count: number | null
  daily_pro_reset: string | null

  // Activity
  last_active_at: string | null
  created_at: string | null

  // Preferences
  favorite_models: string[] | null
  system_prompt: string | null
  preferences?: UserPreferences
}
