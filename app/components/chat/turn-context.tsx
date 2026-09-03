"use client"

/**
 * Turn context — the per-chat client module owning the inputs every Chat turn
 * kind needs at run time: selected model, web-search enablement, and system
 * prompt. See CONTEXT.md "Turn context".
 *
 * Before this module the same inputs were owned in three layers (session model
 * selection, Chat's orchestration, and the input's pass-through props) and
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
import { useChats } from "@/lib/chat-store/chats/provider"
import type { Chats } from "@/lib/chat-store/types"
import { writeComposerShellHintCookie } from "@/lib/composer-shell-hint"
import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { useModel as useModelStore } from "@/lib/model-store/provider"
import { useSessionModel } from "@/lib/model-store/use-session-model"
import { getLogicalModelInfo } from "@/lib/models"
import type { ModelReasoningEffort, SearchMode } from "@/lib/models/types"
import {
  readStoredEffortForModel,
  subscribeToStoredEffort,
  writeStoredEffortForModel,
} from "@/lib/reasoning-effort"
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
  useSyncExternalStore,
  type ReactNode,
} from "react"

export type TurnSnapshot = {
  selectedModel: string
  systemPrompt: string
  enableSearch: boolean
  /** Per-turn reasoning effort (ADR-0026); undefined = Default. Already
   * clamped to the selected model's available levels. */
  reasoningEffort?: ModelReasoningEffort
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
  searchMode: SearchMode
  /** The selected model's effort menu — the logical union across routes.
   * Empty for models with no per-turn effort knob (control unmounts). */
  effortLevels: readonly ModelReasoningEffort[]
  reasoningEffort: ModelReasoningEffort | undefined
  setReasoningEffort: (effort: ModelReasoningEffort | undefined) => void
  /** ChatInner reports the last assistant message's applied effort here so a
   * reopened conversation restores what actually ran (ADR-0026). */
  reportLastTurnEffort: (effort: ModelReasoningEffort | undefined) => void
  isAuthenticated: boolean
  systemPrompt: string
  isHydrated: boolean
  /** Stable identity for the provider's lifetime; reads the current commit's
   * values at call time. */
  getTurnSnapshot: () => TurnSnapshot
}

const TurnContext = createContext<TurnContextValue | null>(null)

/** Stable empty menu so effortless models don't churn context identity. */
const NO_EFFORT_LEVELS: readonly ModelReasoningEffort[] = []

type EffortOverride = ModelReasoningEffort | "default" | undefined

type ConversationEffortState = {
  effortOverride: EffortOverride
  lastTurnEffort: ModelReasoningEffort | undefined
}

type ConversationEffortStore = {
  activeChatId: string | null
  byChatId: ReadonlyMap<string | null, ConversationEffortState>
}

const EMPTY_CONVERSATION_EFFORT: ConversationEffortState = {
  effortOverride: undefined,
  lastTurnEffort: undefined,
}

function updateConversationEffort(
  store: ConversationEffortStore,
  chatId: string | null,
  update: Partial<ConversationEffortState>
): ConversationEffortStore {
  const previous = store.byChatId.get(chatId) ?? EMPTY_CONVERSATION_EFFORT
  const next = { ...previous, ...update }
  if (
    next.effortOverride === previous.effortOverride &&
    next.lastTurnEffort === previous.lastTurnEffort
  ) {
    return store
  }

  const byChatId = new Map(store.byChatId)
  byChatId.set(chatId, next)
  return { ...store, byChatId }
}

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
  preserveEffortOnChatIdChange = false,
  children,
}: {
  chatId: string | null
  currentChat: Chats | null
  isChatLoading?: boolean
  preserveEffortOnChatIdChange?: boolean
  children: ReactNode
}) {
  const { user } = useUser()
  const { updateChatModel } = useChats()
  const {
    preferences,
    setWebSearchEnabled,
    isLoading: preferencesLoading,
  } = useUserPreferences()
  const { modelPrefsHydrated, lastUsedModel, shellHint } = useModelStore()

  const { selectedModel, handleModelChange } = useSessionModel({
    currentChat,
    user,
    updateChatModel,
    chatId,
    isChatLoading,
  })

  // An authenticated preference is unknown until its Convex read settles.
  // Keep capability UI inactive during that window instead of briefly
  // projecting the product default as if the user selected Web search.
  const modelInfo = getLogicalModelInfo(selectedModel)
  const searchMode = modelInfo?.searchMode ?? "unsupported"

  // Per-turn reasoning effort (ADR-0026). The raw selection persists across
  // model switches; the EFFECTIVE value clamps to the selected model's level
  // menu, so switching to a model without the level snaps to Default (and
  // back, if the user returns) rather than sending an unsupported value.
  const effortLevels = modelInfo?.effortLevels ?? NO_EFFORT_LEVELS
  // Resolution order (ADR-0026, first hit wins): the user's in-conversation
  // selection ("default" = an explicit Default that beats the fallbacks) →
  // the last assistant turn's applied effort (reported by ChatInner, so a
  // reopened chat restores what actually ran) → the per-model device memory
  // → Default. The effective value then clamps to the model's level menu, so
  // switching models keeps a supported level and snaps to Default otherwise.
  const [conversationEfforts, setConversationEfforts] =
    useState<ConversationEffortStore>(() => ({
      activeChatId: chatId,
      byChatId: new Map(),
    }))

  // Keep effort at the conversation boundary: real chat switches select
  // separate state, while null → id moves the new
  // conversation's state across its first-turn route handoff.
  if (conversationEfforts.activeChatId !== chatId) {
    const byChatId = new Map(conversationEfforts.byChatId)
    if (conversationEfforts.activeChatId === null && chatId !== null) {
      const newConversationEffort = byChatId.get(null)
      byChatId.delete(null)
      if (preserveEffortOnChatIdChange && newConversationEffort) {
        byChatId.set(chatId, newConversationEffort)
      }
    }
    setConversationEfforts({ activeChatId: chatId, byChatId })
  }

  const { effortOverride, lastTurnEffort } =
    conversationEfforts.byChatId.get(chatId) ?? EMPTY_CONVERSATION_EFFORT
  const reportLastTurnEffort = useCallback(
    (effort: ModelReasoningEffort | undefined) => {
      setConversationEfforts((current) =>
        updateConversationEffort(current, chatId, {
          lastTurnEffort: effort,
        })
      )
    },
    [chatId, setConversationEfforts]
  )
  // Device memory read synchronously during render: a model switch sees the
  // new model's stored level in the SAME render, so a snapshot taken between
  // switch and paint can never carry the previous model's value. The server
  // snapshot is the Composer shell hint's effort when the shell resolved to
  // the hinted model (ADR-0032), so the server-rendered label already matches
  // what device memory reads after hydration; React re-renders only if the
  // live read genuinely differs. The 'storage' subscription folds in
  // cross-tab writes, and same-tab writes re-render via the override state.
  const storedEffort = useSyncExternalStore(
    subscribeToStoredEffort,
    () => readStoredEffortForModel(selectedModel),
    () => (selectedModel === shellHint?.modelId ? shellHint.effort : undefined)
  )
  const effortCandidate =
    effortOverride === "default"
      ? undefined
      : (effortOverride ?? lastTurnEffort ?? storedEffort)
  const reasoningEffort =
    effortCandidate !== undefined && effortLevels.includes(effortCandidate)
      ? effortCandidate
      : undefined
  const setReasoningEffort = useCallback(
    (effort: ModelReasoningEffort | undefined) => {
      setConversationEfforts((current) =>
        updateConversationEffort(current, chatId, {
          effortOverride: effort ?? "default",
        })
      )
      writeStoredEffortForModel(selectedModel, effort)
      // The shell hint mirrors the last-used model's effort (ADR-0032): keep
      // it current when this selection is for that model.
      if (selectedModel === lastUsedModel) {
        writeComposerShellHintCookie(
          effort === undefined
            ? { modelId: selectedModel }
            : { modelId: selectedModel, effort }
        )
      }
    },
    [chatId, lastUsedModel, selectedModel, setConversationEfforts]
  )
  const prefersSearch =
    !preferencesLoading && resolveWebSearchEnabled(preferences.webSearchEnabled)
  const enableSearch =
    searchMode === "always-on" || (searchMode === "optional" && prefersSearch)
  const setEnableSearch = useCallback(
    (enabled: boolean) => {
      if (searchMode !== "optional") return
      setWebSearchEnabled(enabled)
    },
    [searchMode, setWebSearchEnabled]
  )

  const isAuthenticated = !!user?.id
  const systemPrompt = user?.system_prompt || SYSTEM_PROMPT_DEFAULT
  // Every async-hydrating input a turn snapshot reads: model prefs
  // (selectedModel; the catalog itself is static) and user preferences
  // (enableSearch). The user store is SSR-seeded (systemPrompt has no async
  // gap), and preferencesLoading is false for guests, so the gate cannot
  // deadlock unauthenticated loads.
  const isHydrated = modelPrefsHydrated && !preferencesLoading && !isChatLoading

  const snapshot: TurnSnapshot = {
    selectedModel,
    systemPrompt,
    enableSearch,
    reasoningEffort,
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
      searchMode,
      effortLevels,
      reasoningEffort,
      setReasoningEffort,
      reportLastTurnEffort,
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
      searchMode,
      effortLevels,
      reasoningEffort,
      setReasoningEffort,
      reportLastTurnEffort,
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
