/** @vitest-environment jsdom */
import type { UIMessage } from "@ai-sdk/react"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { MessageAssistant } from "./message-assistant"

vi.mock("@/lib/user-preference-store/provider", () => ({
  useUserPreferences: () => ({
    preferences: {
      showToolInvocations: false,
    },
  }),
}))

beforeAll(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
  // MessageContent loads Markdown via next/dynamic; preload it so the dynamic
  // import resolves before the render flush. Otherwise the markdown chunk lands
  // after the test's microtask and the rendered answer content is missing — a
  // fragility previously masked by an incidental static import of markdown
  // through reasoning.tsx (decoupled when formatDuration moved to lib).
  await import("@/components/ui/markdown")
})

describe("MessageAssistant activity trigger", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
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

  it("keeps the activity trigger for completed opaque reasoning", () => {
    const onActivityPanelOpenChange = vi.fn()
    const parts = [
      { type: "reasoning", text: "", state: "done" },
    ] as unknown as UIMessage["parts"]

    act(() => {
      root?.render(
        <MessageAssistant
          messageId="assistant-1"
          activeTurnId="assistant-1"
          activityPanel={{
            open: false,
            onOpenChange: onActivityPanelOpenChange,
            panelId: "activity-panel",
          }}
          parts={parts}
          metadata={{ reasoningDurationMs: 2000 }}
          status="ready"
        >
          {""}
        </MessageAssistant>
      )
    })

    const trigger = container?.querySelector(
      'button[aria-label="Open activity: Thought for 2s"]'
    ) as HTMLButtonElement | null

    expect(trigger).toBeTruthy()
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    expect(trigger?.getAttribute("aria-controls")).toBe("activity-panel")

    act(() => {
      trigger?.click()
    })

    expect(onActivityPanelOpenChange).toHaveBeenCalledWith(true)
  })

  it("renders the activity trigger for submitted pre-stream state without duplicate loading UI", () => {
    const onActivityPanelOpenChange = vi.fn()

    act(() => {
      root?.render(
        <MessageAssistant
          messageId="pending-assistant"
          activeTurnId="pending-assistant"
          activityPanel={{
            open: false,
            onOpenChange: onActivityPanelOpenChange,
            panelId: "activity-panel",
          }}
          parts={[]}
          status="submitted"
          isLast
        >
          {""}
        </MessageAssistant>
      )
    })

    const trigger = container?.querySelector(
      'button[aria-label="Open activity: Thinking"]'
    ) as HTMLButtonElement | null

    expect(trigger).toBeTruthy()
    expect(container?.textContent).toContain("Thinking")
    expect(container?.textContent).not.toContain("Generating")

    act(() => {
      trigger?.click()
    })

    expect(onActivityPanelOpenChange).toHaveBeenCalledWith(true)
  })

  it("renders the activity trigger for tool-only turns", () => {
    const onActivityPanelOpenChange = vi.fn()
    const parts = [
      {
        type: "tool-search",
        toolCallId: "tool-call-1",
        state: "output-available",
        input: { query: "weather" },
        output: { summary: "Cloudy" },
      },
    ] as unknown as UIMessage["parts"]

    act(() => {
      root?.render(
        <MessageAssistant
          messageId="tool-only-assistant"
          activeTurnId="tool-only-assistant"
          activityPanel={{
            open: false,
            onOpenChange: onActivityPanelOpenChange,
            panelId: "activity-panel",
          }}
          parts={parts}
          status="ready"
        >
          {""}
        </MessageAssistant>
      )
    })

    const trigger = container?.querySelector(
      'button[aria-label="Open activity: Activity"]'
    ) as HTMLButtonElement | null

    expect(trigger).toBeTruthy()
    expect(container?.textContent).toContain("Activity")
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    expect(trigger?.getAttribute("aria-controls")).toBe("activity-panel")

    act(() => {
      trigger?.click()
    })

    expect(onActivityPanelOpenChange).toHaveBeenCalledWith(true)
  })

  it("renders the activity trigger before content and footer actions", async () => {
    const parts = [
      { type: "reasoning", text: "", state: "done" },
    ] as unknown as UIMessage["parts"]

    await act(async () => {
      root?.render(
        <MessageAssistant
          messageId="assistant-1"
          activeTurnId="assistant-1"
          activityPanel={{
            open: false,
            onOpenChange: () => {},
            panelId: "activity-panel",
          }}
          copied={false}
          copyToClipboard={() => {}}
          parts={parts}
          metadata={{ reasoningDurationMs: 2000 }}
          status="ready"
        >
          {"Assistant answer"}
        </MessageAssistant>
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const answer = Array.from(container?.querySelectorAll("*") ?? []).find(
      (element) =>
        element.textContent === "Assistant answer" ||
        element.textContent?.trim() === "Assistant answer"
    )
    const trigger = container?.querySelector(
      'button[aria-label="Open activity: Thought for 2s"]'
    )
    const copy = container?.querySelector('button[aria-label="Copy text"]')

    expect(answer).toBeTruthy()
    expect(trigger).toBeTruthy()
    expect(copy).toBeTruthy()
    expect(
      trigger!.compareDocumentPosition(answer!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      answer!.compareDocumentPosition(copy!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
