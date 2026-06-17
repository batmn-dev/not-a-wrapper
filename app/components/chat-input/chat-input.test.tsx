/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

let ChatInput: (typeof import("./chat-input"))["ChatInput"]
const promptInputMockCalls: Array<{
  expanded?: boolean
  maxHeight?: number | string
}> = []

beforeAll(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  ;({ ChatInput } = await import("./chat-input"))
})

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
  }: {
    children: React.ReactNode
    expanded?: boolean
    maxHeight?: number | string
  }) => {
    promptInputMockCalls.push({ expanded, maxHeight })
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

describe("ChatInput primary action", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    promptInputMockCalls.length = 0
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

  it("keeps Stop actionable while streaming even with empty input", () => {
    const onSend = vi.fn()
    const stop = vi.fn()

    const mountedContainer = document.createElement("div")
    document.body.appendChild(mountedContainer)
    container = mountedContainer
    const mountedRoot = createRoot(mountedContainer)
    root = mountedRoot

    act(() => {
      mountedRoot.render(
        <ChatInput
          defaultValue=""
          onValueChange={() => {}}
          onSend={onSend}
          isSubmitting={false}
          files={[]}
          onFileUpload={() => {}}
          onFileRemove={() => {}}
          onSuggestion={() => {}}
          hasSuggestions={false}
          selectedModel="openai/gpt-4.1-mini"
          isUserAuthenticated
          stop={stop}
          status="streaming"
          setEnableSearch={() => {}}
          enableSearch={false}
        />
      )
    })

    const button = mountedContainer.querySelector(
      'button[aria-label="Stop"]'
    ) as HTMLButtonElement | null

    expect(button).toBeTruthy()
    expect(button?.disabled).toBe(false)

    act(() => {
      button?.click()
    })

    expect(stop).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it("keeps the composer compact for empty input", () => {
    const mountedContainer = document.createElement("div")
    document.body.appendChild(mountedContainer)
    container = mountedContainer
    const mountedRoot = createRoot(mountedContainer)
    root = mountedRoot

    act(() => {
      mountedRoot.render(
        <ChatInput
          defaultValue=""
          onValueChange={() => {}}
          onSend={() => {}}
          isSubmitting={false}
          files={[]}
          onFileUpload={() => {}}
          onFileRemove={() => {}}
          onSuggestion={() => {}}
          hasSuggestions={false}
          selectedModel="openai/gpt-4.1-mini"
          isUserAuthenticated
          stop={() => {}}
          status="ready"
          setEnableSearch={() => {}}
          enableSearch={false}
        />
      )
    })

    expect(promptInputMockCalls.at(-1)).toMatchObject({
      expanded: false,
      maxHeight: "max(30svh, 5rem)",
    })
  })

  it("expands the composer for hard newlines and attached files", () => {
    const mountedContainer = document.createElement("div")
    document.body.appendChild(mountedContainer)
    container = mountedContainer
    const mountedRoot = createRoot(mountedContainer)
    root = mountedRoot

    act(() => {
      mountedRoot.render(
        <ChatInput
          defaultValue={"line one\nline two"}
          onValueChange={() => {}}
          onSend={() => {}}
          isSubmitting={false}
          files={[]}
          onFileUpload={() => {}}
          onFileRemove={() => {}}
          onSuggestion={() => {}}
          hasSuggestions={false}
          selectedModel="openai/gpt-4.1-mini"
          isUserAuthenticated
          stop={() => {}}
          status="ready"
          setEnableSearch={() => {}}
          enableSearch={false}
        />
      )
    })

    expect(promptInputMockCalls.at(-1)?.expanded).toBe(true)

    const file = new File(["hello"], "hello.txt", { type: "text/plain" })

    act(() => {
      mountedRoot.render(
        <ChatInput
          defaultValue=""
          onValueChange={() => {}}
          onSend={() => {}}
          isSubmitting={false}
          files={[file]}
          onFileUpload={() => {}}
          onFileRemove={() => {}}
          onSuggestion={() => {}}
          hasSuggestions={false}
          selectedModel="openai/gpt-4.1-mini"
          isUserAuthenticated
          stop={() => {}}
          status="ready"
          setEnableSearch={() => {}}
          enableSearch={false}
        />
      )
    })

    expect(promptInputMockCalls.at(-1)?.expanded).toBe(true)
  })
})
