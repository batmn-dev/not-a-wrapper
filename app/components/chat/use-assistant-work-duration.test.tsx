/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  useAssistantWorkDuration,
  type AssistantWorkDuration,
} from "./use-reasoning-phase"

function Harness(props: {
  turnKey: string
  isActive: boolean
  isPaused: boolean
  persistedWorkDurationMs?: number
  onResult: (result: AssistantWorkDuration) => void
}) {
  const { onResult, ...options } = props
  const result = useAssistantWorkDuration({
    ...options,
    persistedWorkDurationMs: props.persistedWorkDurationMs,
  })
  React.useEffect(() => onResult(result))
  return null
}

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
})

describe("useAssistantWorkDuration", () => {
  let container: HTMLDivElement
  let root: Root
  let latest: AssistantWorkDuration | null

  beforeEach(() => {
    vi.useFakeTimers()
    latest = null
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  const render = (props: {
    turnKey: string
    isActive: boolean
    isPaused: boolean
    persistedWorkDurationMs?: number
  }) => {
    act(() => {
      root.render(
        <Harness
          {...props}
          onResult={(result) => {
            latest = result
          }}
        />
      )
    })
  }

  it("keeps running after reasoning ends and hands off without regression", () => {
    render({ turnKey: "a", isActive: true, isPaused: false })
    act(() => vi.advanceTimersByTime(5000))
    expect(latest?.durationSeconds).toBe(5)

    render({
      turnKey: "a",
      isActive: false,
      isPaused: false,
      persistedWorkDurationMs: 6200,
    })
    expect(latest?.durationMs).toBe(6200)
    expect(latest?.durationSeconds).toBe(6)
  })

  it("excludes approval waiting and resumes from the persisted active-work base", () => {
    render({ turnKey: "a", isActive: true, isPaused: false })
    act(() => vi.advanceTimersByTime(2000))

    render({
      turnKey: "a",
      isActive: false,
      isPaused: true,
      persistedWorkDurationMs: 2000,
    })
    act(() => vi.advanceTimersByTime(10_000))
    expect(latest?.durationMs).toBe(2000)

    render({
      turnKey: "a",
      isActive: true,
      isPaused: false,
      persistedWorkDurationMs: 2000,
    })
    act(() => vi.advanceTimersByTime(3000))
    expect(latest?.durationMs).toBe(5000)
  })

  // Inverse coverage (removed by the Math.max blend): a ticker that ran AHEAD
  // of the server total must yield to it at settlement, so the settled label
  // matches reload and history exactly.
  it("settles to the persisted total even when the live ticker ran ahead", () => {
    render({ turnKey: "a", isActive: true, isPaused: false })
    act(() => vi.advanceTimersByTime(5000))

    render({
      turnKey: "a",
      isActive: false,
      isPaused: false,
      persistedWorkDurationMs: 4200,
    })
    expect(latest?.durationMs).toBe(4200)
  })

  it.each(["abort", "failure", "Stop"])(
    "freezes elapsed evidence on %s",
    () => {
      render({ turnKey: "a", isActive: true, isPaused: false })
      act(() => vi.advanceTimersByTime(2400))
      render({ turnKey: "a", isActive: false, isPaused: false })
      expect(latest?.durationMs).toBe(2400)
      act(() => vi.advanceTimersByTime(5000))
      expect(latest?.durationMs).toBe(2400)
    }
  )
})
