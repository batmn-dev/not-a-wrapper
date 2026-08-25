/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  TurnContextProvider,
  useTurnContext,
  type TurnSnapshot,
} from "./turn-context"

// Controllable provider inputs.
const turnMocks = vi.hoisted(() => ({
  selectedModel: "model-a",
  modelPrefsHydrated: true,
  modelStoreLoading: false,
  preferencesLoading: false,
  isChatLoading: false,
  searchMode: "optional" as "optional" | "always-on" | "unsupported",
  setWebSearchEnabled: vi.fn(),
}))

vi.mock("@/lib/models", () => ({
  getLogicalModelInfo: () => ({ searchMode: turnMocks.searchMode }),
}))

vi.mock("@/lib/user-store/provider", () => ({
  useUser: () => ({ user: { id: "user-1", system_prompt: "sp" } }),
}))

vi.mock("@/lib/chat-store/chats/provider", () => ({
  useChats: () => ({ updateChatModel: vi.fn() }),
}))

vi.mock("@/lib/user-preference-store/provider", () => ({
  useUserPreferences: () => ({
    preferences: { webSearchEnabled: true },
    setWebSearchEnabled: turnMocks.setWebSearchEnabled,
    isLoading: turnMocks.preferencesLoading,
  }),
}))

vi.mock("@/lib/model-store/provider", () => ({
  useModel: () => ({
    modelPrefsHydrated: turnMocks.modelPrefsHydrated,
    isLoading: turnMocks.modelStoreLoading,
  }),
}))

vi.mock("@/lib/model-store/use-session-model", () => ({
  useSessionModel: () => ({
    selectedModel: turnMocks.selectedModel,
    handleModelChange: vi.fn(),
  }),
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("TurnContextProvider snapshot contract", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    const mounted = root
    if (mounted) act(() => mounted.unmount())
    container?.remove()
    container = null
    root = null
    turnMocks.searchMode = "optional"
    turnMocks.setWebSearchEnabled.mockClear()
  })

  it("forces inherent search on without overwriting the optional preference", () => {
    const contexts: Array<ReturnType<typeof useTurnContext>> = []
    function Probe() {
      contexts.push(useTurnContext())
      return null
    }

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    turnMocks.preferencesLoading = false
    turnMocks.searchMode = "always-on"

    act(() => {
      root?.render(
        <TurnContextProvider chatId={null} currentChat={null}>
          <Probe />
        </TurnContextProvider>
      )
    })

    expect(contexts.at(-1)?.enableSearch).toBe(true)
    act(() => contexts.at(-1)?.setEnableSearch(false))
    expect(turnMocks.setWebSearchEnabled).not.toHaveBeenCalled()
  })

  it("getTurnSnapshot is identity-stable and commit-fresh, including from a child's passive effect", () => {
    // The whole reason the module exists: turn runners hold ONE getter for the
    // provider's lifetime, and reading it — even from a child effect on the
    // very commit a value changed (the ?prompt= auto-submit path) — yields
    // that commit's values, never the previous one.
    const seen: Array<{
      snapshot: TurnSnapshot
      getter: () => TurnSnapshot
      reactiveHydrated: boolean
    }> = []

    function Probe() {
      const { getTurnSnapshot, isHydrated } = useTurnContext()
      // Passive effect read on every commit — the hardest consumer.
      React.useEffect(() => {
        seen.push({
          snapshot: getTurnSnapshot(),
          getter: getTurnSnapshot,
          reactiveHydrated: isHydrated,
        })
      })
      return null
    }

    function mount() {
      act(() => {
        root?.render(
          <TurnContextProvider
            chatId={null}
            currentChat={null}
            isChatLoading={turnMocks.isChatLoading}
          >
            <Probe />
          </TurnContextProvider>
        )
      })
    }

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    turnMocks.selectedModel = "model-a"
    turnMocks.modelPrefsHydrated = false
    turnMocks.modelStoreLoading = true
    turnMocks.preferencesLoading = true
    turnMocks.isChatLoading = true
    mount()

    expect(seen.at(-1)?.snapshot.selectedModel).toBe("model-a")
    expect(seen.at(-1)?.snapshot.enableSearch).toBe(false)
    expect(seen.at(-1)?.snapshot.isHydrated).toBe(false)
    expect(seen.at(-1)?.reactiveHydrated).toBe(false)

    // Browser prefs can hydrate before the model catalog settles; this must
    // still keep auto-submit closed.
    turnMocks.modelPrefsHydrated = true
    mount()

    expect(seen.at(-1)?.snapshot.isHydrated).toBe(false)
    expect(seen.at(-1)?.reactiveHydrated).toBe(false)

    // The model side can settle before the user-preference read (enableSearch)
    // resolves — auto-submit must also wait for that.
    turnMocks.selectedModel = "model-b"
    turnMocks.modelStoreLoading = false
    mount()

    expect(seen.at(-1)?.snapshot.isHydrated).toBe(false)
    expect(seen.at(-1)?.reactiveHydrated).toBe(false)

    // Every async-hydrating snapshot input settled: submit-safe.
    turnMocks.preferencesLoading = false
    mount()

    expect(seen.at(-1)?.snapshot.isHydrated).toBe(false)
    expect(seen.at(-1)?.reactiveHydrated).toBe(false)

    // An out-of-window chat can resolve after the catalog and preferences.
    // Auto-submit must still wait for its persisted model.
    turnMocks.isChatLoading = false
    mount()

    const last = seen.at(-1)
    expect(last?.snapshot.selectedModel).toBe("model-b")
    expect(last?.snapshot.isHydrated).toBe(true)
    expect(last?.reactiveHydrated).toBe(true)
    expect(last?.snapshot.systemPrompt).toBe("sp")
    expect(last?.snapshot.enableSearch).toBe(true)
    // Same getter identity across commits — safe to hold in a closure forever.
    expect(last?.getter).toBe(seen[0]?.getter)
  })
})
