/** @vitest-environment jsdom */

import { checkRateLimits } from "@/lib/api"
import type {
  FirstTurnChat,
  FirstTurnChatResult,
} from "@/lib/chat-store/chats/provider"
import { GUEST_CHAT_STORAGE_KEY } from "@/lib/chat-store/identity"
import type { Chats } from "@/lib/chat-store/types"
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { useChatOperations } from "./use-chat-operations"

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  checkRateLimits: vi.fn(),
}))

const mockCheckRateLimits = vi.mocked(checkRateLimits)

const localStorageMock = (() => {
  let store = new Map<string, string>()

  return {
    clear: () => {
      store = new Map()
    },
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
})()

function chatRow(id: string): Chats {
  return {
    id,
    title: "Question",
    model: "openai/gpt-5-mini",
    system_prompt: "system",
    user_id: "guest_1",
    public: false,
    project_id: null,
    pinned: false,
    pinned_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  }
}

function localFirstTurn(id: string): FirstTurnChat {
  return { kind: "local", chat: chatRow(id) }
}

function durableFirstTurn(id: string, userMessageId = "msg_1"): FirstTurnChat {
  return {
    kind: "durable",
    chat: chatRow(id),
    userMessageId,
    attachments: [],
  }
}

function turnArgs(overrides: Partial<Parameters<ReturnType<typeof useChatOperations>["ensureChatExists"]>[0]> = {}) {
  return {
    userId: "guest_1",
    text: "Question",
    clientMessageId: "optimistic-1",
    attachmentIds: [],
    ...overrides,
  }
}

type ChatOperations = ReturnType<typeof useChatOperations>
type ChatOperationsProps = Parameters<typeof useChatOperations>[0]

describe("useChatOperations", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: localStorageMock,
    })
  })

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockCheckRateLimits.mockResolvedValue({
      remaining: 10,
    })
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => mountedRoot.unmount())
    }
    container?.remove()
    container = null
    root = null
  })

  // The hook owns first-turn allocation lifecycle state (an effect resets the
  // allocation on Back to the no-chat surface), so tests render it.
  function renderOperations(initialProps: ChatOperationsProps) {
    const operationsRef: { current: ChatOperations | null } = { current: null }

    function Harness({ hookProps }: { hookProps: ChatOperationsProps }) {
      const operations = useChatOperations(hookProps)
      useEffect(() => {
        operationsRef.current = operations
      })
      return null
    }

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    const render = (hookProps: ChatOperationsProps) => {
      act(() => {
        root?.render(<Harness hookProps={hookProps} />)
      })
    }
    render(initialProps)

    return {
      operations: () => {
        const operations = operationsRef.current
        if (!operations) throw new Error("useChatOperations not rendered")
        return operations
      },
      rerender: render,
    }
  }

  function baseProps(
    overrides: Partial<ChatOperationsProps> = {}
  ): ChatOperationsProps {
    const minted = ["chat-minted", "chat-reminted"]
    return {
      isAuthenticated: true,
      chatId: null,
      selectedModel: "openai/gpt-5-mini",
      systemPrompt: "system",
      createFirstTurnChat: vi.fn(),
      commitChatIdentity: vi.fn(),
      resetChatIdentity: vi.fn(),
      setHasDialogAuth: vi.fn(),
      createChatId: () => minted.shift() ?? "chat-overflow",
      ...overrides,
    }
  }

  it("commits the minted identity at begin and creates the guest chat under it", async () => {
    localStorage.setItem(GUEST_CHAT_STORAGE_KEY, "stale-guest-chat")
    const createFirstTurnChat = vi
      .fn<(input: unknown) => Promise<FirstTurnChatResult>>()
      .mockResolvedValue(localFirstTurn("chat-minted"))
    const props = baseProps({ isAuthenticated: false, createFirstTurnChat })
    const { operations } = renderOperations(props)

    // Synchronous: the route commits before any creation is awaited.
    expect(operations().beginFirstTurn()).toBe("chat-minted")
    expect(props.commitChatIdentity).toHaveBeenCalledWith("chat-minted")
    expect(createFirstTurnChat).not.toHaveBeenCalled()

    const ensured = await operations().ensureChatExists(turnArgs())

    expect(ensured).toEqual({ chatId: "chat-minted" })
    expect(createFirstTurnChat).toHaveBeenCalledWith({
      publicId: "chat-minted",
      model: "openai/gpt-5-mini",
      systemPrompt: "system",
      guestUserId: "guest_1",
      message: { clientMessageId: "optimistic-1", text: "Question" },
      attachmentIds: [],
    })
    expect(localStorage.getItem(GUEST_CHAT_STORAGE_KEY)).toBe("chat-minted")
    // Committed: a later rollback is a no-op (ADR-0012 keeps the chat).
    operations().rollbackFirstTurn()
    expect(props.resetChatIdentity).not.toHaveBeenCalled()
  })

  it("creates a durable first turn under the committed id even after the chatId prop caught up", async () => {
    const createFirstTurnChat = vi
      .fn<(input: unknown) => Promise<FirstTurnChatResult>>()
      .mockResolvedValue({
        kind: "durable",
        chat: chatRow("chat-minted"),
        userMessageId: "msg_first",
        attachments: [
          {
            name: "notes.pdf",
            contentType: "application/pdf",
            url: "https://files.test/notes.pdf",
            attachmentId: "attachment-1",
          },
        ],
      })
    const props = baseProps({ projectId: "project-1", createFirstTurnChat })
    const { operations, rerender } = renderOperations(props)

    operations().beginFirstTurn()
    // The session commit re-renders the surface with the new id before the
    // rate-limit read resolves; creation must still happen.
    rerender({ ...props, chatId: "chat-minted" })

    const ensured = await operations().ensureChatExists(
      turnArgs({
        userId: "user-1",
        text: "Read this",
        attachmentIds: ["attachment-1"],
      })
    )

    expect(ensured).toEqual({
      chatId: "chat-minted",
      firstTurn: {
        userMessageId: "msg_first",
        clientMessageId: "optimistic-1",
        attachments: [
          expect.objectContaining({ attachmentId: "attachment-1" }),
        ],
        confirmDispatched: expect.any(Function),
      },
    })
    expect(createFirstTurnChat).toHaveBeenCalledWith({
      publicId: "chat-minted",
      model: "openai/gpt-5-mini",
      systemPrompt: "system",
      projectId: "project-1",
      message: { clientMessageId: "optimistic-1", text: "Read this" },
      attachmentIds: ["attachment-1"],
    })
  })

  it("rolls the identity back when creation fails before the commit lands", async () => {
    const props = baseProps({
      createFirstTurnChat: vi.fn().mockResolvedValue(undefined),
    })
    const { operations } = renderOperations(props)

    operations().beginFirstTurn()
    await expect(
      operations().ensureChatExists(turnArgs({ userId: "user-1" }))
    ).resolves.toBeNull()

    operations().rollbackFirstTurn()
    expect(props.resetChatIdentity).toHaveBeenCalledOnce()
    // The allocation is gone: the next Send mints afresh.
    expect(operations().beginFirstTurn()).toBe("chat-reminted")
  })

  it("re-mints exactly once on a server id conflict, re-committing the route in place", async () => {
    const createFirstTurnChat = vi
      .fn<(input: unknown) => Promise<FirstTurnChatResult>>()
      .mockResolvedValueOnce({ kind: "conflict" })
      .mockResolvedValueOnce({ kind: "conflict" })
    const props = baseProps({ createFirstTurnChat })
    const { operations } = renderOperations(props)

    operations().beginFirstTurn()
    await expect(
      operations().ensureChatExists(turnArgs({ userId: "user-1" }))
    ).resolves.toBeNull()

    expect(vi.mocked(props.commitChatIdentity).mock.calls).toEqual([
      ["chat-minted"],
      ["chat-reminted"],
    ])
    expect(createFirstTurnChat).toHaveBeenCalledTimes(2)
    expect(createFirstTurnChat).toHaveBeenLastCalledWith(
      expect.objectContaining({ publicId: "chat-reminted" })
    )
  })

  it("re-presents the committed identity on a same-payload retry until a dispatch is accepted", async () => {
    const createFirstTurnChat = vi
      .fn<(input: unknown) => Promise<FirstTurnChatResult>>()
      .mockResolvedValue(durableFirstTurn("chat-minted", "msg_first"))
    const props = baseProps({ createFirstTurnChat })
    const { operations, rerender } = renderOperations(props)

    // Commit succeeds; the dispatch then fails, so confirmDispatched is never
    // called by the runner.
    operations().beginFirstTurn()
    const first = await operations().ensureChatExists(
      turnArgs({ userId: "user-1" })
    )
    expect(first?.firstTurn?.clientMessageId).toBe("optimistic-1")

    // Retry with the same payload but a freshly allocated optimistic id, with
    // the chatId prop on the committed route. The ORIGINAL committed identity
    // comes back, so the dispatch claims the persisted row.
    rerender({ ...props, chatId: "chat-minted" })
    const retried = await operations().ensureChatExists(
      turnArgs({ userId: "user-1", clientMessageId: "optimistic-2" })
    )
    expect(retried).toEqual({
      chatId: "chat-minted",
      firstTurn: {
        userMessageId: "msg_first",
        clientMessageId: "optimistic-1",
        attachments: [],
        confirmDispatched: expect.any(Function),
      },
    })
    expect(createFirstTurnChat).toHaveBeenCalledTimes(1)

    // A different payload never claims the committed row — it appends to the
    // allocated chat as a normal turn.
    await expect(
      operations().ensureChatExists(
        turnArgs({ userId: "user-1", text: "Different question" })
      )
    ).resolves.toEqual({ chatId: "chat-minted" })

    // Acceptance consumes the identity: after confirmDispatched, an identical
    // payload is a genuine new message, not a claim.
    retried?.firstTurn?.confirmDispatched?.()
    await expect(
      operations().ensureChatExists(
        turnArgs({ userId: "user-1", clientMessageId: "optimistic-3" })
      )
    ).resolves.toEqual({ chatId: "chat-minted" })
  })

  it("starts a fresh allocation after Back to the no-chat surface instead of reusing the previous chat", async () => {
    const createFirstTurnChat = vi
      .fn<(input: unknown) => Promise<FirstTurnChatResult>>()
      .mockResolvedValueOnce(durableFirstTurn("chat-minted"))
      .mockResolvedValueOnce(durableFirstTurn("chat-reminted"))
    const props = baseProps({ projectId: "project-1", createFirstTurnChat })
    const { operations, rerender } = renderOperations(props)

    operations().beginFirstTurn()
    await expect(
      operations().ensureChatExists(turnArgs({ userId: "user-1", text: "first" }))
    ).resolves.toEqual(expect.objectContaining({ chatId: "chat-minted" }))

    // The shallow commit hands the mounted surface its chat route, then the
    // user presses Back to the onboarding route — no remount either way.
    rerender({ ...props, chatId: "chat-minted" })
    rerender({ ...props, chatId: null })

    expect(operations().beginFirstTurn()).toBe("chat-reminted")
    await expect(
      operations().ensureChatExists(turnArgs({ userId: "user-1", text: "second" }))
    ).resolves.toEqual(expect.objectContaining({ chatId: "chat-reminted" }))
    expect(createFirstTurnChat).toHaveBeenCalledTimes(2)
  })

  it("keeps an already active chat session without creating a new one", async () => {
    const props = baseProps({ isAuthenticated: false, chatId: "chat-active" })
    const { operations } = renderOperations(props)

    await expect(
      operations().ensureChatExists(turnArgs())
    ).resolves.toEqual({ chatId: "chat-active" })
    expect(props.createFirstTurnChat).not.toHaveBeenCalled()
    expect(props.commitChatIdentity).not.toHaveBeenCalled()
  })
})
