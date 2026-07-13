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
import { Conversation } from "./conversation"
import { PENDING_ACTIVITY_TURN_ID } from "./use-activity-panel"

const HOUR = 60 * 60 * 1000

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

vi.mock("./thread-scroll", () => ({
  ThreadScrollEdge: () => null,
}))

vi.mock("@/components/ui/thinking-bar", () => ({
  ThinkingBar: () => <div data-testid="thinking" />,
}))

vi.mock("./message", () => ({
  Message: ({
    id,
    onReload,
    status,
    view,
    children,
  }: {
    id: string
    onReload?: (messageId: string) => void
    status?: string
    view?: { reasoning?: { phase?: string } }
    children: React.ReactNode
  }) => (
    <button
      data-can-reload={Boolean(onReload)}
      data-reasoning-phase={view?.reasoning?.phase}
      data-status={status}
      data-testid={`message-${id}`}
      onClick={() => onReload?.(id)}
      type="button"
    >
      {children}
    </button>
  ),
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
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
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onReload={onReload}
          isDurableChat
        />
      )
    })

    return onReload
  }

  it("withholds reload handlers while a generation is active", () => {
    const onReload = renderConversation({ status: "streaming" })
    const priorAssistant = container?.querySelector(
      '[data-testid="message-assistant-1"]'
    ) as HTMLButtonElement | null

    expect(priorAssistant?.dataset.canReload).toBe("false")

    act(() => {
      priorAssistant?.click()
    })

    expect(onReload).not.toHaveBeenCalled()
  })

  it("withholds reload handlers during submit preflight", () => {
    const onReload = renderConversation({ isSubmitting: true })
    const priorAssistant = container?.querySelector(
      '[data-testid="message-assistant-1"]'
    ) as HTMLButtonElement | null

    expect(priorAssistant?.dataset.canReload).toBe("false")

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

    act(() => {
      priorAssistant?.click()
    })

    expect(onReload).toHaveBeenCalledWith("assistant-1")
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
          onDelete={vi.fn()}
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
          onDelete={vi.fn()}
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
          onDelete={vi.fn()}
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

describe("Conversation timestamp integration", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  type TimestampedUIMessage = UIMessage & { createdAt?: Date }

  function cleanupRender() {
    const mountedRoot = root
    if (mountedRoot) act(() => mountedRoot.unmount())
    container?.remove()
    root = null
    container = null
  }

  afterEach(cleanupRender)

  function renderConversation(messages: TimestampedUIMessage[]) {
    if (!container) {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
    }

    act(() => {
      root?.render(
        <Conversation
          messages={messages}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onReload={vi.fn()}
          isDurableChat
        />
      )
    })
  }

  function userMessage(id: string, createdAt: Date): TimestampedUIMessage {
    return {
      id,
      role: "user",
      createdAt,
      parts: [{ type: "text", text: id }],
    }
  }

  it("places the timestamp outside the capped turn-content column", () => {
    renderConversation([
      userMessage("historical-user", new Date(Date.now() - HOUR - 1000)),
    ])

    const separator = container?.querySelector('[role="separator"]')
    const wrapper = separator?.closest("[data-turn-id-container]")
    const turnRow = wrapper?.querySelector('[data-turn="user"]')
    const contentColumn = turnRow?.firstElementChild

    expect(wrapper?.getAttribute("data-turn-id-container")).toBe(
      "historical-user"
    )
    expect(wrapper?.className).toBe("w-full")
    expect(wrapper?.firstElementChild).toBe(separator)
    expect(wrapper?.children[1]).toBe(turnRow)
    expect(separator?.closest("[data-turn]")).toBeNull()
    expect(contentColumn?.className).toContain("group/turn-messages")
    expect(contentColumn?.className).toContain(
      "max-w-[var(--thread-content-max-width,40rem)]"
    )
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
          getIsSending: () => isSending,
          setIsSending: (value) => {
            isSending = value
          },
          setIsSubmitting,
          setHasSentFirstMessage: vi.fn(),
          setMessages: chat.setMessages,
          resolveUserId: () => authGate.promise,
          checkLimitsAndNotify: vi.fn(async () => true),
          ensureChatExists: vi.fn(async () => "chat-durable"),
          setPreviousChatId: vi.fn(),
          cleanupOptimisticAttachments: vi.fn(),
          attachStagedFiles: () => uploadGate.promise,
          sendMessage: chat.sendMessage,
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
          onDelete={vi.fn()}
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

    const wrappers = container?.querySelectorAll(
      '[data-turn-id-container="optimistic-user"]'
    )
    expect(wrappers).toHaveLength(1)
    const wrapper = wrappers?.[0]
    expect(wrapper).toBeTruthy()
    if (originalWrapper) expect(wrapper).toBe(originalWrapper)

    const separators = container?.querySelectorAll('[role="separator"]')
    expect(separators).toHaveLength(expectedSeparatorCount)
    if (expectedSeparatorCount === 1) {
      const separator = separators?.[0]
      expect(wrapper?.firstElementChild).toBe(separator)
      expect(separator?.closest("[data-turn]")).toBeNull()
      expect(separator?.className).toContain("h-5")
      expect(separator?.className).toContain("my-4")
      expect(separator?.className).toContain("justify-center")
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
    ).toBe(false)

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
    const originalWrapper = assertLifecycleFrame(api(), qualifies ? 1 : 0)
    const originalTurn = originalWrapper.querySelector('[data-turn="user"]')
    const originalSeparator = qualifies
      ? originalWrapper.querySelector('[role="separator"]')
      : null
    const assertStableDomIdentity = () => {
      expect(originalWrapper.querySelector('[data-turn="user"]')).toBe(
        originalTurn
      )
      if (qualifies) {
        expect(originalWrapper.querySelector('[role="separator"]')).toBe(
          originalSeparator
        )
      }
    }
    const pendingAssistant = container?.querySelector(
      `[data-turn-id="${PENDING_ACTIVITY_TURN_ID}"]`
    )
    expect(pendingAssistant).toBeTruthy()
    expect(pendingAssistant?.querySelector('[role="separator"]')).toBeNull()
    expect(pendingAssistant?.closest("[data-turn-id-container]")).toBeNull()

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
        '[data-turn-id-container="assistant-streaming"]'
      )
    ).toHaveLength(1)

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
    ).toHaveLength(1)
  }

  it("keeps one immediate separator and one keyed turn through every send phase", async () => {
    await runLifecycle(true)
  })

  it("keeps a fresh send separator-free through every send phase", async () => {
    await runLifecycle(false)
  })
})
