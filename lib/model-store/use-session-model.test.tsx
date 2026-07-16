/** @vitest-environment jsdom */

import { ChatSessionProvider } from "@/lib/chat-store/session/provider"
import type { Chats } from "@/lib/chat-store/types"
import type { UserProfile } from "@/lib/user/types"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { useSessionModel } from "./use-session-model"

const modelMocks = vi.hoisted(() => ({
  pathname: "/c/chat_123",
  currentModel: "claude-sonnet-4-6",
  setLastUsedModel: vi.fn(),
  toast: vi.fn(),
  updateChatModel: vi.fn<(chatId: string, modelId: string) => Promise<void>>(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => modelMocks.pathname,
}))

vi.mock("@/lib/model-store/provider", () => ({
  useModel: () => ({
    models: [
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        provider: "OpenAI",
        providerId: "openai",
        catalogStatus: "visible",
        idKind: "stable",
        baseProviderId: "openai",
        accessible: true,
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        provider: "Anthropic",
        providerId: "anthropic",
        catalogStatus: "visible",
        idKind: "stable",
        baseProviderId: "anthropic",
        accessible: true,
      },
    ],
    favoriteModels: [],
    lastUsedModel: "gpt-5.4",
    modelPrefsHydrated: true,
    setLastUsedModel: modelMocks.setLastUsedModel,
  }),
}))

vi.mock("@/components/ui/toast", () => ({
  toast: modelMocks.toast,
}))

function currentChat(): Chats {
  const chatId = modelMocks.pathname.split("/").at(-1) ?? "chat_123"
  return {
    id: chatId,
    user_id: "user_123",
    title: "Test chat",
    model: modelMocks.currentModel,
    project_id: null,
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: "2026-07-13T00:00:00.000Z",
    updated_at: "2026-07-13T00:00:00.000Z",
  }
}

function ModelSurfaces({ isChatLoading = false }: { isChatLoading?: boolean }) {
  const chatId = modelMocks.pathname.split("/").at(-1) ?? null
  const props = {
    currentChat: currentChat(),
    user: { id: "user_123" } as UserProfile,
    updateChatModel: modelMocks.updateChatModel,
    chatId,
    isChatLoading,
  }
  // These are intentionally separate hook instances: the first represents the
  // app-shell header and the second the per-chat Turn context.
  const headerModel = useSessionModel(props)
  const turnModel = useSessionModel(props)

  return (
    <>
      <button
        id="header-model"
        type="button"
        onClick={() => void headerModel.handleModelChange("gpt-5.4")}
      >
        {headerModel.selectedModel}
      </button>
      <output id="turn-model">{turnModel.selectedModel}</output>
    </>
  )
}

describe("session selected-model ownership", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
    modelMocks.pathname = "/c/chat_123"
    modelMocks.currentModel = "claude-sonnet-4-6"
    modelMocks.setLastUsedModel.mockClear()
    modelMocks.toast.mockClear()
    modelMocks.updateChatModel.mockReset()
  })

  function renderSurfaces({ isChatLoading = false } = {}) {
    if (!container) {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
    }
    act(() => {
      root?.render(
        <ChatSessionProvider>
          <ModelSurfaces isChatLoading={isChatLoading} />
        </ChatSessionProvider>
      )
    })
  }

  it("shares a header selection with the Turn model before persistence settles", async () => {
    let resolveUpdate: (() => void) | null = null
    modelMocks.updateChatModel.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve
        })
    )
    renderSurfaces()

    expect(container?.querySelector("#header-model")?.textContent).toBe(
      "claude-sonnet-4-6"
    )
    expect(container?.querySelector("#turn-model")?.textContent).toBe(
      "claude-sonnet-4-6"
    )

    act(() => {
      ;(container?.querySelector("#header-model") as HTMLButtonElement).click()
    })

    expect(container?.querySelector("#header-model")?.textContent).toBe(
      "gpt-5.4"
    )
    expect(container?.querySelector("#turn-model")?.textContent).toBe("gpt-5.4")
    expect(modelMocks.updateChatModel).toHaveBeenCalledWith(
      "chat_123",
      "gpt-5.4"
    )

    await act(async () => resolveUpdate?.())

    modelMocks.pathname = "/c/chat_456"
    modelMocks.currentModel = "claude-sonnet-4-6"
    renderSurfaces()

    expect(container?.querySelector("#header-model")?.textContent).toBe(
      "claude-sonnet-4-6"
    )
    expect(container?.querySelector("#turn-model")?.textContent).toBe(
      "claude-sonnet-4-6"
    )
  })

  it("rolls back the matching session selection when persistence fails", async () => {
    modelMocks.updateChatModel.mockRejectedValue(new Error("write failed"))
    renderSurfaces()

    await act(async () => {
      ;(container?.querySelector("#header-model") as HTMLButtonElement).click()
    })

    expect(container?.querySelector("#header-model")?.textContent).toBe(
      "claude-sonnet-4-6"
    )
    expect(container?.querySelector("#turn-model")?.textContent).toBe(
      "claude-sonnet-4-6"
    )
    expect(modelMocks.toast).toHaveBeenCalledWith({
      title: "Failed to update chat model",
      status: "error",
    })
  })

  it("ignores model changes until the current chat finishes loading", () => {
    renderSurfaces({ isChatLoading: true })

    act(() => {
      ;(container?.querySelector("#header-model") as HTMLButtonElement).click()
    })

    expect(container?.querySelector("#header-model")?.textContent).toBe(
      "claude-sonnet-4-6"
    )
    expect(container?.querySelector("#turn-model")?.textContent).toBe(
      "claude-sonnet-4-6"
    )
    expect(modelMocks.setLastUsedModel).not.toHaveBeenCalled()
    expect(modelMocks.updateChatModel).not.toHaveBeenCalled()
  })
})
