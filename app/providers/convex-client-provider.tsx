"use client"

import { useAccessToken, useAuth } from "@workos-inc/authkit-nextjs/components"
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react"
import { useCallback, type ReactNode } from "react"

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is required")
}

const convex = new ConvexReactClient(convexUrl)

function isAuthKitRefreshFailure(error: unknown) {
  return (
    error instanceof Error && error.message === "Failed to refresh access token"
  )
}

function useAuthFromAuthKit() {
  const { user, loading: isLoading } = useAuth()
  const { getAccessToken, refresh } = useAccessToken()
  const isAuthenticated = !!user

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken?: boolean } = {}) => {
      if (!isAuthenticated) return null

      try {
        const token = forceRefreshToken
          ? await refresh()
          : await getAccessToken()
        return token ?? null
      } catch (error) {
        if (!isAuthKitRefreshFailure(error)) {
          console.error(
            "[ConvexClientProvider] Failed to get access token:",
            error
          )
        }
        return null
      }
    },
    [getAccessToken, isAuthenticated, refresh]
  )

  return {
    isLoading,
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
