/** @vitest-environment jsdom */

import type { MessageBranchInfo } from "@/lib/chat-messages/branch"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  getMessageBranch,
  MessageBranchControls,
} from "./message-branch-controls"

vi.mock("@/components/ui/message", () => ({
  MessageAction: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock("@/components/ui/icon", () => ({
  Icon: () => null,
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("getMessageBranch gate", () => {
  // The parser itself is covered in lib/chat-messages/branch.test.ts; this only
  // pins the controls' navigability gate, including the C2 relaxation that
  // dropped the brittle `siblings.length === total` requirement.
  it("renders for >=2 siblings even when the sibling list is partial", () => {
    expect(
      getMessageBranch({
        branch: {
          messageId: "m1",
          currentIndex: 1,
          total: 2,
          siblings: [{ messageId: "m1" }],
        },
      })
    ).toMatchObject({ total: 2 })
  })

  it("hides for a single-sibling or missing branch", () => {
    expect(
      getMessageBranch({
        branch: {
          messageId: "m1",
          currentIndex: 0,
          total: 1,
          siblings: [{ messageId: "m1" }],
        },
      })
    ).toBeUndefined()
    expect(getMessageBranch(undefined)).toBeUndefined()
  })
})

describe("MessageBranchControls", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  function cleanupRender() {
    const rootToUnmount = root
    if (rootToUnmount) {
      act(() => rootToUnmount.unmount())
    }
    container?.remove()
    root = null
    container = null
  }

  afterEach(cleanupRender)

  function render(
    branch: MessageBranchInfo | undefined,
    onSelectBranch?: (messageId: string) => void
  ) {
    cleanupRender()

    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)
    act(() => {
      root?.render(
        <MessageBranchControls
          branch={branch}
          onSelectBranch={onSelectBranch}
        />
      )
    })
  }

  const branch: MessageBranchInfo = {
    messageId: "m2",
    currentIndex: 1,
    total: 3,
    siblings: [{ messageId: "m1" }, { messageId: "m2" }, { messageId: "m3" }],
  }

  it("shows the current position and navigates to siblings", () => {
    const onSelectBranch = vi.fn()
    render(branch, onSelectBranch)

    expect(container?.textContent).toContain("2/3")

    const [prev, next] = Array.from(
      container?.querySelectorAll("button") ?? []
    ) as HTMLButtonElement[]

    act(() => prev.click())
    expect(onSelectBranch).toHaveBeenLastCalledWith("m1")

    act(() => next.click())
    expect(onSelectBranch).toHaveBeenLastCalledWith("m3")
  })

  it("disables previous at the first sibling and next at the last", () => {
    render({ ...branch, currentIndex: 0 }, vi.fn())
    const buttons = Array.from(
      container?.querySelectorAll("button") ?? []
    ) as HTMLButtonElement[]
    expect(buttons[0].disabled).toBe(true)
    expect(buttons[1].disabled).toBe(false)
  })

  it("uses 24×30 stepper metrics distinct from the 32px actions", () => {
    // Live-measured 2026-07-11: branch prev/next are h-[30px] w-[24px]
    // rounded-md while standard message actions are h-8 w-8 rounded-lg.
    render(branch, vi.fn())

    const buttons = Array.from(
      container?.querySelectorAll("button") ?? []
    ) as HTMLButtonElement[]
    expect(buttons).toHaveLength(2)
    expect(buttons[0].className).toContain("h-[30px]")
    expect(buttons[0].className).toContain("w-[24px]")
    expect(buttons[0].className).toContain("rounded-[6px]")
    expect(buttons[0].className).toContain("pointer-coarse:w-8")
    expect(buttons[1].className).toBe(buttons[0].className)

    const counter = container?.querySelector("span")
    expect(counter?.className).toContain("px-0.5")
    expect(counter?.className).toContain("text-sm")
    expect(counter?.className).toContain("font-semibold")
  })

  it("renders nothing without a branch or handler", () => {
    render(undefined, vi.fn())
    expect(container?.querySelector("button")).toBeNull()
    render(branch, undefined)
    expect(container?.querySelector("button")).toBeNull()
  })
})
