/** @vitest-environment jsdom */

import { projectSelectedPath } from "@/lib/chat-store/turns/selected-path"
import {
  createChatTurnController,
  type ChatTurnAdapters,
  type ChatTurnMessage,
} from "@/lib/chat-turn/chat-turn-controller"
import { useChat, type UIMessage } from "@ai-sdk/react"
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  DefaultChatTransport,
  type UIMessageStreamWriter,
} from "ai"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  Conversation,
  shouldUseAssistantContentVisibility,
} from "./conversation"
import { PENDING_ACTIVITY_TURN_ID } from "./use-activity-panel"

const HOUR = 60 * 60 * 1000
const turnScrollMocks = vi.hoisted(() => {
  const renderCallbacks = new Map<
    string,
    (intersecting: boolean, entry?: IntersectionObserverEntry) => void
  >()
  const renderObserver = {
    observe: (
      turn: HTMLElement,
      onChange: (
        intersecting: boolean,
        entry?: IntersectionObserverEntry
      ) => void
    ) => {
      const turnId = turn.dataset.turnIdContainer ?? ""
      renderCallbacks.set(turnId, onChange)
      return () => {
        if (renderCallbacks.get(turnId) === onChange) {
          renderCallbacks.delete(turnId)
        }
      }
    },
    disconnect: () => renderCallbacks.clear(),
  }
  const centerObserver = {
    observe: () => () => undefined,
    disconnect: () => undefined,
  }
  const onIntersectingChange = vi.fn()
  return {
    centerObserver,
    onIntersectingChange,
    renderCallbacks,
    renderObserver,
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

vi.mock("@/components/ui/message", () => ({
  Message: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock("@/lib/chat-store/messages/api", () => ({
  cacheMessages: vi.fn(async () => {}),
  getCachedMessages: vi.fn(async () => []),
}))

vi.mock("@/hooks/use-breakpoint", () => ({ useBreakpoint: () => false }))

vi.mock("./thread-scroll", () => ({
  CHATGPT_TURN_INTERSECTION_EXPERIMENT: {
    id: "1841171328",
    key: "is_enabled",
    defaultValue: false,
    enabled: true,
  },
  estimateTurnPlaceholderHeight: (
    textParts: readonly string[],
    charactersPerLine: number
  ) => {
    const characterCount = textParts.reduce(
      (count, text) => count + text.length,
      0
    )
    return characterCount === 0
      ? null
      : 56 + Math.max(1, Math.ceil(characterCount / charactersPerLine)) * 18
  },
  isTurnAlwaysRendered: (
    index: number,
    turnCount: number,
    activeTurnIndex: number
  ) =>
    index >= turnCount - 5 ||
    (activeTurnIndex !== -1 && Math.abs(index - activeTurnIndex) <= 5),
  ThreadScrollEdge: ({
    streamActive,
    scrollTarget,
  }: {
    streamActive: boolean
    scrollTarget?: { turnId: string; messageId?: string } | null
  }) => (
    <div
      data-scroll-target={
        scrollTarget
          ? `${scrollTarget.turnId}:${scrollTarget.messageId ?? ""}`
          : undefined
      }
      data-stream-active={streamActive}
      data-testid="thread-scroll-edge"
    />
  ),
  useSubmitTurnScrollRef: (active: boolean) => (node: HTMLElement | null) => {
    if (node) node.dataset.submitScrollActive = String(active)
  },
  TURN_ESTIMATE_DESKTOP_CHARACTERS_PER_LINE: 88,
  TURN_ESTIMATE_MOBILE_CHARACTERS_PER_LINE: 46,
  useConversationTurnVirtualization: () => {
    return {
      centerIntersectionObserver: turnScrollMocks.centerObserver,
      markerRef: () => undefined,
      onIntersectingChange: turnScrollMocks.onIntersectingChange,
      renderIntersectionObserver: turnScrollMocks.renderObserver,
    }
  },
}))

vi.mock("@/components/ui/thinking-bar", () => ({
  ThinkingBar: () => <div data-testid="thinking" />,
}))

vi.mock("./message", () => ({
  Message: ({
    model,
    onReload,
  }: {
    model: {
      id: string
      text: string
      status?: string
      finishReason?: string
      retryDisabled?: boolean
      view?: { reasoning?: { phase?: string } }
    }
    onReload?: (messageId: string) => void
  }) => (
    <button
      data-can-reload={Boolean(onReload)}
      data-finish-reason={model.finishReason}
      data-reasoning-phase={model.view?.reasoning?.phase}
      data-retry-disabled={Boolean(model.retryDisabled)}
      data-status={model.status}
      data-testid={`message-${model.id}`}
      disabled={model.retryDisabled}
      onClick={() => onReload?.(model.id)}
      type="button"
    >
      {model.text}
    </button>
  ),
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  turnScrollMocks.renderCallbacks.clear()
  turnScrollMocks.onIntersectingChange.mockClear()
})

describe("Conversation recovered turn contracts", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  const messages = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Prompt" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Answer" }],
    },
  ] satisfies UIMessage[]

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
    vi.unstubAllGlobals()
  })

  function render(scrollToMessageId?: string) {
    if (!container) {
      container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
    }
    act(() => {
      root?.render(
        <Conversation
          messages={messages}
          scrollToMessageId={scrollToMessageId}
          onEdit={vi.fn()}
          onReload={vi.fn()}
        />
      )
    })
  }

  it("uses the exact assistant containment guard and deep-link sentinels", () => {
    vi.stubGlobal("CSS", {
      supports: vi.fn(
        (declaration: string) => declaration === "content-visibility: auto"
      ),
    })

    render()
    const assistantTurn = container?.querySelector('[data-turn="assistant"]')
    expect(assistantTurn?.className).not.toContain("[content-visibility:auto]")
    expect(
      shouldUseAssistantContentVisibility({
        supported: true,
        isUser: false,
        experimentEnabled: false,
      })
    ).toBe(true)

    render("finalAgentTurnStart")
    expect(assistantTurn?.className).not.toContain("[content-visibility:auto]")
    expect(
      container
        ?.querySelector('[data-testid="thread-scroll-edge"]')
        ?.getAttribute("data-scroll-target")
    ).toBe("assistant-turn:user-1:")

    render("assistant-1")
    expect(
      container
        ?.querySelector('[data-testid="thread-scroll-edge"]')
        ?.getAttribute("data-scroll-target")
    ).toBe("assistant-turn:user-1:assistant-1")
  })

  it("keeps the final five outer turn owners intersecting", () => {
    const sixMessages = Array.from({ length: 6 }, (_, index) => ({
      id: `user-${index + 1}`,
      role: "user" as const,
      parts: [{ type: "text" as const, text: `Prompt ${index + 1}` }],
    }))

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        <Conversation
          messages={sixMessages}
          onEdit={vi.fn()}
          onReload={vi.fn()}
        />
      )
    })

    const owners = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-turn-id-container][data-is-intersecting]"
      )
    )
    expect(owners).toHaveLength(7)
    expect(owners.map((owner) => owner.dataset.isIntersecting)).toEqual([
      "false",
      "false",
      "true",
      "true",
      "true",
      "true",
      "true",
    ])
    expect(owners[0]?.querySelector("section")).toBeNull()
    expect(owners[0]?.dataset.turnIdContainer).toBe("client-created-root")
    expect(owners[0]?.className).toBe("")
    expect(owners[1]?.querySelector("section")).toBeNull()
    expect(owners[1]?.className).toContain("--last-known-height")
    expect(owners[1]?.style.getPropertyValue("--estimated-turn-height")).toBe(
      "74px"
    )
    expect(
      owners.slice(2).every((owner) => owner.querySelector("section"))
    ).toBe(true)

    const firstOwner = owners[1]
    const firstCallback = turnScrollMocks.renderCallbacks.get("user-1")
    expect(firstCallback).toBeTypeOf("function")
    act(() => {
      firstCallback?.(true, {
        boundingClientRect: { height: 74 } as DOMRectReadOnly,
      } as IntersectionObserverEntry)
    })
    expect(firstOwner?.querySelector("section")).toBeTruthy()
    expect(container.querySelector('[data-turn-id-container="user-1"]')).toBe(
      firstOwner
    )

    act(() => {
      turnScrollMocks.renderCallbacks.get("user-1")?.(false, {
        boundingClientRect: { height: 180 } as DOMRectReadOnly,
      } as IntersectionObserverEntry)
    })
    expect(firstOwner?.querySelector("section")).toBeNull()
    expect(firstOwner?.style.getPropertyValue("--last-known-height")).toBe(
      "180px"
    )
    expect(container.querySelector('[data-turn-id-container="user-1"]')).toBe(
      firstOwner
    )
  })

  it("keeps asset turns mounted outside the final five window", () => {
    const messagesWithHistoricalAsset = [
      {
        id: "user-1",
        role: "user" as const,
        parts: [
          {
            type: "file" as const,
            filename: "reference.pdf",
            mediaType: "application/pdf",
            url: "https://example.com/reference.pdf",
          },
        ],
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `user-${index + 2}`,
        role: "user" as const,
        parts: [{ type: "text" as const, text: `Prompt ${index + 2}` }],
      })),
    ] satisfies UIMessage[]

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        <Conversation
          messages={messagesWithHistoricalAsset}
          onEdit={vi.fn()}
          onReload={vi.fn()}
        />
      )
    })

    const assetOwner = container.querySelector<HTMLElement>(
      '[data-turn-id-container="user-1"][data-is-intersecting]'
    )
    expect(assetOwner?.dataset.isIntersecting).toBe("true")
    expect(assetOwner?.querySelector(":scope > section")).toBeTruthy()
    expect(turnScrollMocks.renderCallbacks.has("user-1")).toBe(false)
    expect(turnScrollMocks.onIntersectingChange).not.toHaveBeenCalledWith(
      "user-1",
      true
    )
  })
})

describe("Conversation regeneration availability", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  function cleanupRender() {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => mountedRoot.unmount())
    }
    container?.remove()
    root = null
    container = null
  }

  afterEach(cleanupRender)

  const messages = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "first prompt" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "first answer" }],
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "second prompt" }],
    },
    {
      id: "assistant-2",
      role: "assistant",
      parts: [{ type: "text", text: "streaming answer" }],
    },
  ] satisfies UIMessage[]

  function renderConversation({
    status = "ready",
    isSubmitting = false,
    onReload = vi.fn(),
  }: {
    status?: "streaming" | "ready" | "submitted" | "error"
    isSubmitting?: boolean
    onReload?: (messageId: string) => void
  } = {}) {
    cleanupRender()
    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    act(() => {
      root?.render(
        <Conversation
          messages={messages}
          status={status}
          isSubmitting={isSubmitting}
          onEdit={vi.fn()}
          onReload={onReload}
          isDurableChat
        />
      )
    })

    return onReload
  }

  it("keeps prior retry actions visible but disabled while a generation is active", () => {
    const onReload = renderConversation({ status: "streaming" })
    const priorAssistant = container?.querySelector(
      '[data-testid="message-assistant-1"]'
    ) as HTMLButtonElement | null

    expect(priorAssistant?.dataset.canReload).toBe("true")
    expect(priorAssistant?.dataset.retryDisabled).toBe("true")
    expect(priorAssistant?.disabled).toBe(true)

    act(() => {
      priorAssistant?.click()
    })

    expect(onReload).not.toHaveBeenCalled()
  })

  it("keeps prior retry actions visible but disabled during submit preflight", () => {
    const onReload = renderConversation({ isSubmitting: true })
    const priorAssistant = container?.querySelector(
      '[data-testid="message-assistant-1"]'
    ) as HTMLButtonElement | null

    expect(priorAssistant?.dataset.canReload).toBe("true")
    expect(priorAssistant?.dataset.retryDisabled).toBe("true")
    expect(priorAssistant?.disabled).toBe(true)

    act(() => {
      priorAssistant?.click()
    })

    expect(onReload).not.toHaveBeenCalled()
  })

  it("exposes reload handlers when the chat is idle", () => {
    const onReload = renderConversation()
    const priorAssistant = container?.querySelector(
      '[data-testid="message-assistant-1"]'
    ) as HTMLButtonElement | null

    expect(priorAssistant?.dataset.canReload).toBe("true")
    expect(priorAssistant?.dataset.retryDisabled).toBe("false")
    expect(priorAssistant?.disabled).toBe(false)

    act(() => {
      priorAssistant?.click()
    })

    expect(onReload).toHaveBeenCalledWith("assistant-1")
  })

  it("matches the reference turn sections and vertical rhythm", () => {
    renderConversation()

    const turns = Array.from(
      container?.querySelectorAll<HTMLElement>(
        '[data-testid^="conversation-turn-"]'
      ) ?? []
    )

    expect(turns).toHaveLength(4)
    expect(turns.every((turn) => turn.tagName === "SECTION")).toBe(true)
    const padding = turns.map((turn) =>
      turn.querySelector<HTMLElement>(":scope > div")
    )
    expect(turns[0]?.querySelector(":scope > h4")?.textContent).toBe(
      "You said:"
    )
    expect(padding[0]?.classList.contains("pt-3")).toBe(true)
    expect(padding[0]?.classList.contains("pt-12")).toBe(false)
    expect(padding[2]?.classList.contains("pt-12")).toBe(true)
    expect(padding[3]?.classList.contains("pb-8")).toBe(true)
    expect(padding[3]?.classList.contains("pb-10")).toBe(false)
    expect(
      turns.every(
        (turn) =>
          turn.parentElement?.dataset.turnIdContainer ===
          turn.dataset.turnIdContainer
      )
    ).toBe(true)
  })

  it("hydrates finish reasons from durable metadata for historical and last rows", () => {
    cleanupRender()
    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    const durableMessages = messages.map((message) =>
      message.role === "assistant"
        ? {
            ...message,
            metadata: {
              finishReason:
                message.id === "assistant-1" ? "length" : "content-filter",
            },
          }
        : message
    ) satisfies UIMessage[]

    act(() => {
      root?.render(
        <Conversation
          messages={durableMessages}
          status="ready"
          lastFinishReason="stop"
          onEdit={vi.fn()}
          onReload={vi.fn()}
          isDurableChat
        />
      )
    })

    expect(
      (
        container?.querySelector(
          '[data-testid="message-assistant-1"]'
        ) as HTMLButtonElement | null
      )?.dataset.finishReason
    ).toBe("length")
    expect(
      (
        container?.querySelector(
          '[data-testid="message-assistant-2"]'
        ) as HTMLButtonElement | null
      )?.dataset.finishReason
    ).toBe("content-filter")
  })

  it("routes the submitted pre-stream state through the activity assistant row", () => {
    cleanupRender()
    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    const userTail = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ] satisfies UIMessage[]

    act(() => {
      root?.render(
        <Conversation
          messages={userTail}
          status="submitted"
          isSubmitting
          onEdit={vi.fn()}
          onReload={vi.fn()}
          isDurableChat
        />
      )
    })

    const pendingMessage = container?.querySelector(
      `[data-testid="message-${PENDING_ACTIVITY_TURN_ID}"]`
    ) as HTMLButtonElement | null

    expect(container?.querySelector('[data-testid="thinking"]')).toBeNull()
    expect(pendingMessage).toBeTruthy()
    expect(pendingMessage?.dataset.status).toBe("submitted")
  })

  it("routes submit preflight through the activity assistant row before status flips", () => {
    cleanupRender()
    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    const userTail = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ] satisfies UIMessage[]

    act(() => {
      root?.render(
        <Conversation
          messages={userTail}
          status="ready"
          isSubmitting
          onEdit={vi.fn()}
          onReload={vi.fn()}
          isDurableChat
        />
      )
    })

    const pendingMessage = container?.querySelector(
      `[data-testid="message-${PENDING_ACTIVITY_TURN_ID}"]`
    ) as HTMLButtonElement | null

    expect(container?.querySelector('[data-testid="thinking"]')).toBeNull()
    expect(pendingMessage).toBeTruthy()
    expect(pendingMessage?.dataset.status).toBe("submitted")
  })

  it("keeps the pending row while an adopted assistant shell has no renderable evidence", () => {
    cleanupRender()
    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    const adoptedEmptyAssistant = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] },
      { id: "assistant-1", role: "assistant", parts: [] },
    ] satisfies UIMessage[]

    act(() => {
      root?.render(
        <Conversation
          messages={adoptedEmptyAssistant}
          status="ready"
          isSubmitting
          onEdit={vi.fn()}
          onReload={vi.fn()}
          isDurableChat
        />
      )
    })

    expect(
      container?.querySelector(
        `[data-testid="message-${PENDING_ACTIVITY_TURN_ID}"]`
      )
    ).toBeTruthy()
    expect(
      container?.querySelector('[data-testid="message-assistant-1"]')
    ).toBeNull()
    expect(container?.querySelectorAll('[data-turn="assistant"]')).toHaveLength(
      1
    )
  })

  it("pins the optimistic user turn during submission before response text", () => {
    cleanupRender()
    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    const userTail = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ] satisfies UIMessage[]

    act(() => {
      root?.render(
        <Conversation
          messages={userTail}
          status="submitted"
          onEdit={vi.fn()}
          onReload={vi.fn()}
          isDurableChat
        />
      )
    })

    const scrollEdge = container?.querySelector(
      '[data-testid="thread-scroll-edge"]'
    ) as HTMLDivElement | null

    expect(scrollEdge?.dataset.streamActive).toBe("true")
    expect(
      container
        ?.querySelector('[data-turn="user"]')
        ?.getAttribute("data-submit-scroll-active")
    ).toBe("true")
  })

  it("keeps the same user pin target when assistant streaming begins", () => {
    cleanupRender()
    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    const streamingTail = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "hello" }],
      },
    ] satisfies UIMessage[]

    act(() => {
      root?.render(
        <Conversation
          messages={streamingTail}
          status="streaming"
          onEdit={vi.fn()}
          onReload={vi.fn()}
          isDurableChat
        />
      )
    })

    const scrollEdge = container?.querySelector(
      '[data-testid="thread-scroll-edge"]'
    ) as HTMLDivElement | null

    expect(scrollEdge?.dataset.streamActive).toBe("true")
    expect(
      container
        ?.querySelector('[data-turn="user"]')
        ?.getAttribute("data-submit-scroll-active")
    ).toBe("true")
  })

  it("keeps historical assistant views ready while the current assistant streams", () => {
    cleanupRender()
    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    const opaqueReasoningMessages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "first prompt" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "" },
          { type: "text", text: "first answer" },
        ],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "second prompt" }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [{ type: "reasoning", text: "" }],
      },
    ] satisfies UIMessage[]

    act(() => {
      root?.render(
        <Conversation
          messages={opaqueReasoningMessages}
          status="streaming"
          onEdit={vi.fn()}
          onReload={vi.fn()}
          isDurableChat
        />
      )
    })

    const priorAssistant = container?.querySelector(
      '[data-testid="message-assistant-1"]'
    ) as HTMLButtonElement | null
    const currentAssistant = container?.querySelector(
      '[data-testid="message-assistant-2"]'
    ) as HTMLButtonElement | null

    expect(priorAssistant?.dataset.reasoningPhase).toBe("complete")
    expect(currentAssistant?.dataset.reasoningPhase).toBe("thinking")
  })
})

describe("Conversation optimistic-to-durable timestamp lifecycle", () => {
  type TimestampedUIMessage = UIMessage & { createdAt?: Date }
  type LifecycleApi = {
    messages: TimestampedUIMessage[]
    reconcile: (serverPath: ChatTurnMessage[]) => void
    send: () => Promise<void>
    status: "streaming" | "ready" | "submitted" | "error"
  }

  const now = new Date("2026-07-09T16:00:00.000Z")
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    vi.unstubAllGlobals()
    const mountedRoot = root
    if (mountedRoot) act(() => mountedRoot.unmount())
    container?.remove()
    container = null
    root = null
  })

  async function waitFor(assertion: () => void) {
    let lastError: unknown
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        assertion()
        return
      } catch (error) {
        lastError = error
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
      }
    }
    throw lastError
  }

  function mountLifecycle(qualifies: boolean) {
    const authGate = deferred<string | null>()
    const uploadGate = deferred<Array<{
      attachmentId: string
      contentType: string
      name: string
      url: string
    }> | null>()
    const streamGate = deferred<void>()
    const apiRef: { current: LifecycleApi | null } = { current: null }
    let streamWriter: UIMessageStreamWriter<UIMessage> | undefined
    let isSending = false

    const initialAssistant: TimestampedUIMessage = {
      id: "assistant-before-send",
      role: "assistant",
      createdAt: new Date(
        now.getTime() - (qualifies ? 2 * HOUR : 30 * 60 * 1000)
      ),
      parts: [{ type: "text", text: "Earlier answer" }],
    }
    const response = createUIMessageStreamResponse({
      stream: createUIMessageStream({
        execute: async ({ writer }) => {
          streamWriter = writer
          await streamGate.promise
        },
      }),
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response)
    )

    function Harness() {
      const [isSubmitting, setIsSubmitting] = React.useState(false)
      const [transport] = React.useState(
        () => new DefaultChatTransport({ api: "/api/chat" })
      )
      const chat = useChat<TimestampedUIMessage>({
        messages: [initialAssistant],
        transport,
      })

      const send = async () => {
        const adapters: ChatTurnAdapters = {
          now: () => now,
          createOptimisticMessageId: () => "optimistic-user",
          getTurnSnapshot: () => ({
            enableSearch: false,
            isAuthenticated: true,
            selectedModel: "fixture-model",
            systemPrompt: "fixture system prompt",
          }),
          getCurrentChatId: () => "chat-durable",
          getIsSending: () => isSending,
          setIsSending: (value) => {
            isSending = value
          },
          setIsSubmitting,
          setHasSentFirstMessage: vi.fn(),
          setMessages: chat.setMessages,
          resolveUserId: () => authGate.promise,
          checkLimitsAndNotify: vi.fn(async () => true),
          ensureChatExists: vi.fn(async () => ({ chatId: "chat-durable" })),
          setPreviousChatId: vi.fn(),
          cleanupOptimisticAttachments: vi.fn(),
          attachStagedFiles: () => uploadGate.promise,
          sendMessage: chat.sendMessage,
          sendMessageAndWaitForAcceptance: (...args) => {
            void chat.sendMessage(...args)
            return Promise.resolve()
          },
          regenerate: chat.regenerate,
          toastError: vi.fn(),
          bumpChat: vi.fn(),
          setLastFinishReason: vi.fn(),
          reportError: vi.fn(),
          store: {
            isAuthenticated: () => true,
            updateMessages: chat.setMessages,
            cacheAndAddMessage: vi.fn(),
            updateTitle: vi.fn(),
            pendingEdit: {
              get: () => null,
              stage: vi.fn(),
              clear: vi.fn(),
            },
            getStoredGuestChatId: () => null,
            reportError: vi.fn(),
          },
        }
        const controller = createChatTurnController(adapters)
        await controller.runSendTurn({
          chatVersion: 2,
          messages: [initialAssistant],
          optimisticAttachments: [
            {
              contentType: "application/pdf",
              name: "notes.pdf",
              url: "blob:optimistic-notes",
            },
          ],
          submittedFiles: [
            new File(["fixture"], "notes.pdf", {
              type: "application/pdf",
            }),
          ],
          submittedAttachments: [
            {
              attachmentId: "attachment-1",
              contentType: "application/pdf",
              name: "notes.pdf",
              url: "/api/files/attachment-1/preview",
            },
          ],
          text: "New prompt",
        })
      }

      React.useLayoutEffect(() => {
        apiRef.current = {
          messages: chat.messages,
          reconcile: (serverPath) => {
            chat.setMessages(
              (live) =>
                projectSelectedPath(
                  live as ChatTurnMessage[],
                  serverPath
                ) as TimestampedUIMessage[]
            )
          },
          send,
          status: chat.status,
        }
      })

      return (
        <Conversation
          isDurableChat
          isSubmitting={isSubmitting}
          messages={chat.messages}
          now={now}
          onEdit={vi.fn()}
          onReload={vi.fn()}
          status={chat.status}
        />
      )
    }

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<Harness />))

    return {
      apiRef,
      authGate,
      getStreamWriter: () => streamWriter,
      initialAssistant,
      streamGate,
      uploadGate,
    }
  }

  function assertLifecycleFrame(
    api: LifecycleApi,
    expectedSeparatorCount: 0 | 1,
    originalWrapper?: Element
  ): Element {
    const user = api.messages.find(
      (message) => message.id === "optimistic-user"
    )
    expect(user?.role).toBe("user")
    expect(user?.createdAt).toBeInstanceOf(Date)
    expect(Number.isFinite(user?.createdAt?.getTime())).toBe(true)

    const wrappers = container?.querySelectorAll<HTMLElement>(
      '[data-turn-id-container="optimistic-user"]'
    )
    expect(wrappers).toHaveLength(2)
    const wrapper = wrappers?.[0]
    const section = wrapper?.querySelector(":scope > section")
    expect(wrapper).toBeTruthy()
    expect(wrapper?.tagName).toBe("DIV")
    expect(wrapper?.getAttribute("data-is-intersecting")).toBe("true")
    expect(section?.getAttribute("data-turn")).toBe("user")
    if (originalWrapper) expect(wrapper).toBe(originalWrapper)

    const separators = container?.querySelectorAll('[role="separator"]')
    expect(separators).toHaveLength(expectedSeparatorCount)
    if (expectedSeparatorCount === 1) {
      const separator = separators?.[0]
      expect(section?.previousElementSibling).toBe(separator)
      expect(separator?.closest("[data-turn]")).toBeNull()
      expect(wrapper?.querySelectorAll('[role="separator"]')).toHaveLength(1)
    }

    return wrapper as Element
  }

  async function runLifecycle(qualifies: boolean) {
    const lifecycle = mountLifecycle(qualifies)
    const api = () => {
      if (!lifecycle.apiRef.current)
        throw new Error("Lifecycle API unavailable")
      return lifecycle.apiRef.current
    }

    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = api().send()
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      api().messages.some((message) => message.id === "optimistic-user")
    ).toBe(true)
    const immediateUser = api().messages.find(
      (message) => message.id === "optimistic-user"
    )
    expect(immediateUser?.parts).toContainEqual(
      expect.objectContaining({ url: "blob:optimistic-notes" })
    )
    const originalWrapper = assertLifecycleFrame(api(), qualifies ? 1 : 0)
    const originalTurn = originalWrapper
    const originalSeparator = qualifies
      ? originalWrapper.querySelector('[role="separator"]')
      : null
    const assistantTurns = container?.querySelectorAll(
      '[data-turn="assistant"]'
    )
    const pendingAssistant = assistantTurns?.item(
      (assistantTurns?.length ?? 1) - 1
    )
    expect(pendingAssistant).toBeTruthy()
    expect(pendingAssistant?.querySelector('[role="separator"]')).toBeNull()
    const pendingAssistantWrapper = pendingAssistant?.parentElement?.closest(
      "[data-turn-id-container]"
    )
    expect(pendingAssistantWrapper).toBeTruthy()

    await act(async () => {
      lifecycle.authGate.resolve("fixture-user")
      await Promise.resolve()
      lifecycle.uploadGate.resolve([
        {
          attachmentId: "attachment-1",
          contentType: "application/pdf",
          name: "notes.pdf",
          url: "https://fixtures.invalid/notes.pdf",
        },
      ])
      await sendPromise
    })
    await waitFor(() =>
      expect(
        api().messages.some((message) => message.id === "optimistic-user")
      ).toBe(true)
    )
    const assertStableDomIdentity = () => {
      expect(originalWrapper).toBe(originalTurn)
      if (qualifies) {
        expect(originalWrapper.querySelector('[role="separator"]')).toBe(
          originalSeparator
        )
      }
    }

    await waitFor(() => expect(api().status).toBe("submitted"))
    assertLifecycleFrame(api(), qualifies ? 1 : 0, originalWrapper)
    assertStableDomIdentity()
    const submittedUser = api().messages.find(
      (message) => message.id === "optimistic-user"
    )
    expect(submittedUser?.createdAt?.getTime()).toBe(now.getTime())
    expect(submittedUser?.parts).toContainEqual(
      expect.objectContaining({ url: "https://fixtures.invalid/notes.pdf" })
    )

    await waitFor(() => expect(lifecycle.getStreamWriter()).toBeTruthy())
    await act(async () => {
      const writer = lifecycle.getStreamWriter()
      if (!writer) throw new Error("UI stream writer unavailable")
      writer.write({ type: "start", messageId: "assistant-streaming" })
      writer.write({ type: "text-start", id: "assistant-text" })
      writer.write({
        type: "text-delta",
        delta: "Streaming answer",
        id: "assistant-text",
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(api().status).toBe("streaming"))
    assertLifecycleFrame(api(), qualifies ? 1 : 0, originalWrapper)
    assertStableDomIdentity()
    expect(
      container?.querySelectorAll(
        '[data-turn-id-container="assistant-turn:optimistic-user"]'
      )
    ).toHaveLength(2)
    const streamingAssistant = container?.querySelector(
      '[data-turn-id="assistant-turn:optimistic-user"]'
    )
    expect(streamingAssistant).toBe(pendingAssistant)
    expect(
      streamingAssistant?.parentElement?.closest("[data-turn-id-container]")
    ).toBe(pendingAssistantWrapper)

    await act(async () => {
      const writer = lifecycle.getStreamWriter()
      if (!writer) throw new Error("UI stream writer unavailable")
      writer.write({ type: "text-end", id: "assistant-text" })
      writer.write({ type: "finish", finishReason: "stop" })
      lifecycle.streamGate.resolve()
    })
    await waitFor(() => expect(api().status).toBe("ready"))

    act(() => {
      api().reconcile([
        {
          ...lifecycle.initialAssistant,
          metadata: { serverMessageId: "assistant-before-send" },
        },
        {
          id: "optimistic-user",
          role: "user",
          createdAt: new Date(now.getTime() + 1),
          metadata: { serverMessageId: "server-user" },
          parts: submittedUser?.parts ?? [],
        },
        {
          id: "assistant-streaming",
          role: "assistant",
          createdAt: new Date(now.getTime() + 2),
          metadata: { serverMessageId: "assistant-streaming" },
          parts: [{ type: "text", text: "Streaming answer" }],
          status: "completed",
        },
      ])
    })
    await waitFor(() =>
      expect(
        api().messages.find((message) => message.id === "optimistic-user")
          ?.metadata
      ).toMatchObject({ serverMessageId: "server-user" })
    )
    assertLifecycleFrame(api(), qualifies ? 1 : 0, originalWrapper)
    assertStableDomIdentity()
    expect(
      container?.querySelectorAll('[data-turn-id-container="optimistic-user"]')
    ).toHaveLength(2)
  }

  it("keeps one immediate separator and one keyed turn through every send phase", async () => {
    await runLifecycle(true)
  })

  it("keeps a fresh send separator-free through every send phase", async () => {
    await runLifecycle(false)
  })
})
