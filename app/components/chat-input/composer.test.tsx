/** @vitest-environment jsdom */

import type { Id } from "@/convex/_generated/dataModel"
import { resolveGenerationPresentation } from "@/lib/chat-runs/run-presentation"
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
type PendingAttachment = import("./pending-attachment").PendingAttachment
const promptInputMockCalls: Array<{
  expanded?: boolean
  entities?: readonly {
    id: string
    kind: "capability"
    label: string
    removable?: boolean
  }[]
  maxHeight?: number | string
  onEntitiesChange?: (
    entities: readonly {
      id: string
      kind: "capability"
      label: string
      removable?: boolean
    }[]
  ) => void
  value?: string
  onValueChange?: (value: string) => void
  onSubmit?: () => void
}> = []
const promptInputActionMockCalls: Array<{
  disabled?: boolean
  tooltip: React.ReactNode
}> = []
const modelSelectorMockCalls: Array<{
  onSelectionCommitted?: () => void
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
  enableSearch: false,
  searchMode: "optional" as "optional" | "always-on" | "unsupported",
  setEnableSearch: vi.fn(),
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
    enableSearch: composerMocks.enableSearch,
    searchMode: composerMocks.searchMode,
    setEnableSearch: composerMocks.setEnableSearch,
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
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
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
  ModelSelector: (props: { onSelectionCommitted?: () => void }) => {
    modelSelectorMockCalls.push(props)
    return null
  },
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
    entities,
    maxHeight,
    onEntitiesChange,
    value,
    onValueChange,
    onSubmit,
  }: {
    children: React.ReactNode
    expanded?: boolean
    entities?: readonly {
      id: string
      kind: "capability"
      label: string
    }[]
    maxHeight?: number | string
    onEntitiesChange?: (
      entities: readonly { id: string; kind: "capability"; label: string }[]
    ) => void
    value?: string
    onValueChange?: (value: string) => void
    onSubmit?: () => void
  }) => {
    promptInputMockCalls.push({
      expanded,
      entities,
      maxHeight,
      onEntitiesChange,
      value,
      onValueChange,
      onSubmit,
    })
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit?.()
        }}
      >
        {children}
      </form>
    )
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
  PromptInputActions: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  PromptInputFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PromptInputTextarea: React.forwardRef<
    {
      focus: (options?: FocusOptions) => void
      setSelectionRange: (start: number, end: number) => void
    },
    Omit<
      React.TextareaHTMLAttributes<HTMLTextAreaElement>,
      "onKeyDown" | "onPaste"
    > & {
      containerClassName?: string
      onKeyDown?: (event: KeyboardEvent) => void
      onPaste?: (event: ClipboardEvent) => void
    }
  >(function PromptInputTextarea(
    { containerClassName, onKeyDown, onPaste, ...props },
    ref
  ) {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    React.useImperativeHandle(ref, () => ({
      focus: (options) => textareaRef.current?.focus(options),
      setSelectionRange: (start, end) =>
        textareaRef.current?.setSelectionRange(start, end),
    }))
    return (
      <textarea
        ref={textareaRef}
        onKeyDown={(event) => onKeyDown?.(event.nativeEvent)}
        onPaste={(event) => onPaste?.(event.nativeEvent)}
        {...props}
      />
    )
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
    modelSelectorMockCalls.length = 0
    composerMocks.draftValue = ""
    composerMocks.draftById.clear()
    composerMocks.setDraftFns.clear()
    composerMocks.clearDraftFns.clear()
    composerMocks.setDraftValueById.length = 0
    composerMocks.clearDraftById.length = 0
    composerMocks.attachments = []
    composerMocks.enableSearch = false
    composerMocks.searchMode = "optional"
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

  it("keeps ChatGPT's trailing control spacing across input modes", () => {
    const mounted = renderComposer({})
    const trailing = mounted.querySelector<HTMLElement>(
      "[data-composer-trailing]"
    )
    const [modelGroup, actionGroup] = Array.from(trailing?.children ?? [])

    expect(trailing?.className).toContain("gap-1")
    expect(trailing?.className).not.toContain("cant-hover:")
    expect(modelGroup?.className).toContain("gap-1.5")
    expect(modelGroup?.className).not.toContain("cant-hover:")
    expect(actionGroup?.className).toContain("gap-2")
    expect(actionGroup?.className).not.toContain("cant-hover:")
  })

  it("projects Web Search into a typed entity and writes entity removal back", () => {
    composerMocks.enableSearch = true
    renderComposer({})

    const promptInput = promptInputMockCalls.at(-1)
    expect(promptInput?.entities).toEqual([
      { id: "web-search", kind: "capability", label: "Web search" },
    ])
    expect(container?.querySelector("textarea")?.placeholder).toBe(
      "Search the web"
    )

    act(() => promptInput?.onEntitiesChange?.([]))
    expect(composerMocks.setEnableSearch).toHaveBeenCalledWith(false)
  })

  it("projects always-on search as a locked status entity", () => {
    composerMocks.enableSearch = true
    composerMocks.searchMode = "always-on"
    renderComposer({})

    const promptInput = promptInputMockCalls.at(-1)
    expect(promptInput?.entities).toEqual([
      {
        id: "web-search",
        kind: "capability",
        label: "Web search always on",
        removable: false,
      },
    ])

    act(() => promptInput?.onEntitiesChange?.([]))
    expect(composerMocks.setEnableSearch).not.toHaveBeenCalled()
  })

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
    expect(button?.getAttribute("aria-disabled")).toBe("false")
    expect(button?.type).toBe("button")
    expect(button?.className).toContain("can-hover:after:-inset-x-1")

    act(() => {
      button?.click()
    })

    expect(stop).toHaveBeenCalledTimes(1)
    expect(onTurn).not.toHaveBeenCalled()
  })

  it("presents Stop through the pre-acceptance dispatch window (submit in flight, no run identity yet)", () => {
    const onTurn = vi.fn()
    const stop = vi.fn()

    const mounted = renderComposer({
      onTurn,
      stop,
      isSubmitting: true,
      status: "ready",
      stoppable: false,
    })

    const button = mounted.querySelector(
      'button[aria-label="Stop"]'
    ) as HTMLButtonElement | null
    expect(button).toBeTruthy()
    expect(button?.disabled).toBe(false)

    act(() => {
      button?.click()
    })

    // Routes to the orchestrated stop (deferred exact-run semantics live
    // there), never to a send.
    expect(stop).toHaveBeenCalledTimes(1)
    expect(onTurn).not.toHaveBeenCalled()
  })

  it("does not present Stop while submitting without a stop handler", () => {
    const onTurn = vi.fn()
    const mounted = renderComposer({
      onTurn,
      isSubmitting: true,
      status: "ready",
      stoppable: false,
    })

    expect(mounted.querySelector('button[aria-label="Stop"]')).toBeNull()
    const sendButton = mounted.querySelector(
      'button[aria-label="Send prompt"]'
    ) as HTMLButtonElement | null
    expect(sendButton).toBeTruthy()
    expect(sendButton?.disabled).toBe(false)
    expect(sendButton?.getAttribute("aria-disabled")).toBe("true")
    expect(sendButton?.hasAttribute("data-visually-disabled")).toBe(true)
    expect(sendButton?.type).toBe("submit")
    expect(sendButton?.className).toContain("composer-submit-btn")
    expect(sendButton?.className).toContain("can-hover:after:-inset-x-1")
    expect(promptInputActionMockCalls.at(-1)?.disabled).toBeUndefined()

    act(() => sendButton?.click())
    expect(onTurn).not.toHaveBeenCalled()
  })

  it('labels an empty disabled Send action as "Message is empty"', () => {
    composerMocks.draftValue = ""

    renderComposer({ isSubmitting: false, status: "ready" })

    expect(promptInputActionMockCalls.at(-1)?.tooltip).toBe("Message is empty")
  })

  it("routes native form submission through the guarded send contract", async () => {
    composerMocks.draftValue = "send through form"
    const onTurn = vi.fn(async () => true)

    renderComposer({ onTurn, isSubmitting: false, status: "ready" })

    await act(async () => {
      promptInputMockCalls.at(-1)?.onSubmit?.()
      await Promise.resolve()
    })

    expect(onTurn).toHaveBeenCalledOnce()
    expect(onTurn).toHaveBeenCalledWith({
      text: "send through form",
      files: [],
      attachments: [],
    })
  })

  it("keeps the shared default placeholder and accepts narrow surface copy", () => {
    const defaultComposer = renderComposer({ status: "ready" })
    expect(promptInputMockCalls.at(-1)?.maxHeight).toBeUndefined()
    expect(defaultComposer.querySelector("textarea")?.placeholder).toBe(
      "Ask anything"
    )
    expect(defaultComposer.querySelector("textarea")?.ariaLabel).toBe(
      "Chat with ChatGPT"
    )
    expect(
      defaultComposer
        .querySelector("textarea")
        ?.closest<HTMLDivElement>('div[class*="order-2"]')?.className
    ).toContain("sm:pb-4")
    expect(
      defaultComposer
        .querySelector("textarea")
        ?.closest<HTMLDivElement>('div[class*="order-2"]')?.className
    ).toContain("z-1")
    expect(
      defaultComposer.querySelector('[data-composer-transition-slot="leading"]')
    ).not.toBeNull()
    expect(
      defaultComposer.querySelector(
        '[data-composer-transition-slot="trailing"]'
      )
    ).not.toBeNull()

    act(() => {
      root?.render(
        composerElement({
          status: "ready",
          placeholder: "New chat in Investing",
          ariaLabel: "New chat in Investing project",
          bottomSpacing: "none",
        })
      )
    })
    expect(defaultComposer.querySelector("textarea")?.placeholder).toBe(
      "New chat in Investing"
    )
    expect(defaultComposer.querySelector("textarea")?.ariaLabel).toBe(
      "New chat in Investing project"
    )
    expect(
      defaultComposer
        .querySelector("textarea")
        ?.closest<HTMLDivElement>('div[class*="order-2"]')?.className
    ).toContain("sm:pb-0")
  })

  it("restores editor focus without moving the caret after model selection", () => {
    const mounted = renderComposer({ status: "ready" })
    const textarea = mounted.querySelector("textarea") as HTMLTextAreaElement
    const outsideButton = document.createElement("button")
    mounted.appendChild(outsideButton)

    textarea.value = "draft text"
    textarea.setSelectionRange(5, 5)
    outsideButton.focus()
    expect(document.activeElement).toBe(outsideButton)

    act(() => {
      modelSelectorMockCalls.at(-1)?.onSelectionCommitted?.()
    })

    expect(document.activeElement).toBe(textarea)
    expect(textarea.selectionStart).toBe(5)
    expect(textarea.selectionEnd).toBe(5)
  })

  it("does not resurrect Stop from local streaming while the resolver says a Stop is pending", () => {
    const stop = vi.fn()
    const mounted = renderComposer({
      stop,
      isSubmitting: false,
      status: "streaming",
      stoppable: false,
    })

    expect(mounted.querySelector('button[aria-label="Stop"]')).toBeNull()
    expect(stop).not.toHaveBeenCalled()
  })

  it("routes a history chat's projection-gap Stop through the real primary control", () => {
    const presentation = resolveGenerationPresentation({
      localStatus: "submitted",
      isSubmitting: false,
      localAssistantMessageId: null,
      selectedRun: {
        runId: "run_previous" as Id<"generationRuns">,
        assistantMessageId: "msg_previous" as Id<"messages">,
        status: "completed",
        terminalReason: "completed",
        activeToolNames: [],
        pendingApproval: null,
      },
      pendingStopRunId: null,
      isConnected: true,
      now: 1,
    })
    const stop = vi.fn()
    const mounted = renderComposer({
      chatId: "chat_with_history",
      status: "submitted",
      stoppable: presentation.stoppable,
      stop,
    })

    expect(presentation).toMatchObject({
      state: "local-submitted",
      stoppable: true,
      stopTargetRunId: null,
    })
    const button = mounted.querySelector(
      'button[aria-label="Stop"]'
    ) as HTMLButtonElement | null
    expect(button?.disabled).toBe(false)

    act(() => button?.click())

    // stopTargetRunId=null is the controller's explicit deferred-Stop branch;
    // this proves the real Composer control reaches it rather than only unit-
    // invoking useChatCore's returned callback.
    expect(stop).toHaveBeenCalledTimes(1)
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
    expect(promptInputMockCalls.at(-1)?.expanded).toBe(false)

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

  it("accepts an attachment-only turn (empty text, ready attachment)", async () => {
    // The acceptance predicate every surface shares (home and project): a
    // ready attachment alone is a sendable turn. This is the case that used
    // to strand empty project chats behind a text-only gate.
    const onTurn = vi.fn(async () => true)
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
    const mounted = renderComposer({
      onTurn,
      isSubmitting: false,
      status: "ready",
    })

    const sendButton = mounted.querySelector(
      '[data-testid="send-button"]'
    ) as HTMLButtonElement
    expect(sendButton.disabled).toBe(false)
    expect(sendButton.type).toBe("submit")

    await act(async () => {
      sendButton.click()
    })

    expect(onTurn).toHaveBeenCalledTimes(1)
    expect(onTurn).toHaveBeenCalledWith({
      text: "",
      files: composerMocks.attachments.map(
        (attachment) => (attachment as { file: File }).file
      ),
      attachments: [expect.objectContaining({ attachmentId: "attachment-1" })],
    })
  })

  it("keeps Send visually disabled while an attachment is uploading or failed", () => {
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
    const uploadingSend = mounted.querySelector(
      '[data-testid="send-button"]'
    ) as HTMLButtonElement
    expect(uploadingSend.disabled).toBe(false)
    expect(uploadingSend.getAttribute("aria-disabled")).toBe("true")
    expect(uploadingSend.hasAttribute("data-visually-disabled")).toBe(true)

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
    const failedSend = mounted.querySelector(
      '[data-testid="send-button"]'
    ) as HTMLButtonElement
    expect(failedSend.disabled).toBe(false)
    expect(failedSend.getAttribute("aria-disabled")).toBe("true")
    expect(failedSend.hasAttribute("data-visually-disabled")).toBe(true)
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
    expect(composerMocks.lockAttachments).toHaveBeenCalledWith(["attachment-1"])
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
