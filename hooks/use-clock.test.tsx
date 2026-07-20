/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { useDeadlineReached } from "./use-clock"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("useDeadlineReached", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => {
        mountedRoot.unmount()
      })
    }
    container?.remove()
    container = null
    root = null
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function renderDeadline(deadlineMs: number, values: boolean[]) {
    function Harness() {
      values.push(useDeadlineReached(deadlineMs))
      return null
    }

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(<Harness />)
    })
  }

  it("updates synchronously when the deadline passes before subscription", () => {
    vi.useFakeTimers()
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValue(1_001)
    const values: boolean[] = []

    renderDeadline(1_001, values)

    expect(values).toEqual([false, true])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps one cancellable timer for a future deadline", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const values: boolean[] = []

    renderDeadline(1_100, values)
    expect(values).toEqual([false])
    expect(vi.getTimerCount()).toBe(1)

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(values).toEqual([false, true])
    expect(vi.getTimerCount()).toBe(0)
  })
})
