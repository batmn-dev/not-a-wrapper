"use client"

import { useAccessToken, useAuth } from "@workos-inc/authkit-nextjs/components"
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react"
import { useCallback, type ReactNode } from "react"

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is required")
}

const convex = new ConvexReactClient(convexUrl)

function useAuthFromAuthKit() {
  const { user, loading: isLoading } = useAuth()
  const {
    getAccessToken,
    loading: isAccessTokenLoading,
    refresh,
  } = useAccessToken()
  const isAuthenticated = !!user

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken?: boolean } = {}) => {
      if (!user) return null

      try {
        const token = forceRefreshToken
          ? await refresh()
          : await getAccessToken()
        return token ?? null
      } catch (error) {
        console.error(
          "[ConvexClientProvider] Failed to get access token:",
          error
        )
        return null
      }
    },
    [getAccessToken, refresh, user]
  )

  return {
    isLoading: isLoading || (isAuthenticated && isAccessTokenLoading),
    isAuthenticated,
    fetchAccessToken,
  }
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
      {children}
    </ConvexProviderWithAuth>
  )
}
