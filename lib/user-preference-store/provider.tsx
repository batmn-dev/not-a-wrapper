"use client"

import { api } from "@/convex/_generated/api"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { useMutation as useConvexMutation } from "convex/react"
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import {
  convertFromApiFormat,
  convertToApiFormat,
  defaultPreferences,
  type LayoutType,
  type UserPreferences,
} from "./utils"

export {
  type LayoutType,
  type UserPreferences,
  convertFromApiFormat,
  convertToApiFormat,
}

const PREFERENCES_STORAGE_KEY = "user-preferences"
const LAYOUT_STORAGE_KEY = "preferred-layout"
const PREFERENCES_CHANGE_EVENT = "user-preferences-change"

let localPreferencesSnapshotKey: string | null = null
let localPreferencesSnapshot: UserPreferences = defaultPreferences

type UserPreferencesContextType = {
  preferences: UserPreferences
  setLayout: (layout: LayoutType) => void
  setPromptSuggestions: (enabled: boolean) => void
  setShowToolInvocations: (enabled: boolean) => void
  setShowConversationPreviews: (enabled: boolean) => void
  setWebSearchEnabled: (enabled: boolean) => void
  toggleModelVisibility: (modelId: string) => void
  isModelHidden: (modelId: string) => boolean
  isLoading: boolean
}

const UserPreferencesContext = createContext<
  UserPreferencesContextType | undefined
>(undefined)

function getLocalStoragePreferences(): UserPreferences {
  if (typeof window === "undefined") return defaultPreferences

  const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY)
  const layout = localStorage.getItem(LAYOUT_STORAGE_KEY) as LayoutType | null
  const snapshotKey = JSON.stringify([stored, layout])

  if (snapshotKey === localPreferencesSnapshotKey) {
    return localPreferencesSnapshot
  }

  localPreferencesSnapshotKey = snapshotKey

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<UserPreferences>
      localPreferencesSnapshot = { ...defaultPreferences, ...parsed }
      return localPreferencesSnapshot
    } catch {
      // fallback to legacy layout storage if JSON parsing fails
    }
  }

  localPreferencesSnapshot = {
    ...defaultPreferences,
    ...(layout ? { layout } : {}),
  }
  return localPreferencesSnapshot
}

function saveToLocalStorage(preferences: UserPreferences) {
  if (typeof window === "undefined") return

  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  localStorage.setItem(LAYOUT_STORAGE_KEY, preferences.layout)
  window.dispatchEvent(new Event(PREFERENCES_CHANGE_EVENT))
}

function subscribeLocalStoragePreferences(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {}

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === PREFERENCES_STORAGE_KEY ||
      event.key === LAYOUT_STORAGE_KEY
    ) {
      onStoreChange()
    }
  }

  window.addEventListener("storage", handleStorage)
  window.addEventListener(PREFERENCES_CHANGE_EVENT, onStoreChange)

  return () => {
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener(PREFERENCES_CHANGE_EVENT, onStoreChange)
  }
}

export function UserPreferencesProvider({
  children,
  userId,
  initialPreferences,
}: {
  children: ReactNode
  userId?: string
  initialPreferences?: UserPreferences
}) {
  // `isAuthenticated` (WorkOS presence) selects the localStorage-vs-server
  // branch below. The live subscription itself is gated on Convex auth readiness
  // by the Per-user subscription seam, not on WorkOS presence — so it never
  // executes a wrong-empty read during the auth-sync window.
  const isAuthenticated = !!userId

  // Convex real-time query for authenticated users
  const { data: convexPreferences } = usePerUserQuery(api.userPreferences.get)

  // Convex mutation for updating preferences
  const updatePreferencesMutation = useConvexMutation(
    api.userPreferences.update
  )

  // Track optimistic updates (pending changes)
  const [optimisticUpdates, setOptimisticUpdates] = useState<
    Partial<UserPreferences>
  >({})

  // Derive server preferences from Convex data
  const serverPreferences: UserPreferences = useMemo(() => {
    if (convexPreferences && isAuthenticated) {
      return {
        layout:
          (convexPreferences.layout as LayoutType) || defaultPreferences.layout,
        promptSuggestions:
          convexPreferences.promptSuggestions ??
          defaultPreferences.promptSuggestions,
        showToolInvocations:
          convexPreferences.showToolInvocations ??
          defaultPreferences.showToolInvocations,
        showConversationPreviews:
          convexPreferences.showConversationPreviews ??
          defaultPreferences.showConversationPreviews,
        webSearchEnabled:
          convexPreferences.webSearchEnabled ??
          defaultPreferences.webSearchEnabled,
        hiddenModels:
          convexPreferences.hiddenModels ?? defaultPreferences.hiddenModels,
      }
    }
    return defaultPreferences
  }, [convexPreferences, isAuthenticated])

  // For unauthenticated users, use localStorage
  const localStoragePrefs = useSyncExternalStore(
    subscribeLocalStoragePreferences,
    getLocalStoragePreferences,
    () => initialPreferences || defaultPreferences
  )

  // Derive final preferences: server data + optimistic updates (for authenticated)
  // or localStorage prefs (for unauthenticated)
  const preferences = useMemo(() => {
    if (isAuthenticated) {
      return { ...serverPreferences, ...optimisticUpdates }
    }
    return localStoragePrefs
  }, [isAuthenticated, serverPreferences, optimisticUpdates, localStoragePrefs])

  const isLoading = isAuthenticated && convexPreferences === undefined

  // Update preferences handler
  const updatePreferences = useCallback(
    async (update: Partial<UserPreferences>) => {
      if (!isAuthenticated) {
        // For unauthenticated users, update localStorage directly
        const updated = { ...localStoragePrefs, ...update }
        saveToLocalStorage(updated)
        return
      }

      // For authenticated users, use optimistic updates
      setOptimisticUpdates((prev) => ({ ...prev, ...update }))

      try {
        // Persist to Convex for authenticated users
        await updatePreferencesMutation(update)
        // Clear optimistic update on success (server data will reflect the change)
        setOptimisticUpdates((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(update)) {
            delete next[key as keyof UserPreferences]
          }
          return next
        })
      } catch (error) {
        console.error("Failed to update user preferences in Convex:", error)
        // Revert optimistic update on error
        setOptimisticUpdates((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(update)) {
            delete next[key as keyof UserPreferences]
          }
          return next
        })
      }
    },
    [isAuthenticated, localStoragePrefs, updatePreferencesMutation]
  )

  const setLayout = useCallback(
    (layout: LayoutType) => {
      if (isAuthenticated || layout === "fullscreen") {
        updatePreferences({ layout })
      }
    },
    [isAuthenticated, updatePreferences]
  )

  const setPromptSuggestions = useCallback(
    (enabled: boolean) => {
      updatePreferences({ promptSuggestions: enabled })
    },
    [updatePreferences]
  )

  const setShowToolInvocations = useCallback(
    (enabled: boolean) => {
      updatePreferences({ showToolInvocations: enabled })
    },
    [updatePreferences]
  )

  const setShowConversationPreviews = useCallback(
    (enabled: boolean) => {
      updatePreferences({ showConversationPreviews: enabled })
    },
    [updatePreferences]
  )

  const setWebSearchEnabled = useCallback(
    (enabled: boolean) => {
      updatePreferences({ webSearchEnabled: enabled })
    },
    [updatePreferences]
  )

  const toggleModelVisibility = useCallback(
    (modelId: string) => {
      const currentHidden = preferences.hiddenModels || []
      const isHidden = currentHidden.includes(modelId)
      const newHidden = isHidden
        ? currentHidden.filter((id) => id !== modelId)
        : [...currentHidden, modelId]

      updatePreferences({ hiddenModels: newHidden })
    },
    [preferences.hiddenModels, updatePreferences]
  )

  const isModelHidden = useCallback(
    (modelId: string) => {
      return (preferences.hiddenModels || []).includes(modelId)
    },
    [preferences.hiddenModels]
  )

  return (
    <UserPreferencesContext.Provider
      value={{
        preferences,
        setLayout,
        setPromptSuggestions,
        setShowToolInvocations,
        setShowConversationPreviews,
        setWebSearchEnabled,
        toggleModelVisibility,
        isModelHidden,
        isLoading,
      }}
    >
      {children}
    </UserPreferencesContext.Provider>
  )
}

export function useUserPreferences() {
  const context = useContext(UserPreferencesContext)
  if (!context) {
    throw new Error(
      "useUserPreferences must be used within UserPreferencesProvider"
    )
  }
  return context
}
