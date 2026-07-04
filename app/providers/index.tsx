"use client"

import type { NoUserInfo, UserInfo } from "@workos-inc/authkit-nextjs"
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components"
import { ReactNode } from "react"
import { ConvexClientProvider } from "./convex-client-provider"
import { PostHogProvider } from "./posthog-provider"

type ProvidersProps = {
  children: ReactNode
  initialAuth: Omit<UserInfo | NoUserInfo, "accessToken">
}

export function Providers({ children, initialAuth }: ProvidersProps) {
  return (
    <AuthKitProvider initialAuth={initialAuth}>
      <PostHogProvider>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </PostHogProvider>
    </AuthKitProvider>
  )
}
