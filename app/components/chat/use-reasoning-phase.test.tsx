/** @vitest-environment jsdom */
import { deriveReasoningView } from "@/lib/chat-messages/assistant-turn"
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
  vi,
} from "vitest"
import { useReasoningPhase, type ReasoningPhase } from "./use-reasoning-phase"

type Status = "streaming" | "ready" | "submitted" | "error"

function Harness(props: {
  parts: UIMessage["parts"] | undefined
  status: Status
  isLast: boolean
  persistedDurationMs?: number
  onResult: (result: ReasoningPhase) => void
}) {
  const { onResult, parts, status, isLast, persistedDurationMs } = props
  // Derive the reasoning view exactly as production does (Conversation /
  // useActivityPanel derive it per render), then run the timer hook over it.
  const reasoning = deriveReasoningView(
    parts,
    status,
    persistedDurationMs !== undefined
      ? { reasoningDurationMs: persistedDurationMs }
      : undefined
  )
  const result = useReasoningPhase({ reasoning, isLast })
  React.useEffect(() => {
    onResult(result)
  })
  return null
}

const reasoningPart = (text: string, state: "streaming" | "done") =>
  [{ type: "reasoning", text, state }] as unknown as UIMessage["parts"]

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("useReasoningPhase", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let latest: ReasoningPhase | null = null

  beforeEach(() => {
    vi.useFakeTimers()
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
    vi.useRealTimers()
  })

  function render(props: {
    parts: UIMessage["parts"] | undefined
    status: Status
    isLast: boolean
    persistedDurationMs?: number
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

  // R1: a same-id isLast true→false→true bounce (regenerate handoff) must RESUME
  // the timer, never restart it from 0 mid-stream.
  it("resumes (never regresses) across an isLast true→false→true bounce while thinking", () => {
    const thinking = reasoningPart("…", "streaming")

    render({ parts: thinking, status: "streaming", isLast: true })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(latest!.durationSeconds).toBe(5)

    render({ parts: thinking, status: "streaming", isLast: false })
    render({ parts: thinking, status: "streaming", isLast: true })
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(latest!.durationSeconds).toBeGreaterThanOrEqual(5)
    expect(latest!.durationSeconds).toBe(6)
  })

  // The parts derivation is intentionally un-memoized — the AI SDK mutates part
  // objects in place without changing the array ref.
  it("re-derives phase/text from an in-place mutation of the same parts ref", () => {
    const parts = reasoningPart("partial", "streaming")
    render({ parts, status: "streaming", isLast: true })
    expect(latest!.phase).toBe("thinking")
    expect(latest!.reasoningText).toBe("partial")

    const mutable = parts as unknown as Array<{ text: string; state: string }>
    mutable[0].text = "partial then final"
    mutable[0].state = "done"
    render({ parts, status: "ready", isLast: true })

    expect(latest!.phase).toBe("complete")
    expect(latest!.reasoningText).toBe("partial then final")
  })

})
