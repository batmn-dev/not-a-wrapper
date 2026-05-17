/**
 * User Provider
 *
 * Provides user context throughout the application. Identity comes from WorkOS
 * AuthKit, while app-specific fields are stored in Convex.
 */
"use client"

import { api } from "@/convex/_generated/api"
import { defaultPreferences } from "@/lib/user-preference-store/utils"
import type { UserProfile } from "@/lib/user/types"
import { useAuth } from "@workos-inc/authkit-nextjs/components"
import type { User as WorkosUser } from "@workos-inc/node"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

type UserContextType = {
  user: UserProfile | null
  isLoading: boolean
  updateUser: (updates: Partial<UserProfile>) => Promise<void>
  // Note: refreshUser was removed - use Convex real-time queries or ModelProvider.favoriteModels instead
}

const UserContext = createContext<UserContextType | undefined>(undefined)

function getDisplayName(workosUser: WorkosUser) {
  const fullName = [workosUser.firstName, workosUser.lastName]
    .filter(Boolean)
    .join(" ")
    .trim()

  if (fullName) return fullName

  const [localPart] = workosUser.email.split("@")
  return localPart || workosUser.email
}

export function UserProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode
  initialUser: UserProfile | null
}) {
  const [user, setUser] = useState<UserProfile | null>(initialUser)
  const [isLoading, setIsLoading] = useState(false)
  const updateProfileMutation = useMutation(api.users.updateProfile)
  const createOrUpdateMutation = useMutation(api.users.createOrUpdate)
  const { user: workosUser, loading: isAuthLoading } = useAuth()
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth()

  const convexUser = useQuery(
    api.users.getCurrent,
    isConvexAuthenticated ? {} : "skip"
  )

  const syncAttemptedRef = useRef<string | null>(null)

  // Sync the first WorkOS session load into Convex for local dev and webhook-free auth.
  useEffect(() => {
    async function syncUserToConvex() {
      if (isAuthLoading || !workosUser || !isConvexAuthenticated) return
      if (syncAttemptedRef.current === workosUser.id) return
      if (convexUser === undefined) return

      if (convexUser !== null) {
        syncAttemptedRef.current = workosUser.id
        return
      }

      syncAttemptedRef.current = workosUser.id

      try {
        await createOrUpdateMutation({
          workosUserId: workosUser.id,
          email: workosUser.email,
          firstName: workosUser.firstName ?? undefined,
          lastName: workosUser.lastName ?? undefined,
          profileImage: workosUser.profilePictureUrl ?? undefined,
          workosUpdatedAt: workosUser.updatedAt,
        })
        console.log("[UserProvider] Synced user to Convex:", workosUser.id)
      } catch (error) {
        console.error("[UserProvider] Failed to sync user to Convex:", error)
        syncAttemptedRef.current = null
      }
    }

    syncUserToConvex()
  }, [
    isAuthLoading,
    workosUser,
    isConvexAuthenticated,
    convexUser,
    createOrUpdateMutation,
  ])

  // Keep app-level user state aligned with WorkOS auth while preserving Convex-managed fields.
  useEffect(() => {
    if (isAuthLoading) return

    if (workosUser) {
      setUser((prevUser) => ({
        id: workosUser.id,
        email: workosUser.email,
        display_name: getDisplayName(workosUser),
        profile_image: workosUser.profilePictureUrl,
        anonymous: false,
        premium: prevUser?.premium ?? null,
        message_count: prevUser?.message_count ?? null,
        daily_message_count: prevUser?.daily_message_count ?? null,
        daily_reset: prevUser?.daily_reset ?? null,
        daily_pro_message_count: prevUser?.daily_pro_message_count ?? null,
        daily_pro_reset: prevUser?.daily_pro_reset ?? null,
        last_active_at: prevUser?.last_active_at ?? null,
        created_at: prevUser?.created_at ?? null,
        favorite_models: prevUser?.favorite_models ?? null,
        system_prompt: prevUser?.system_prompt ?? null,
        preferences: prevUser?.preferences || defaultPreferences,
      }))
    } else {
      setUser(null)
    }
  }, [workosUser, isAuthLoading])

  const updateUser = useCallback(
    async (updates: Partial<UserProfile>) => {
      if (!user?.id) return

      setIsLoading(true)
      try {
        const convexUpdates: { systemPrompt?: string; displayName?: string } =
          {}
        if (updates.system_prompt !== undefined) {
          convexUpdates.systemPrompt = updates.system_prompt ?? undefined
        }
        if (updates.display_name !== undefined) {
          convexUpdates.displayName = updates.display_name
        }

        if (Object.keys(convexUpdates).length > 0) {
          await updateProfileMutation(convexUpdates)
        }

        setUser((prev) => (prev ? { ...prev, ...updates } : null))
      } finally {
        setIsLoading(false)
      }
    },
    [user?.id, updateProfileMutation]
  )

  return (
    <UserContext.Provider value={{ user, isLoading, updateUser }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const context = useContext(UserContext)
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider")
  }
  return context
}
