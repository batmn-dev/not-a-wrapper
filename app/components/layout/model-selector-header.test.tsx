/** @vitest-environment jsdom */

import type { ModelConfig } from "@/lib/models/types"
import { JSDOM } from "jsdom"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"

type ModelSelectorProps = {
  selectedModelId: string | null
  setSelectedModelId: (modelId: string) => void
  disabled?: boolean
}

let ModelSelectorHeader: typeof import("./model-selector-header").ModelSelectorHeader
let testDom: JSDOM | null = null

function installDomIfNeeded() {
  if (typeof document !== "undefined") return

  testDom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  })

  Object.defineProperties(globalThis, {
    window: { value: testDom.window, configurable: true },
    document: { value: testDom.window.document, configurable: true },
    navigator: { value: testDom.window.navigator, configurable: true },
    HTMLElement: { value: testDom.window.HTMLElement, configurable: true },
    HTMLButtonElement: {
      value: testDom.window.HTMLButtonElement,
      configurable: true,
    },
  })
}

const modelSelectorHeaderMocks = {
  chatId: "chat_123",
  chatResult: {
    chat: undefined as { model?: string } | undefined,
    isLoading: false,
  },
  latestModelSelectorProps: null as ModelSelectorProps | null,
  setLastUsedModel: vi.fn(),
  updateChatModel: vi.fn(() => Promise.resolve()),
  user: { id: "user_123" } as { id: string } | null,
  models: [
    {
      id: "gpt-5-mini",
      name: "GPT-5 Mini",
      provider: "OpenAI",
      providerId: "openai",
      catalogStatus: "visible",
      idKind: "stable",
      baseProviderId: "openai",
      accessible: true,
    },
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
      baseProviderId: "claude",
      accessible: true,
    },
  ] satisfies ModelConfig[],
}

vi.mock("@/components/common/model-selector/base", () => ({
  ModelSelector: (props: ModelSelectorProps) => {
    modelSelectorHeaderMocks.latestModelSelectorProps = props
    return (
      <button
        data-testid="model-selector"
        disabled={props.disabled}
        type="button"
        onClick={() => props.setSelectedModelId("gpt-5.4")}
      >
        {props.selectedModelId ?? "loading"}
      </button>
    )
  },
}))

vi.mock("@/app/auth/_components/auth-modal", () => ({
  AuthModal: () => null,
}))

vi.mock("@/lib/chat-store/chats/provider", () => ({
  useChats: () => ({
    updateChatModel: modelSelectorHeaderMocks.updateChatModel,
  }),
}))

vi.mock("@/lib/chat-store/chats/use-chat", () => ({
  useChat: () => modelSelectorHeaderMocks.chatResult,
}))

vi.mock("@/lib/chat-store/session/provider", () => ({
  useChatSession: () => ({
    chatId: modelSelectorHeaderMocks.chatId,
    selectedModelOverride: null,
    setSelectedModelOverride: vi.fn(),
    clearSelectedModelOverride: vi.fn(),
  }),
}))

vi.mock("@/lib/model-store/provider", () => ({
  useModel: () => ({
    models: modelSelectorHeaderMocks.models,
    lastUsedModel: "gpt-5-mini",
    setLastUsedModel: modelSelectorHeaderMocks.setLastUsedModel,
    favoriteModels: ["gpt-5.4"],
    modelPrefsHydrated: true,
  }),
}))

vi.mock("@/lib/user-store/provider", () => ({
  useUser: () => ({
    user: modelSelectorHeaderMocks.user,
  }),
}))

describe("ModelSelectorHeader", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(async () => {
    installDomIfNeeded()

    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    ;({ ModelSelectorHeader } = await import("./model-selector-header"))
  })

  afterAll(() => {
    testDom?.window.close()
    testDom = null
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => {
        mountedRoot.unmount()
      })
    }
    container?.remove()
    document.body.innerHTML = ""
    container = null
    root = null
    modelSelectorHeaderMocks.chatId = "chat_123"
    modelSelectorHeaderMocks.chatResult = {
      chat: undefined,
      isLoading: false,
    }
    modelSelectorHeaderMocks.latestModelSelectorProps = null
    modelSelectorHeaderMocks.user = { id: "user_123" }
    modelSelectorHeaderMocks.setLastUsedModel.mockClear()
    modelSelectorHeaderMocks.updateChatModel.mockClear()
  })

  function renderHeader() {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(<ModelSelectorHeader />)
    })

    const props = modelSelectorHeaderMocks.latestModelSelectorProps

    if (!props) {
      throw new Error("ModelSelector was not rendered")
    }

    return props
  }

  it("holds the selected model while the current chat fallback is loading", () => {
    modelSelectorHeaderMocks.chatResult = {
      chat: undefined,
      isLoading: true,
    }

    const props = renderHeader()

    expect(props.selectedModelId).toBeNull()
    expect(props.disabled).toBe(true)

    act(() => {
      props.setSelectedModelId("gpt-5.4")
    })

    expect(modelSelectorHeaderMocks.setLastUsedModel).not.toHaveBeenCalled()
    expect(modelSelectorHeaderMocks.updateChatModel).not.toHaveBeenCalled()
  })

  it("falls back to the last-used model only after the chat read settles", () => {
    modelSelectorHeaderMocks.chatResult = {
      chat: undefined,
      isLoading: false,
    }

    const props = renderHeader()

    expect(props.selectedModelId).toBe("gpt-5-mini")
    expect(props.disabled).toBe(false)
  })

  it("uses and updates the persisted chat model after the chat read settles", () => {
    modelSelectorHeaderMocks.chatResult = {
      chat: { model: "claude-sonnet-4-6" },
      isLoading: false,
    }

    const props = renderHeader()

    expect(props.selectedModelId).toBe("claude-sonnet-4-6")
    expect(props.disabled).toBe(false)

    act(() => {
      props.setSelectedModelId("gpt-5.4")
    })

    expect(modelSelectorHeaderMocks.setLastUsedModel).toHaveBeenCalledWith(
      "gpt-5.4"
    )
    expect(modelSelectorHeaderMocks.updateChatModel).toHaveBeenCalledWith(
      "chat_123",
      "gpt-5.4"
    )
  })

  it("persists guest selections for an active local chat", () => {
    modelSelectorHeaderMocks.user = null
    modelSelectorHeaderMocks.chatId = "local-chat_123"
    modelSelectorHeaderMocks.chatResult = {
      chat: { model: "gpt-5-mini" },
      isLoading: false,
    }

    const props = renderHeader()

    act(() => {
      props.setSelectedModelId("gpt-5.4")
    })

    expect(modelSelectorHeaderMocks.setLastUsedModel).toHaveBeenCalledWith(
      "gpt-5.4"
    )
    expect(modelSelectorHeaderMocks.updateChatModel).toHaveBeenCalledWith(
      "local-chat_123",
      "gpt-5.4"
    )
  })
})
