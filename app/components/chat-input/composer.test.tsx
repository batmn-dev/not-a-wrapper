/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

let Composer: (typeof import("./composer"))["Composer"]
type ComposerHandle = import("./composer").ComposerHandle
const promptInputMockCalls: Array<{
  expanded?: boolean
  maxHeight?: number | string
  value?: string
}> = []

// Controllable module state for the Composer's internal seams.
const composerMocks = vi.hoisted(() => ({
  draftValue: "",
  files: [] as File[],
  setDraftValue: vi.fn(),
  clearDraft: vi.fn(),
}))

beforeAll(async () => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  ;({ Composer } = await import("./composer"))
})

vi.mock("@/app/components/chat/turn-context", () => ({
  useTurnContext: () => ({
    selectedModel: "openai/gpt-4.1-mini",
    handleModelChange: vi.fn(),
    enableSearch: false,
    setEnableSearch: vi.fn(),
    isAuthenticated: true,
    systemPrompt: "system",
    isHydrated: true,
    getTurnSnapshot: () => ({
      selectedModel: "openai/gpt-4.1-mini",
      systemPrompt: "system",
      enableSearch: false,
      isAuthenticated: true,
      isHydrated: true,
    }),
  }),
}))

vi.mock("@/lib/user-store/provider", () => ({
  useUser: () => ({ user: { id: "user-1" } }),
}))

vi.mock("@/app/hooks/use-chat-draft", () => ({
  useChatDraft: () => ({
    draftValue: composerMocks.draftValue,
    setDraftValue: composerMocks.setDraftValue,
    clearDraft: composerMocks.clearDraft,
  }),
}))

vi.mock("@/app/components/chat/use-file-upload", () => ({
  useFileUpload: () => ({
    files: composerMocks.files,
    handleFileUpload: vi.fn(),
    handleFileRemove: vi.fn(),
    clearFiles: vi.fn(),
    restoreFiles: vi.fn(),
  }),
}))

vi.mock("@/components/common/model-selector/base", () => ({
  ModelSelector: () => null,
}))

vi.mock("server-only", () => ({}))

vi.mock("./input-drop-zone", () => ({
  InputDropZone: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock("@/components/ui/prompt-input", () => ({
  PromptInput: ({
    children,
    expanded,
    maxHeight,
    value,
  }: {
    children: React.ReactNode
    expanded?: boolean
    maxHeight?: number | string
    value?: string
  }) => {
    promptInputMockCalls.push({ expanded, maxHeight, value })
    return <div>{children}</div>
  },
  PromptInputAction: ({
    children,
  }: {
    tooltip: React.ReactNode
    children: React.ReactNode
  }) => <div>{children}</div>,
  PromptInputActions: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PromptInputFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PromptInputTextarea: React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
      containerClassName?: string
    }
  >(function PromptInputTextarea({ containerClassName, ...props }, ref) {
    return <textarea ref={ref} {...props} />
  }),
}))

vi.mock("../suggestions/prompt-system", () => ({
  PromptSystem: () => null,
}))

vi.mock("./button-plus-menu", () => ({
  ButtonPlusMenu: () => null,
}))

vi.mock("./file-list", () => ({
  FileList: () => null,
}))

describe("Composer primary action", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    promptInputMockCalls.length = 0
    composerMocks.draftValue = ""
    composerMocks.files = []
    vi.clearAllMocks()
  })

  afterEach(() => {
    const rootToUnmount = root
    if (rootToUnmount) {
      act(() => {
        rootToUnmount.unmount()
      })
    }
    container?.remove()
    root = null
    container = null
  })

  function renderComposer(
    props: Partial<React.ComponentProps<typeof Composer>> & {
      ref?: React.Ref<ComposerHandle>
    }
  ) {
    const mountedContainer = document.createElement("div")
    document.body.appendChild(mountedContainer)
    container = mountedContainer
    const mountedRoot = createRoot(mountedContainer)
    root = mountedRoot

    act(() => {
      mountedRoot.render(
        <Composer chatId={null} onTurn={() => false} {...props} />
      )
    })
    return mountedContainer
  }

  it("keeps Stop actionable while streaming even with empty input", () => {
    const onTurn = vi.fn()
    const stop = vi.fn()

    const mounted = renderComposer({
      onTurn,
      stop,
      isSubmitting: false,
      status: "streaming",
    })

    const button = mounted.querySelector(
      'button[aria-label="Stop"]'
    ) as HTMLButtonElement | null

    expect(button).toBeTruthy()
    expect(button?.disabled).toBe(false)

    act(() => {
      button?.click()
    })

    expect(stop).toHaveBeenCalledTimes(1)
    expect(onTurn).not.toHaveBeenCalled()
  })

  it("stays compact when empty; expands for hard newlines and attached files", () => {
    const unmountCurrent = () => {
      const mountedRoot = root
      if (mountedRoot) {
        act(() => {
          mountedRoot.unmount()
        })
      }
      container?.remove()
    }

    renderComposer({ isSubmitting: false, status: "ready" })
    expect(promptInputMockCalls.at(-1)).toMatchObject({
      expanded: false,
      maxHeight: "max(30svh, 5rem)",
    })

    unmountCurrent()
    composerMocks.draftValue = "line one\nline two"
    renderComposer({ isSubmitting: false, status: "ready" })
    expect(promptInputMockCalls.at(-1)?.expanded).toBe(true)

    unmountCurrent()
    composerMocks.draftValue = ""
    composerMocks.files = [
      new File(["hello"], "hello.txt", { type: "text/plain" }),
    ]
    renderComposer({ isSubmitting: false, status: "ready" })
    expect(promptInputMockCalls.at(-1)?.expanded).toBe(true)
  })

  it("emits one turn payload on send and clears the draft only on success", async () => {
    const attachment = new File(["hello"], "hello.txt", { type: "text/plain" })
    composerMocks.draftValue = "hello there"
    composerMocks.files = [attachment]

    const onTurn = vi.fn(async () => true)
    const mounted = renderComposer({
      onTurn,
      isSubmitting: false,
      status: "ready",
    })

    const send = mounted.querySelector(
      '[data-testid="send-button"]'
    ) as HTMLButtonElement | null
    expect(send?.disabled).toBe(false)

    await act(async () => {
      send?.click()
      await Promise.resolve()
    })

    expect(onTurn).toHaveBeenCalledWith({
      text: "hello there",
      files: [attachment],
    })
    expect(composerMocks.clearDraft).toHaveBeenCalledTimes(1)
    // Display cleared at handoff (the controlled value the input renders).
    expect(promptInputMockCalls.at(-1)?.value).toBe("")
  })

  it("restores the payload and keeps the persisted draft when the turn is rejected", async () => {
    composerMocks.draftValue = "rejected send"

    const onTurn = vi.fn(async () => false)
    const mounted = renderComposer({
      onTurn,
      isSubmitting: false,
      status: "ready",
    })

    const send = mounted.querySelector(
      '[data-testid="send-button"]'
    ) as HTMLButtonElement | null

    await act(async () => {
      send?.click()
      await Promise.resolve()
    })

    expect(onTurn).toHaveBeenCalledTimes(1)
    expect(composerMocks.clearDraft).not.toHaveBeenCalled()
    // The rejection toast must not fire over an emptied composer: the typed
    // text comes back so the user can fix and resend.
    expect(promptInputMockCalls.at(-1)?.value).toBe("rejected send")
  })

  it("insertQuote persists into the draft; setText is display-only", async () => {
    vi.useFakeTimers()
    try {
      const ref = React.createRef<ComposerHandle>()
      const mounted = renderComposer({
        ref,
        isSubmitting: false,
        status: "ready",
      })

      act(() => {
        ref.current?.insertQuote("quoted line")
      })
      act(() => {
        vi.advanceTimersByTime(600)
      })

      expect(promptInputMockCalls.at(-1)?.value).toContain("> quoted line")
      // Quote insertion routes through the draft debounce — navigating away
      // must not lose the quote.
      expect(composerMocks.setDraftValue).toHaveBeenCalledWith(
        expect.stringContaining("> quoted line")
      )

      composerMocks.setDraftValue.mockClear()
      act(() => {
        ref.current?.setText("?prompt= hydration text")
      })
      act(() => {
        vi.advanceTimersByTime(600)
      })

      expect(promptInputMockCalls.at(-1)?.value).toBe("?prompt= hydration text")
      // setText is display-only: hydrating a shared prompt link must not
      // clobber the chat's persisted draft.
      expect(composerMocks.setDraftValue).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
