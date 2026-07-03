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
    setWebSearchEnabled: vi.fn(),
  }),
}))

vi.mock("@/lib/model-store/provider", () => ({
  useModel: () => ({ modelPrefsHydrated: turnMocks.modelPrefsHydrated }),
}))

vi.mock("@/app/components/chat/use-model", () => ({
  useModel: () => ({
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
  })

  it("getTurnSnapshot is identity-stable and commit-fresh, including from a child's passive effect", () => {
    // The whole reason the module exists: turn runners hold ONE getter for the
    // provider's lifetime, and reading it — even from a child effect on the
    // very commit a value changed (the ?prompt= auto-submit path) — yields
    // that commit's values, never the previous one.
    const seen: Array<{ snapshot: TurnSnapshot; getter: () => TurnSnapshot }> =
      []

    function Probe() {
      const { getTurnSnapshot } = useTurnContext()
      // Passive effect read on every commit — the hardest consumer.
      React.useEffect(() => {
        seen.push({ snapshot: getTurnSnapshot(), getter: getTurnSnapshot })
      })
      return null
    }

    function mount() {
      act(() => {
        root?.render(
          <TurnContextProvider chatId={null} currentChat={null}>
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
    mount()

    expect(seen.at(-1)?.snapshot.selectedModel).toBe("model-a")
    expect(seen.at(-1)?.snapshot.isHydrated).toBe(false)

    // Hydration completes and the resolved model changes in one commit.
    turnMocks.selectedModel = "model-b"
    turnMocks.modelPrefsHydrated = true
    mount()

    const last = seen.at(-1)
    expect(last?.snapshot.selectedModel).toBe("model-b")
    expect(last?.snapshot.isHydrated).toBe(true)
    expect(last?.snapshot.systemPrompt).toBe("sp")
    expect(last?.snapshot.enableSearch).toBe(true)
    // Same getter identity across commits — safe to hold in a closure forever.
    expect(last?.getter).toBe(seen[0]?.getter)
  })
})
