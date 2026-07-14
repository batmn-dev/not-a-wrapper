"use client"

/**
 * Turn context — the per-chat client module owning the inputs every Chat turn
 * kind needs at run time: selected model, web-search enablement, and system
 * prompt. See CONTEXT.md "Turn context".
 *
 * Before this module the same inputs were owned in three layers (the useModel
 * hook's logic, Chat's orchestration, and the input's pass-through props) and
 * captured in submit-callback closures — so the model shown in the picker and
 * the model a stale closure submitted could diverge, and the `?prompt=`
 * auto-submit could fire before model prefs hydrated and send to the tier
 * default.
 *
 * Two read paths:
 *  - `useTurnContext()` — reactive values for UI (the Composer's picker and
 *    search toggle render from these).
 *  - `getTurnSnapshot()` — a STABLE getter turn runners call at run time, so
 *    the values are read when the turn executes, never when a closure was
 *    created. The backing store is synced with `useInsertionEffect`, which
 *    runs for the whole commit before any component's passive effects — so
 *    even an effect-driven turn (the `?prompt=` auto-submit) reads the values
 *    of its own commit, not the previous one.
 */
import { useModel } from "@/app/components/chat/use-model"
import { useChats } from "@/lib/chat-store/chats/provider"
import type { Chats } from "@/lib/chat-store/types"
import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { useModel as useModelStore } from "@/lib/model-store/provider"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { resolveWebSearchEnabled } from "@/lib/user-preference-store/web-search"
import { useUser } from "@/lib/user-store/provider"
import {
  createContext,
  useCallback,
  useContext,
  useInsertionEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type TurnSnapshot = {
  selectedModel: string
  systemPrompt: string
  enableSearch: boolean
  isAuthenticated: boolean
  /** Model preferences, model catalog, and user preferences are ready —
   * auto-submit must wait for this. */
  isHydrated: boolean
}

export type TurnContextValue = {
  selectedModel: string
  handleModelChange: (modelId: string) => Promise<void> | void
  enableSearch: boolean
  setEnableSearch: (enabled: boolean) => void
  isAuthenticated: boolean
  systemPrompt: string
  isHydrated: boolean
  /** Stable identity for the provider's lifetime; reads the current commit's
   * values at call time. */
  getTurnSnapshot: () => TurnSnapshot
}

const TurnContext = createContext<TurnContextValue | null>(null)

function createSnapshotStore(initial: TurnSnapshot) {
  let current = initial
  return {
    get: () => current,
    set: (next: TurnSnapshot) => {
      current = next
    },
  }
}

export function TurnContextProvider({
  chatId,
  currentChat,
  isChatLoading = false,
  children,
}: {
  chatId: string | null
  currentChat: Chats | null
  isChatLoading?: boolean
  children: ReactNode
}) {
  const { user } = useUser()
  const { updateChatModel } = useChats()
  const {
    preferences,
    setWebSearchEnabled,
    isLoading: preferencesLoading,
  } = useUserPreferences()
  const { modelPrefsHydrated, isLoading: modelStoreLoading } = useModelStore()

  const { selectedModel, handleModelChange } = useModel({
    currentChat,
    user,
    updateChatModel,
    chatId,
    isChatLoading,
  })

  const enableSearch = resolveWebSearchEnabled(preferences.webSearchEnabled)
  const setEnableSearch = useCallback(
    (enabled: boolean) => {
      setWebSearchEnabled(enabled)
    },
    [setWebSearchEnabled]
  )

  const isAuthenticated = !!user?.id
  const systemPrompt = user?.system_prompt || SYSTEM_PROMPT_DEFAULT
  // Every async-hydrating input a turn snapshot reads: model prefs + catalog
  // (selectedModel) and user preferences (enableSearch). The user store is
  // SSR-seeded (systemPrompt has no async gap), and preferencesLoading is
  // false for guests, so the gate cannot deadlock unauthenticated loads.
  const isHydrated =
    modelPrefsHydrated &&
    !modelStoreLoading &&
    !preferencesLoading &&
    !isChatLoading

  const snapshot: TurnSnapshot = {
    selectedModel,
    systemPrompt,
    enableSearch,
    isAuthenticated,
    isHydrated,
  }

  // Initialized with the first render's values, then kept current from
  // useInsertionEffect: insertion effects for the whole tree run before ANY
  // passive effect of the same commit, so an effect-driven turn in a child
  // (the ?prompt= auto-submit) never reads a previous commit's snapshot.
  const [snapshotStore] = useState(() => createSnapshotStore(snapshot))
  useInsertionEffect(() => {
    snapshotStore.set(snapshot)
  })
  const getTurnSnapshot = snapshotStore.get

  const value = useMemo<TurnContextValue>(
    () => ({
      selectedModel,
      handleModelChange,
      enableSearch,
      setEnableSearch,
      isAuthenticated,
      systemPrompt,
      isHydrated,
      getTurnSnapshot,
    }),
    [
      selectedModel,
      handleModelChange,
      enableSearch,
      setEnableSearch,
      isAuthenticated,
      systemPrompt,
      isHydrated,
      getTurnSnapshot,
    ]
  )

  return <TurnContext.Provider value={value}>{children}</TurnContext.Provider>
}

export function useTurnContext(): TurnContextValue {
  const context = useContext(TurnContext)
  if (!context) {
    throw new Error("useTurnContext must be used within a TurnContextProvider")
  }
  return context
}
