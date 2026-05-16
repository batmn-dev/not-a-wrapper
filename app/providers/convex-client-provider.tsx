"use client"

import { useCallback, type ReactNode } from "react"
import { useAuth, useAccessToken } from "@workos-inc/authkit-nextjs/components"
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react"

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

function useAuthFromAuthKit() {
  const { user, loading: isLoading } = useAuth()
  const { getAccessToken, refresh } = useAccessToken()
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
        console.error("[ConvexClientProvider] Failed to get access token:", error)
        return null
      }
    },
    [getAccessToken, refresh, user]
  )

  return { isLoading, isAuthenticated, fetchAccessToken }
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
      {children}
    </ConvexProviderWithAuth>
  )
}
