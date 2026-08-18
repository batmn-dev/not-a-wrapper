"use client"

import { useCallback, useMemo, useSyncExternalStore } from "react"

export const DESIGN_SYSTEM_PINNED_COMPONENTS_STORAGE_KEY =
  "design-system-pinned-components"

const EMPTY_PINNED_COMPONENTS_SNAPSHOT = "[]"

export function parsePinnedComponentSlugs(value: string | null): string[] {
  if (!value) return []

  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []

    return [
      ...new Set(
        parsed.filter((slug): slug is string => typeof slug === "string")
      ),
    ]
  } catch {
    return []
  }
}

function subscribeToPinnedComponents(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === DESIGN_SYSTEM_PINNED_COMPONENTS_STORAGE_KEY) {
      onStoreChange()
    }
  }

  window.addEventListener("storage", handleStorage)
  return () => window.removeEventListener("storage", handleStorage)
}

function getPinnedComponentsSnapshot() {
  return (
    localStorage.getItem(DESIGN_SYSTEM_PINNED_COMPONENTS_STORAGE_KEY) ??
    EMPTY_PINNED_COMPONENTS_SNAPSHOT
  )
}

function getServerPinnedComponentsSnapshot() {
  return EMPTY_PINNED_COMPONENTS_SNAPSHOT
}

export function setStoredPinnedComponentSlugs(slugs: readonly string[]) {
  localStorage.setItem(
    DESIGN_SYSTEM_PINNED_COMPONENTS_STORAGE_KEY,
    JSON.stringify(slugs)
  )
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: DESIGN_SYSTEM_PINNED_COMPONENTS_STORAGE_KEY,
    })
  )
}

/**
 * Browser-local pinning for the development-only design-system registry.
 * New pins are prepended to match the app sidebar's newest-pin-first ordering.
 */
export function usePinnedDesignSystemComponents() {
  const snapshot = useSyncExternalStore(
    subscribeToPinnedComponents,
    getPinnedComponentsSnapshot,
    getServerPinnedComponentsSnapshot
  )
  const pinnedSlugs = useMemo(
    () => parsePinnedComponentSlugs(snapshot),
    [snapshot]
  )

  const togglePinned = useCallback((slug: string) => {
    const current = parsePinnedComponentSlugs(
      localStorage.getItem(DESIGN_SYSTEM_PINNED_COMPONENTS_STORAGE_KEY)
    )
    const next = current.includes(slug)
      ? current.filter((pinnedSlug) => pinnedSlug !== slug)
      : [slug, ...current]

    setStoredPinnedComponentSlugs(next)
  }, [])

  return { pinnedSlugs, togglePinned }
}
