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
  const { onResult, ...params } = props
  const result = useReasoningPhase(params)
  React.useEffect(() => {
    onResult(result)
  })
  return null
}

const reasoningPart = (text: string, state: "streaming" | "done") =>
  [{ type: "reasoning", text, state }] as unknown as UIMessage["parts"]

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
})

describe("useReasoningPhase duration mechanics", () => {
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

  it("(a) freezes the live duration on cleanup when thinking ends", () => {
    render({ parts: reasoningPart("…", "streaming"), status: "streaming", isLast: true })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(latest!.durationSeconds).toBe(5)

    // thinking → complete: timer stops, frozen value persists.
    render({ parts: reasoningPart("done", "done"), status: "ready", isLast: true })
    expect(latest!.phase).toBe("complete")
    expect(latest!.durationSeconds).toBe(5)
  })

  it("(b) falls back to persisted duration when complete with no live ticks", () => {
    render({
      parts: reasoningPart("done", "done"),
      status: "ready",
      isLast: true,
      persistedDurationMs: 8000,
    })
    expect(latest!.phase).toBe("complete")
    expect(latest!.durationSeconds).toBe(8)
  })

  it("(c) uses persisted duration for historical (non-active) turns", () => {
    render({
      parts: reasoningPart("done", "done"),
      status: "ready",
      isLast: false,
      persistedDurationMs: 12000,
    })
    expect(latest!.durationSeconds).toBe(12)
  })

  it("(d) re-derives phase/text from an in-place mutation of the same parts ref", () => {
    const parts = reasoningPart("partial", "streaming")
    render({ parts, status: "streaming", isLast: true })
    expect(latest!.phase).toBe("thinking")
    expect(latest!.reasoningText).toBe("partial")

    // Mutate the existing part object in place (no new array ref), as the AI SDK does.
    const mutable = parts as unknown as Array<{ text: string; state: string }>
    mutable[0].text = "partial then final"
    mutable[0].state = "done"
    render({ parts, status: "ready", isLast: true })

    expect(latest!.phase).toBe("complete")
    expect(latest!.reasoningText).toBe("partial then final")
  })

  it("(e) resumes (never regresses) across an isLast true→false→true handoff while thinking", () => {
    const thinking = reasoningPart("…", "streaming")

    render({ parts: thinking, status: "streaming", isLast: true })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(latest!.durationSeconds).toBe(5)

    // isLast → false (handoff begins); phase stays "thinking". Timer freezes at 5.
    render({ parts: thinking, status: "streaming", isLast: false })

    // isLast → true again; timer must RESUME from 5, not restart from 0.
    render({ parts: thinking, status: "streaming", isLast: true })
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // Never below the frozen value, and continues upward (5 → 6).
    expect(latest!.durationSeconds).toBeGreaterThanOrEqual(5)
    expect(latest!.durationSeconds).toBe(6)
  })
})
