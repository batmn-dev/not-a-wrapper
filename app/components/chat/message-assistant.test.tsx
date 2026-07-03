/** @vitest-environment jsdom */
import {
  deriveAssistantTurnView,
  type AssistantTurnView,
} from "@/lib/chat-messages/assistant-turn"
import type { UIMessage } from "@ai-sdk/react"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"
import { vi } from "vitest"
import {
  ActivityPanelStoreProvider,
  createActivityPanelStore,
  type ActivityPanelStore,
} from "./activity/activity-panel-store"
import { MessageAssistant } from "./message-assistant"

vi.mock("@/lib/user-preference-store/provider", () => ({
  useUserPreferences: () => ({
    preferences: {
      showToolInvocations: false,
    },
  }),
}))

beforeAll(async () => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  // MessageContent loads Markdown via next/dynamic; preload it so the dynamic
  // import resolves before the render flush. Otherwise the markdown chunk lands
  // after the test's microtask and the rendered answer content is missing — a
  // fragility previously masked by an incidental static import of markdown
  // through reasoning.tsx (decoupled when formatDuration moved to lib).
  await import("@/components/ui/markdown")
})

type ChatStatus = "streaming" | "ready" | "submitted" | "error"

function makeView(
  parts: UIMessage["parts"],
  status: ChatStatus,
  metadata?: unknown
): AssistantTurnView {
  return deriveAssistantTurnView({ parts, metadata }, status)
}

/** Test store preconfigured like Chat's sync effect would leave it. */
function makeStore({
  panelTurnId,
  defaultTurnId,
  open = false,
}: {
  panelTurnId?: string
  defaultTurnId?: string
  open?: boolean
}): ActivityPanelStore {
  const store = createActivityPanelStore()
  store.setDerivedTurnIds({
    panelTurnId,
    defaultTurnId: defaultTurnId ?? panelTurnId,
  })
  if (open) store.setOpen(true)
  return store
}

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
    const store = makeStore({ panelTurnId: "assistant-1" })
    const parts = [
      { type: "reasoning", text: "", state: "done" },
    ] as unknown as UIMessage["parts"]

    act(() => {
      root?.render(
        <ActivityPanelStoreProvider store={store} panelId="activity-panel">
          <MessageAssistant
            messageId="assistant-1"
            view={makeView(parts, "ready", { reasoningDurationMs: 2000 })}
            status="ready"
          >
            {""}
          </MessageAssistant>
        </ActivityPanelStoreProvider>
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

    expect(store.getState().open).toBe(true)
    expect(store.getState().panelTurnId).toBe("assistant-1")
  })

  it("renders the activity trigger for submitted pre-stream state without duplicate loading UI", () => {
    const store = makeStore({ panelTurnId: "pending-assistant" })

    act(() => {
      root?.render(
        <ActivityPanelStoreProvider store={store} panelId="activity-panel">
          <MessageAssistant
            messageId="pending-assistant"
            view={makeView([], "submitted")}
            status="submitted"
            isLast
          >
            {""}
          </MessageAssistant>
        </ActivityPanelStoreProvider>
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

    expect(store.getState().open).toBe(true)
    expect(store.getState().panelTurnId).toBe("pending-assistant")
  })

  it("shows ONLY the Thinking trigger while opaque reasoning streams (no Generating shimmer underneath)", () => {
    const store = makeStore({ panelTurnId: "assistant-1" })
    const parts = [
      { type: "reasoning", text: "", state: "streaming" },
    ] as unknown as UIMessage["parts"]

    act(() => {
      root?.render(
        <ActivityPanelStoreProvider store={store} panelId="activity-panel">
          <MessageAssistant
            messageId="assistant-1"
            view={makeView(parts, "streaming")}
            status="streaming"
            isLast
          >
            {""}
          </MessageAssistant>
        </ActivityPanelStoreProvider>
      )
    })

    expect(
      container?.querySelector('button[aria-label="Open activity: Thinking"]')
    ).toBeTruthy()
    expect(container?.textContent).not.toContain("Generating")
  })

  it("shows ONLY the running trigger while a tool call is in flight", () => {
    const store = makeStore({ panelTurnId: "assistant-1" })
    const parts = [
      { type: "reasoning", text: "…", state: "streaming" },
      {
        type: "tool-web_search",
        toolCallId: "t1",
        state: "input-available",
        input: { query: "q" },
      },
    ] as unknown as UIMessage["parts"]

    act(() => {
      root?.render(
        <ActivityPanelStoreProvider store={store} panelId="activity-panel">
          <MessageAssistant
            messageId="assistant-1"
            view={makeView(parts, "streaming")}
            status="streaming"
            isLast
          >
            {""}
          </MessageAssistant>
        </ActivityPanelStoreProvider>
      )
    })

    expect(
      container?.querySelector(
        'button[aria-label="Open activity: Searching the web"]'
      )
    ).toBeTruthy()
    expect(container?.textContent).not.toContain("Generating")
    expect(container?.textContent).not.toContain("Thinking")
  })

  it("keeps historical reasoning triggers visible when another turn owns the panel", () => {
    const store = makeStore({ panelTurnId: "pending-assistant", open: true })
    const parts = [
      { type: "reasoning", text: "historical reasoning", state: "done" },
    ] as unknown as UIMessage["parts"]

    act(() => {
      root?.render(
        <ActivityPanelStoreProvider store={store} panelId="activity-panel">
          <MessageAssistant
            messageId="assistant-1"
            view={makeView(parts, "ready", { reasoningDurationMs: 2000 })}
            status="ready"
          >
            {"First answer"}
          </MessageAssistant>
        </ActivityPanelStoreProvider>
      )
    })

    const trigger = container?.querySelector(
      'button[aria-label="Open activity: Thought for 2s"]'
    ) as HTMLButtonElement | null

    expect(trigger).toBeTruthy()
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
  })

  it("renders one trigger per completed reasoning turn and only expands the selected turn", () => {
    const store = makeStore({ panelTurnId: "assistant-2", open: true })
    const parts = [
      { type: "reasoning", text: "reasoning", state: "done" },
    ] as unknown as UIMessage["parts"]

    act(() => {
      root?.render(
        <ActivityPanelStoreProvider store={store} panelId="activity-panel">
          <MessageAssistant
            messageId="assistant-1"
            view={makeView(parts, "ready", { reasoningDurationMs: 1000 })}
            status="ready"
          >
            {"First answer"}
          </MessageAssistant>
          <MessageAssistant
            messageId="assistant-2"
            view={makeView(parts, "ready", { reasoningDurationMs: 2000 })}
            status="ready"
          >
            {"Second answer"}
          </MessageAssistant>
        </ActivityPanelStoreProvider>
      )
    })

    const triggers = Array.from(
      container?.querySelectorAll<HTMLButtonElement>(
        'button[aria-controls="activity-panel"]'
      ) ?? []
    )

    expect(triggers).toHaveLength(2)
    expect(triggers[0]?.getAttribute("aria-expanded")).toBe("false")
    expect(triggers[1]?.getAttribute("aria-expanded")).toBe("true")
    expect(container?.textContent).toContain("Thought for 1s")
    expect(container?.textContent).toContain("Thought for 2s")
  })

  it("retargets the open panel when a different trigger is clicked", () => {
    const store = makeStore({
      panelTurnId: "assistant-1",
      defaultTurnId: "assistant-1",
      open: true,
    })
    const parts = [
      { type: "reasoning", text: "reasoning", state: "done" },
    ] as unknown as UIMessage["parts"]

    act(() => {
      root?.render(
        <ActivityPanelStoreProvider store={store} panelId="activity-panel">
          <MessageAssistant
            messageId="assistant-2"
            view={makeView(parts, "ready", { reasoningDurationMs: 2000 })}
            status="ready"
          >
            {"Second answer"}
          </MessageAssistant>
        </ActivityPanelStoreProvider>
      )
    })

    const trigger = container?.querySelector(
      'button[aria-label="Open activity: Thought for 2s"]'
    ) as HTMLButtonElement | null

    act(() => {
      trigger?.click()
    })

    // Clicking a non-default turn records an explicit selection and retargets
    // the panel in the same commit.
    expect(store.getState().open).toBe(true)
    expect(store.getState().panelTurnId).toBe("assistant-2")
    expect(store.getState().selectedTurnId).toBe("assistant-2")
  })

  it("closes the panel from the expanded trigger and clears the selection", () => {
    const store = makeStore({
      panelTurnId: "assistant-1",
      defaultTurnId: "assistant-1",
      open: true,
    })
    const parts = [
      { type: "reasoning", text: "reasoning", state: "done" },
    ] as unknown as UIMessage["parts"]

    act(() => {
      root?.render(
        <ActivityPanelStoreProvider store={store} panelId="activity-panel">
          <MessageAssistant
            messageId="assistant-1"
            view={makeView(parts, "ready", { reasoningDurationMs: 2000 })}
            status="ready"
          >
            {"Answer"}
          </MessageAssistant>
        </ActivityPanelStoreProvider>
      )
    })

    const trigger = container?.querySelector(
      'button[aria-label="Close activity: Thought for 2s"]'
    ) as HTMLButtonElement | null
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")

    act(() => {
      trigger?.click()
    })

    expect(store.getState().open).toBe(false)
    expect(store.getState().selectedTurnId).toBeUndefined()
    expect(
      container
        ?.querySelector('button[aria-controls="activity-panel"]')
        ?.getAttribute("aria-expanded")
    ).toBe("false")
  })

  it("renders no trigger without a hosted panel (outside the provider)", () => {
    const parts = [
      { type: "reasoning", text: "reasoning", state: "done" },
    ] as unknown as UIMessage["parts"]

    act(() => {
      root?.render(
        <MessageAssistant
          messageId="assistant-1"
          view={makeView(parts, "ready")}
          status="ready"
        >
          {"Answer"}
        </MessageAssistant>
      )
    })

    expect(
      container?.querySelector('button[aria-controls="activity-panel"]')
    ).toBeNull()
  })

  it("renders the activity trigger before content and footer actions", async () => {
    const store = makeStore({ panelTurnId: "assistant-1" })
    const parts = [
      { type: "reasoning", text: "", state: "done" },
    ] as unknown as UIMessage["parts"]

    await act(async () => {
      root?.render(
        <ActivityPanelStoreProvider store={store} panelId="activity-panel">
          <MessageAssistant
            messageId="assistant-1"
            copied={false}
            copyToClipboard={() => {}}
            view={makeView(parts, "ready", { reasoningDurationMs: 2000 })}
            status="ready"
          >
            {"Assistant answer"}
          </MessageAssistant>
        </ActivityPanelStoreProvider>
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
      answer!.compareDocumentPosition(copy!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
