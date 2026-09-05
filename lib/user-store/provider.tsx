/**
 * User Provider
 *
 * Provides user context throughout the application. Identity comes from WorkOS
 * AuthKit, while app-specific fields are stored in Convex.
 */
"use client"

import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { noteChatAccountReadiness } from "@/lib/observability/chat-ui-events"
import { defaultPreferences } from "@/lib/user-preference-store/utils"
import type { UserProfile } from "@/lib/user/types"
import { useAuth } from "@workos-inc/authkit-nextjs/components"
import type { User as WorkosUser } from "@workos-inc/node"
import { useConvexAuth, useMutation } from "convex/react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react"
import { toast as sonnerToast } from "sonner"
import { mergeUserProfileWithConvexFields } from "./merge-user-profile"

type UserContextType = {
  user: UserProfile | null
  isLoading: boolean
  /** Signed-in chat mutations require the bootstrapped row for this identity. */
  isChatAdmissionReady: boolean
  updateUser: (updates: Partial<UserProfile>) => Promise<void>
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
}: PropsWithChildren<{
  initialUser: UserProfile | null
}>) {
  const [user, setUser] = useState<UserProfile | null>(initialUser)
  const [isLoading, setIsLoading] = useState(false)
  const updateProfileMutation = useMutation(api.users.updateProfile)
  const createOrUpdateMutation = useMutation(api.users.createOrUpdate)
  const { user: workosUser, loading: isAuthLoading } = useAuth()
  const {
    isAuthenticated: isConvexAuthenticated,
    isLoading: isConvexAuthLoading,
  } = useConvexAuth()

  const { data: convexUser } = usePerUserQuery(api.users.getCurrent)

  const [bootstrapRetry, setBootstrapRetry] = useState(0)
  const bootstrapRequestRef = useRef<{
    userId: string
    retry: number
    result: Promise<void>
  } | null>(null)
  // The HTTP upload commits before returning, but its Convex subscription
  // update can arrive after the client applies the returned URL. Key pending
  // images by user so late callbacks cannot replace another session's handoff.
  const pendingProfileImagesRef = useRef(new Map<string, string>())
  // Async upload handlers can resume with an updateUser function from an older
  // render, so confirmation checks read the latest committed subscription.
  const convexUserRef = useRef(convexUser)

  // Sync the first WorkOS session load into Convex for local dev and webhook-free auth.
  useEffect(() => {
    if (isAuthLoading || !workosUser || !isConvexAuthenticated) return
    // A stale row from the previous account must not consume this identity's
    // attempt. Wait for its own query result; admission requires an exact match.
    if (convexUser !== null) return

    let active = true
    let errorToastId: ReturnType<typeof toast> | undefined
    let request = bootstrapRequestRef.current
    if (request?.userId !== workosUser.id || request.retry !== bootstrapRetry) {
      request = {
        userId: workosUser.id,
        retry: bootstrapRetry,
        result: (async () => {
          await createOrUpdateMutation({
            workosUserId: workosUser.id,
            email: workosUser.email,
            firstName: workosUser.firstName ?? undefined,
            lastName: workosUser.lastName ?? undefined,
            profileImage: workosUser.profilePictureUrl ?? undefined,
            workosUpdatedAt: workosUser.updatedAt,
          })
        })(),
      }
      bootstrapRequestRef.current = request
    }
    // Convex reconnects pending mutations itself. Rejected mutations need an
    // explicit retry; sharing the promise prevents duplicate setup on effect replays.
    void request.result.catch((error) => {
      if (active) {
        console.error("[UserProvider] Failed to sync user to Convex:", error)
        errorToastId = toast({
          title: "Couldn't finish account setup",
          status: "error",
          duration: Infinity,
          button: {
            label: "Retry",
            onClick: () => {
              if (active) setBootstrapRetry((retry) => retry + 1)
            },
          },
        })
      }
    })

    return () => {
      active = false
      if (errorToastId !== undefined) sonnerToast.dismiss(errorToastId)
    }
  }, [
    isAuthLoading,
    workosUser,
    isConvexAuthenticated,
    convexUser,
    createOrUpdateMutation,
    bootstrapRetry,
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

  useEffect(() => {
    if (isAuthLoading || !workosUser) return
    if (convexUser === undefined) return
    convexUserRef.current = convexUser

    const pendingProfileImageUrl = pendingProfileImagesRef.current.get(
      workosUser.id
    )
    if (
      pendingProfileImageUrl !== undefined &&
      convexUser?.profileImageOverride === pendingProfileImageUrl
    ) {
      pendingProfileImagesRef.current.delete(workosUser.id)
    }

    setUser((prevUser) =>
      mergeUserProfileWithConvexFields(
        prevUser,
        convexUser,
        pendingProfileImageUrl
      )
    )
  }, [convexUser, isAuthLoading, workosUser])

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

        if (
          typeof updates.profile_image === "string" &&
          (convexUserRef.current?.workosUserId !== user.id ||
            convexUserRef.current.profileImageOverride !==
              updates.profile_image)
        ) {
          pendingProfileImagesRef.current.set(user.id, updates.profile_image)
        }

        setUser((prev) =>
          prev?.id === user.id ? { ...prev, ...updates } : prev
        )
      } finally {
        setIsLoading(false)
      }
    },
    [user?.id, updateProfileMutation]
  )

  const isChatAdmissionReady =
    !isAuthLoading &&
    (user?.id
      ? workosUser?.id === user.id &&
        isConvexAuthenticated &&
        convexUser?.workosUserId === user.id
      : !workosUser && !isConvexAuthLoading && !isConvexAuthenticated)

  // Publish committed state before the external frame observer can sample it.
  useLayoutEffect(() => {
    noteChatAccountReadiness(isChatAdmissionReady)
    return () => noteChatAccountReadiness(undefined)
  }, [isChatAdmissionReady])

  return (
    <UserContext.Provider value={{ user, isLoading, isChatAdmissionReady, updateUser }}>
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
