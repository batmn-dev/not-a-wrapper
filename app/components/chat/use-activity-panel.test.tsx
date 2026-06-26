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

  it("(a) derives activeTurnId from the last assistant in the rendered path", () => {
    render({
      messages: [
        user("u1"),
        assistant("a1", { sourceUrl: "https://first.com" }),
        user("u2"),
        assistant("a2", { sourceUrl: "https://second.com" }),
      ],
      status: "ready",
      isSubmitting: false,
    })

    expect(latest!.activeTurnId).toBe("a2")
    expect(latest!.panelProps.sources).toHaveLength(1)
    expect(latest!.panelProps.sources[0].url).toBe("https://second.com")
  })

  it("(b) follows a branch switch to a new rendered tail (id + persisted duration + sources)", () => {
    render({
      messages: [user("u1"), assistant("a2", { durationMs: 4000, sourceUrl: "https://a.com" })],
      status: "ready",
      isSubmitting: false,
    })
    expect(latest!.activeTurnId).toBe("a2")
    expect(latest!.panelProps.durationSeconds).toBe(4)
    expect(latest!.panelProps.sources[0].url).toBe("https://a.com")

    // Simulated branch switch: the projected path now ends with a different
    // assistant turn.
    render({
      messages: [user("u1"), assistant("a9", { durationMs: 9000, sourceUrl: "https://b.com" })],
      status: "ready",
      isSubmitting: false,
    })
    expect(latest!.activeTurnId).toBe("a9")
    expect(latest!.panelProps.durationSeconds).toBe(9)
    expect(latest!.panelProps.sources[0].url).toBe("https://b.com")
  })

  it("(c) moves ownership to the new sibling on regenerate handoff", () => {
    render({
      messages: [user("u1"), assistant("a-old", { durationMs: 3000 })],
      status: "ready",
      isSubmitting: false,
    })
    expect(latest!.activeTurnId).toBe("a-old")

    render({
      messages: [user("u1"), assistant("a-new", { durationMs: 7000 })],
      status: "ready",
      isSubmitting: false,
    })
    expect(latest!.activeTurnId).toBe("a-new")
    expect(latest!.activeTurnId).not.toBe("a-old")
    expect(latest!.panelProps.durationSeconds).toBe(7)
  })

  it("(d) returns no active turn for submitted/no-assistant state, but stays generation-active", () => {
    render({
      messages: [user("u1")],
      status: "submitted",
      isSubmitting: true,
    })

    expect(latest!.activeTurnId).toBeUndefined()
    expect(latest!.isGenerationActive).toBe(true)
  })
})
