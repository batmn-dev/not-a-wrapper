/** @vitest-environment jsdom */
import type { UIMessage } from "@ai-sdk/react"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  PENDING_ACTIVITY_TURN_ID,
  selectExplicitActivityTurnOnOpen,
  useActivityPanel,
  type UseActivityPanelResult,
} from "./use-activity-panel"

type Status = "streaming" | "ready" | "submitted" | "error"

function Harness(props: {
  messages: UIMessage[]
  status: Status
  isSubmitting: boolean
  selectedActivityTurnId?: string
  onResult: (result: UseActivityPanelResult) => void
}) {
  const { onResult, ...params } = props
  const result = useActivityPanel(params)
  React.useEffect(() => {
    onResult(result)
  })
  return null
}

function assistant(
  id: string,
  opts: {
    durationMs?: number
    omitReasoningState?: boolean
    reasoningState?: string
    reasoningText?: string
    sourceUrl?: string
    serverMessageId?: string
  } = {}
): UIMessage {
  const reasoningPart: { type: "reasoning"; text: string; state?: string } = {
    type: "reasoning",
    text: opts.reasoningText ?? "r",
  }
  if (!opts.omitReasoningState) {
    reasoningPart.state = opts.reasoningState ?? "done"
  }

  const parts: unknown[] = [reasoningPart]
  if (opts.sourceUrl) {
    parts.push({
      type: "source-url",
      sourceId: `${id}-s`,
      url: opts.sourceUrl,
      title: "t",
    })
  }
  return {
    id,
    role: "assistant",
    parts,
    metadata:
      opts.durationMs !== undefined || opts.serverMessageId !== undefined
        ? {
            reasoningDurationMs: opts.durationMs,
            serverMessageId: opts.serverMessageId,
          }
        : undefined,
  } as unknown as UIMessage
}

function user(id: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text: "q" }],
  } as unknown as UIMessage
}

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("useActivityPanel ownership", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let latest: UseActivityPanelResult | null = null

  beforeEach(() => {
    latest = null
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

  function render(props: {
    messages: UIMessage[]
    status: Status
    isSubmitting: boolean
    selectedActivityTurnId?: string
  }) {
    act(() => {
      root?.render(
        <Harness
          {...props}
          onResult={(result) => {
            latest = result
          }}
        />
      )
    })
  }

  it("owns the last assistant in the rendered path and follows a branch switch (id + duration + sources)", () => {
    render({
      messages: [
        user("u1"),
        assistant("a2", { durationMs: 4000, sourceUrl: "https://a.com" }),
      ],
      status: "ready",
      isSubmitting: false,
    })
    expect(latest!.defaultActivityTurnId).toBe("a2")
    expect(latest!.panelActivityTurnId).toBe("a2")
    expect(latest!.panelProps.durationSeconds).toBe(4)
    expect(latest!.panelProps.sources[0].url).toBe("https://a.com")

    // Branch switch / regenerate: the projected path now ends with a different
    // assistant turn — ownership and its persisted state must follow.
    render({
      messages: [
        user("u1"),
        assistant("a9", { durationMs: 9000, sourceUrl: "https://b.com" }),
      ],
      status: "ready",
      isSubmitting: false,
    })
    expect(latest!.defaultActivityTurnId).toBe("a9")
    expect(latest!.panelActivityTurnId).toBe("a9")
    expect(latest!.panelProps.durationSeconds).toBe(9)
    expect(latest!.panelProps.sources[0].url).toBe("https://b.com")
  })

  it("projects an explicit historical assistant turn instead of the pending default", () => {
    render({
      messages: [
        user("u1"),
        assistant("a1", { durationMs: 4000, sourceUrl: "https://a.com" }),
        user("u2"),
      ],
      status: "submitted",
      isSubmitting: true,
      selectedActivityTurnId: "a1",
    })

    expect(latest!.defaultActivityTurnId).toBe(PENDING_ACTIVITY_TURN_ID)
    expect(latest!.panelActivityTurnId).toBe("a1")
    expect(latest!.isGenerationActive).toBe(true)
    expect(latest!.panelProps.phase).toBe("complete")
    expect(latest!.panelProps.durationSeconds).toBe(4)
    expect(latest!.panelProps.sources[0].url).toBe("https://a.com")
  })

  it("keeps an explicit historical opaque reasoning panel complete while a newer assistant streams", () => {
    render({
      messages: [
        user("u1"),
        assistant("a1", {
          omitReasoningState: true,
          reasoningText: "",
        }),
        user("u2"),
        assistant("a2", { reasoningState: "streaming" }),
      ],
      status: "streaming",
      isSubmitting: false,
      selectedActivityTurnId: "a1",
    })

    expect(latest!.defaultActivityTurnId).toBe("a2")
    expect(latest!.panelActivityTurnId).toBe("a1")
    expect(latest!.panelProps.phase).toBe("complete")
    expect(latest!.panelProps.isReasoningStreaming).toBe(false)
    expect(latest!.panelProps.isOpaqueReasoning).toBe(true)
  })

  it("keeps a default-opened panel following the next pending generation", () => {
    render({
      messages: [
        user("u1"),
        assistant("a1", { durationMs: 4000, sourceUrl: "https://a.com" }),
      ],
      status: "ready",
      isSubmitting: false,
    })

    const selectedActivityTurnId = selectExplicitActivityTurnOnOpen({
      requestedTurnId: "a1",
      defaultActivityTurnId: latest!.defaultActivityTurnId,
    })
    expect(selectedActivityTurnId).toBeUndefined()

    render({
      messages: [
        user("u1"),
        assistant("a1", { durationMs: 4000, sourceUrl: "https://a.com" }),
        user("u2"),
      ],
      status: "submitted",
      isSubmitting: true,
      selectedActivityTurnId,
    })

    expect(latest!.defaultActivityTurnId).toBe(PENDING_ACTIVITY_TURN_ID)
    expect(latest!.panelActivityTurnId).toBe(PENDING_ACTIVITY_TURN_ID)
    expect(latest!.panelProps.phase).toBe("thinking")
  })

  it("keeps a historical-opened panel pinned while the next generation is pending", () => {
    render({
      messages: [
        user("u1"),
        assistant("a1", { durationMs: 4000, sourceUrl: "https://a.com" }),
        user("u2"),
        assistant("a2", { durationMs: 9000, sourceUrl: "https://b.com" }),
      ],
      status: "ready",
      isSubmitting: false,
    })

    const selectedActivityTurnId = selectExplicitActivityTurnOnOpen({
      requestedTurnId: "a1",
      defaultActivityTurnId: latest!.defaultActivityTurnId,
    })
    expect(selectedActivityTurnId).toBe("a1")

    render({
      messages: [
        user("u1"),
        assistant("a1", { durationMs: 4000, sourceUrl: "https://a.com" }),
        user("u2"),
        assistant("a2", { durationMs: 9000, sourceUrl: "https://b.com" }),
        user("u3"),
      ],
      status: "submitted",
      isSubmitting: true,
      selectedActivityTurnId,
    })

    expect(latest!.defaultActivityTurnId).toBe(PENDING_ACTIVITY_TURN_ID)
    expect(latest!.panelActivityTurnId).toBe("a1")
    expect(latest!.panelProps.phase).toBe("complete")
    expect(latest!.panelProps.durationSeconds).toBe(4)
    expect(latest!.panelProps.sources[0].url).toBe("https://a.com")
  })

  it("matches an explicit selected turn by server id and normalizes to the rendered message id", () => {
    render({
      messages: [
        user("u1"),
        assistant("client-a1", {
          durationMs: 3000,
          serverMessageId: "server-a1",
          sourceUrl: "https://server-id.example",
        }),
      ],
      status: "ready",
      isSubmitting: false,
      selectedActivityTurnId: "server-a1",
    })

    expect(latest!.defaultActivityTurnId).toBe("client-a1")
    expect(latest!.panelActivityTurnId).toBe("client-a1")
    expect(latest!.panelProps.durationSeconds).toBe(3)
    expect(latest!.panelProps.sources[0].url).toBe("https://server-id.example")
  })

  it("owns the pending assistant turn for submitted user-tail state", () => {
    render({
      messages: [user("u1"), assistant("a1"), user("u2")],
      status: "submitted",
      isSubmitting: true,
    })

    expect(latest!.defaultActivityTurnId).toBe(PENDING_ACTIVITY_TURN_ID)
    expect(latest!.panelActivityTurnId).toBe(PENDING_ACTIVITY_TURN_ID)
    expect(latest!.isGenerationActive).toBe(true)
    expect(latest!.panelProps.phase).toBe("thinking")
    expect(latest!.panelProps.isReasoningStreaming).toBe(true)
    expect(latest!.panelProps.isOpaqueReasoning).toBe(true)
  })

  it("owns the pending assistant turn during submit preflight before status flips", () => {
    render({
      messages: [user("u1"), assistant("a1"), user("u2")],
      status: "ready",
      isSubmitting: true,
    })

    expect(latest!.defaultActivityTurnId).toBe(PENDING_ACTIVITY_TURN_ID)
    expect(latest!.panelActivityTurnId).toBe(PENDING_ACTIVITY_TURN_ID)
    expect(latest!.isGenerationActive).toBe(true)
    expect(latest!.panelProps.phase).toBe("thinking")
    expect(latest!.panelProps.isReasoningStreaming).toBe(true)
    expect(latest!.panelProps.isOpaqueReasoning).toBe(true)
  })
})
