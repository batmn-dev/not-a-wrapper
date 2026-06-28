/** @vitest-environment jsdom */
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
import {
  PENDING_ACTIVITY_TURN_ID,
  useActivityPanel,
  type UseActivityPanelResult,
} from "./use-activity-panel"

type Status = "streaming" | "ready" | "submitted" | "error"

function Harness(props: {
  messages: UIMessage[]
  status: Status
  isSubmitting: boolean
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
  opts: { durationMs?: number; sourceUrl?: string } = {}
): UIMessage {
  const parts: unknown[] = [{ type: "reasoning", text: "r", state: "done" }]
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
      opts.durationMs !== undefined
        ? { reasoningDurationMs: opts.durationMs }
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
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
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
      messages: [user("u1"), assistant("a2", { durationMs: 4000, sourceUrl: "https://a.com" })],
      status: "ready",
      isSubmitting: false,
    })
    expect(latest!.activeTurnId).toBe("a2")
    expect(latest!.panelProps.durationSeconds).toBe(4)
    expect(latest!.panelProps.sources[0].url).toBe("https://a.com")

    // Branch switch / regenerate: the projected path now ends with a different
    // assistant turn — ownership and its persisted state must follow.
    render({
      messages: [user("u1"), assistant("a9", { durationMs: 9000, sourceUrl: "https://b.com" })],
      status: "ready",
      isSubmitting: false,
    })
    expect(latest!.activeTurnId).toBe("a9")
    expect(latest!.panelProps.durationSeconds).toBe(9)
    expect(latest!.panelProps.sources[0].url).toBe("https://b.com")
  })

  it("owns the pending assistant turn for submitted user-tail state", () => {
    render({
      messages: [user("u1"), assistant("a1"), user("u2")],
      status: "submitted",
      isSubmitting: true,
    })

    expect(latest!.activeTurnId).toBe(PENDING_ACTIVITY_TURN_ID)
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

    expect(latest!.activeTurnId).toBe(PENDING_ACTIVITY_TURN_ID)
    expect(latest!.isGenerationActive).toBe(true)
    expect(latest!.panelProps.phase).toBe("thinking")
    expect(latest!.panelProps.isReasoningStreaming).toBe(true)
    expect(latest!.panelProps.isOpaqueReasoning).toBe(true)
  })
})
