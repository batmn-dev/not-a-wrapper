"use client"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider } from "posthog-js/react"
import type { ReactNode } from "react"
import { PostHogPageView } from "./posthog-pageview"

export function PostHogProvider({ children }: { children: ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <PostHogPageView />
      {children}
    </PHProvider>
  )
}
