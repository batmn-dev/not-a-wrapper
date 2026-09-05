/** @vitest-environment jsdom */
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { markChatPerf } from "./chat-performance"
import { useChatResponsivenessMarks } from "./chat-responsiveness"

vi.mock("./chat-performance", () => ({
  isChatPerfClientEnabled: () => true,
  markChatPerf: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("retains observed start times when the task and frame callbacks arrive later", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  let deliver: ((list: PerformanceObserverEntryList) => void) | undefined
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      constructor(callback: PerformanceObserverCallback) {
        deliver = (list) => callback(list, this)
      }
      observe() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
  )
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    frames.push(callback)
  )
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  function Probe() {
    useChatResponsivenessMarks(true)
    return null
  }
  const root = createRoot(document.createElement("div"))
  act(() => root.render(createElement(Probe)))
  const entry = {
    entryType: "longtask",
    name: "self",
    startTime: 20,
    duration: 100,
    toJSON: () => ({}),
  }
  deliver!({
    getEntries: () => [entry],
    getEntriesByName: () => [entry],
    getEntriesByType: () => [entry],
  })
  frames.shift()!(10)
  frames.shift()!(110)
  expect(vi.mocked(markChatPerf).mock.calls).toEqual([
    ["long_task", { durationMs: 100, observedStartMs: 20 }],
    ["raf_gap", { durationMs: 100, observedStartMs: 10 }],
  ])
  vi.spyOn(performance, "now").mockReturnValue(210)
  act(() => root.unmount())
  expect(markChatPerf).toHaveBeenLastCalledWith("raf_gap", {
    durationMs: 100,
    observedStartMs: 110,
  })
})
