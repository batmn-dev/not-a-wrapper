"use client"

import { api } from "@/convex/_generated/api"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { setStreamingDecayEnabled } from "@/lib/markdown/streaming-decay-overlay"
import { useMutation as useConvexMutation } from "convex/react"
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import {
  convertFromApiFormat,
  convertToApiFormat,
  defaultPreferences,
  normalizeHiddenModels,
  normalizeStreamingPresentation,
  type LayoutType,
  type StreamingPresentation,
  type UserPreferences,
} from "./utils"

export {
  type LayoutType,
  type StreamingPresentation,
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
  setStreamingPresentation: (presentation: StreamingPresentation) => void
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
      localPreferencesSnapshot = {
        ...defaultPreferences,
        ...parsed,
        // Stored JSON is unvalidated: normalize here so a legacy/corrupted
        // value never reaches the typed TurnSnapshot or the wire.
        streamingPresentation: normalizeStreamingPresentation(
          parsed.streamingPresentation
        ),
      }
      return localPreferencesSnapshot
    } catch {
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

  const { data: convexPreferences } = usePerUserQuery(api.userPreferences.get)

  const updatePreferencesMutation = useConvexMutation(
    api.userPreferences.update
  )

  const [optimisticUpdates, setOptimisticUpdates] = useState<
    Partial<UserPreferences>
  >({})

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
        streamingPresentation: normalizeStreamingPresentation(
          convexPreferences.streamingPresentation
        ),
        hiddenModels:
          convexPreferences.hiddenModels ?? defaultPreferences.hiddenModels,
      }
    }
    return defaultPreferences
  }, [convexPreferences, isAuthenticated])

  const localStoragePrefs = useSyncExternalStore(
    subscribeLocalStoragePreferences,
    getLocalStoragePreferences,
    () => initialPreferences || defaultPreferences
  )

  const preferences = useMemo(() => {
    const currentPreferences = isAuthenticated
      ? { ...serverPreferences, ...optimisticUpdates }
      : localStoragePrefs

    return {
      ...currentPreferences,
      hiddenModels: normalizeHiddenModels(currentPreferences.hiddenModels),
    }
  }, [isAuthenticated, serverPreferences, optimisticUpdates, localStoragePrefs])

  const isLoading = isAuthenticated && convexPreferences === undefined

  const updatePreferences = useCallback(
    async (update: Partial<UserPreferences>) => {
      if (!isAuthenticated) {
        const updated = { ...localStoragePrefs, ...update }
        saveToLocalStorage(updated)
        return
      }

      setOptimisticUpdates((prev) => ({ ...prev, ...update }))

      try {
        await updatePreferencesMutation(update)
        setOptimisticUpdates((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(update)) {
            delete next[key as keyof UserPreferences]
          }
          return next
        })
      } catch (error) {
        console.error("Failed to update user preferences in Convex:", error)
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

  const setStreamingPresentation = useCallback(
    (presentation: StreamingPresentation) => {
      updatePreferences({ streamingPresentation: presentation })
    },
    [updatePreferences]
  )

  // Centralized sync for the paint-only decay overlay: one effect keyed on
  // the resolved preference keeps every Markdown consumer on one switch —
  // app load, settings toggle, cross-tab localStorage change, and Convex
  // updates from another device all land here. Flipping to "quick" clears
  // live tint immediately (see setStreamingDecayEnabled).
  useEffect(() => {
    setStreamingDecayEnabled(preferences.streamingPresentation !== "quick")
  }, [preferences.streamingPresentation])

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
        setStreamingPresentation,
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
