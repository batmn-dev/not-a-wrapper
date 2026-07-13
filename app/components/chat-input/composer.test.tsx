/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
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
type PendingAttachment = import("./pending-attachment").PendingAttachment
const promptInputMockCalls: Array<{
  expanded?: boolean
  maxHeight?: number | string
  value?: string
  onValueChange?: (value: string) => void
}> = []
const promptInputActionMockCalls: Array<{
  disabled?: boolean
  tooltip: React.ReactNode
}> = []

// Controllable module state for the Composer's internal seams.
const composerMocks = vi.hoisted(() => ({
  draftValue: "",
  draftById: new Map<string | null, string>(),
  setDraftFns: new Map<string | null, (value: string) => void>(),
  clearDraftFns: new Map<string | null, () => void>(),
  setDraftValueById: [] as Array<{ draftId: string | null; value: string }>,
  clearDraftById: [] as Array<string | null>,
  attachments: [] as PendingAttachment[],
  setDraftValue: vi.fn(),
  clearDraft: vi.fn(),
  handleFileRemove: vi.fn(),
  lockAttachments: vi.fn(() => true),
  unlockAttachments: vi.fn(),
  retryAttachment: vi.fn(),
  consumeAttachments: vi.fn(),
  announce: vi.fn(),
  handleFileUpload: vi.fn(),
  handleLargePaste: vi.fn((text: string) => ({
    id: "generated-paste",
    kind: "generated-large-paste" as const,
    status: "ready" as const,
    file: new File([text], "Pasted text 1.txt", { type: "text/plain" }),
    signature: `paste-${text.length}`,
    text,
    characterCount: text.length,
    preview: text.slice(0, 20),
    delivery: "inline" as const,
    uploaded: null,
  })),
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

vi.mock("convex/react", () => ({
  useConvex: () => ({}),
}))

vi.mock("@/app/hooks/use-chat-draft", () => ({
  useChatDraft: (draftId: string | null) => {
    if (!composerMocks.setDraftFns.has(draftId)) {
      composerMocks.setDraftFns.set(draftId, (value: string) => {
        composerMocks.setDraftValue(value)
        composerMocks.setDraftValueById.push({ draftId, value })
        if (value) {
          composerMocks.draftById.set(draftId, value)
        } else {
          composerMocks.draftById.delete(draftId)
        }
      })
    }

    if (!composerMocks.clearDraftFns.has(draftId)) {
      composerMocks.clearDraftFns.set(draftId, () => {
        composerMocks.clearDraft()
        composerMocks.clearDraftById.push(draftId)
        composerMocks.draftById.delete(draftId)
      })
    }

    return {
      draftValue:
        composerMocks.draftById.get(draftId) ?? composerMocks.draftValue,
      setDraftValue: composerMocks.setDraftFns.get(draftId)!,
      clearDraft: composerMocks.clearDraftFns.get(draftId)!,
    }
  },
}))

vi.mock("@/app/components/chat/use-file-upload", () => ({
  useFilePickerState: () => ({
    attachments: composerMocks.attachments,
    lockedAttachmentIds: new Set<string>(),
    announcement: "",
    announce: composerMocks.announce,
    handleFileUpload: composerMocks.handleFileUpload,
    handleLargePaste: composerMocks.handleLargePaste,
    handleFileRemove: composerMocks.handleFileRemove,
    lockAttachments: composerMocks.lockAttachments,
    unlockAttachments: composerMocks.unlockAttachments,
    retryAttachment: composerMocks.retryAttachment,
    consumeAttachments: composerMocks.consumeAttachments,
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
    onValueChange,
  }: {
    children: React.ReactNode
    expanded?: boolean
    maxHeight?: number | string
    value?: string
    onValueChange?: (value: string) => void
  }) => {
    promptInputMockCalls.push({ expanded, maxHeight, value, onValueChange })
    return <div>{children}</div>
  },
  PromptInputAction: ({
    children,
    disabled,
    tooltip,
  }: {
    disabled?: boolean
    tooltip: React.ReactNode
    children: React.ReactNode
  }) => {
    promptInputActionMockCalls.push({ disabled, tooltip })
    return <div>{children}</div>
  },
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
    promptInputActionMockCalls.length = 0
    composerMocks.draftValue = ""
    composerMocks.draftById.clear()
    composerMocks.setDraftFns.clear()
    composerMocks.clearDraftFns.clear()
    composerMocks.setDraftValueById.length = 0
    composerMocks.clearDraftById.length = 0
    composerMocks.attachments = []
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
      mountedRoot.render(composerElement(props))
    })
    return mountedContainer
  }

  function rerenderComposer(
    props: Partial<React.ComponentProps<typeof Composer>> & {
      ref?: React.Ref<ComposerHandle>
    }
  ) {
    act(() => {
      root?.render(composerElement(props))
    })
  }

  function composerElement(
    props: Partial<React.ComponentProps<typeof Composer>> & {
      ref?: React.Ref<ComposerHandle>
    }
  ) {
    return <Composer chatId={null} onTurn={() => false} {...props} />
  }

  function changeComposerValue(value: string) {
    const onValueChange = promptInputMockCalls.at(-1)?.onValueChange
    expect(onValueChange).toBeTruthy()
    act(() => {
      onValueChange?.(value)
    })
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

  it("shows the Enter shortcut tooltip only when Send is active", () => {
    renderComposer({ isSubmitting: false, status: "ready" })

    expect(promptInputActionMockCalls.at(-1)?.disabled).toBe(true)

    changeComposerValue("Ready to send")

    const activeAction = promptInputActionMockCalls.at(-1)
    expect(activeAction?.disabled).toBe(false)

    const tooltipMarkup = renderToStaticMarkup(<>{activeAction?.tooltip}</>)
    expect(tooltipMarkup).toContain("Send prompt")
    expect(tooltipMarkup).toContain('aria-label="Enter"')
    expect(tooltipMarkup).toContain("↵")
  })

  it("stays compact for empty and attachment-only states; expands for hard newlines", () => {
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
    composerMocks.attachments = [
      {
        id: "attachment-1",
        kind: "selected-file",
        status: "ready",
        file: new File(["hello"], "hello.txt", { type: "text/plain" }),
        signature: "hello",
        uploaded: {
          name: "hello.txt",
          contentType: "text/plain",
          url: "/api/files/attachment-1/preview",
          attachmentId: "attachment-1",
        },
      },
    ]
    renderComposer({ isSubmitting: false, status: "ready" })
    expect(promptInputMockCalls.at(-1)?.expanded).toBe(false)
  })

  it("keeps Send disabled while an attachment is uploading or failed", () => {
    const source = {
      id: "attachment-1",
      kind: "selected-file" as const,
      file: new File(["hello"], "hello.txt", { type: "text/plain" }),
      signature: "hello",
    }
    composerMocks.draftValue = "Read this"
    composerMocks.attachments = [
      { ...source, status: "uploading", attemptId: 1 },
    ]
    let mounted = renderComposer({ isSubmitting: false, status: "ready" })
    expect(
      (
        mounted.querySelector(
          '[data-testid="send-button"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true)

    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    composerMocks.attachments = [
      {
        ...source,
        status: "failed",
        attemptId: 1,
        error: "offline",
        retryable: true,
      },
    ]
    mounted = renderComposer({ isSubmitting: false, status: "ready" })
    expect(
      (
        mounted.querySelector(
          '[data-testid="send-button"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })

  it("does not leak the previous scoped draft when the project scope changes", () => {
    composerMocks.draftById.set("project-a", "project A draft")

    renderComposer({
      draftScopeId: "project-a",
      isSubmitting: false,
      status: "ready",
    })
    expect(promptInputMockCalls.at(-1)?.value).toBe("project A draft")

    rerenderComposer({
      draftScopeId: "project-b",
      isSubmitting: false,
      status: "ready",
    })

    expect(promptInputMockCalls.at(-1)?.value).toBe("")
  })

  it("restores the persisted draft for the active scoped composer", () => {
    renderComposer({
      draftScopeId: "project-a",
      isSubmitting: false,
      status: "ready",
    })
    expect(promptInputMockCalls.at(-1)?.value).toBe("")

    composerMocks.draftById.set("project-a", "persisted project draft")
    rerenderComposer({
      draftScopeId: "project-a",
      isSubmitting: false,
      status: "ready",
    })

    expect(promptInputMockCalls.at(-1)?.value).toBe("persisted project draft")
  })

  it("does not let later scoped draft hydration overwrite active user edits", () => {
    renderComposer({
      draftScopeId: "project-a",
      isSubmitting: false,
      status: "ready",
    })

    changeComposerValue("typed after mount")
    composerMocks.draftById.set("project-a", "older persisted draft")
    rerenderComposer({
      draftScopeId: "project-a",
      isSubmitting: false,
      status: "ready",
    })

    expect(promptInputMockCalls.at(-1)?.value).toBe("typed after mount")
  })

  it("restores the persisted draft when the chat identity changes", () => {
    composerMocks.draftById.set("chat-a", "chat A draft")
    composerMocks.draftById.set("chat-b", "chat B draft")

    renderComposer({
      chatId: "chat-a",
      isSubmitting: false,
      status: "ready",
    })
    expect(promptInputMockCalls.at(-1)?.value).toBe("chat A draft")

    rerenderComposer({
      chatId: "chat-b",
      isSubmitting: false,
      status: "ready",
    })

    expect(promptInputMockCalls.at(-1)?.value).toBe("chat B draft")
  })

  it("emits one turn payload on send and clears the draft only on success", async () => {
    const attachment = new File(["hello"], "hello.txt", { type: "text/plain" })
    composerMocks.draftValue = "hello there"
    composerMocks.attachments = [
      {
        id: "attachment-1",
        kind: "selected-file",
        status: "ready",
        file: attachment,
        signature: "hello-signature",
        uploaded: {
          name: "hello.txt",
          contentType: "text/plain",
          url: "/api/files/attachment-1/preview",
          attachmentId: "attachment-1",
        },
      },
    ]

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
      attachments: [
        {
          name: "hello.txt",
          contentType: "text/plain",
          url: "/api/files/attachment-1/preview",
          attachmentId: "attachment-1",
        },
      ],
    })
    expect(composerMocks.clearDraft).toHaveBeenCalledTimes(1)
    expect(composerMocks.consumeAttachments).toHaveBeenCalledWith([
      "attachment-1",
    ])
    expect(composerMocks.lockAttachments).toHaveBeenCalledWith([
      "attachment-1",
    ])
    expect(composerMocks.unlockAttachments).toHaveBeenCalledWith([
      "attachment-1",
    ])
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

  it("restores the same generated attachment after a rejected send", async () => {
    const generated = composerMocks.handleLargePaste("x".repeat(10_000))
    composerMocks.attachments = [generated]
    const mounted = renderComposer({
      onTurn: vi.fn(async () => false),
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

    expect(composerMocks.consumeAttachments).not.toHaveBeenCalled()
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
