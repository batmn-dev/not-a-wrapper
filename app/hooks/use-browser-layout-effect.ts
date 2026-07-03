import { useEffect, useLayoutEffect } from "react"

/**
 * `useLayoutEffect` that degrades to `useEffect` during SSR, where React warns
 * that layout effects cannot run. Use for state syncs that must land before
 * paint (e.g. the Composer's draft-identity adoption, Chat's activity-panel
 * derived-id sync).
 */
export const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect
