/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  durationsOverlappingRun,
  findDirectTranscriptWheelPoint,
} from "./marks"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, "elementFromPoint")
  document.body.replaceChildren()
})

it("selects an unobscured gutter instead of a nested scroller and rejects an overlay", () => {
  vi.stubGlobal("innerWidth", 390)
  vi.stubGlobal("innerHeight", 844)
  const root = document.createElement("div")
  const nested = document.createElement("div")
  nested.style.overflowY = "auto"
  Object.defineProperties(nested, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 200 },
  })
  root.append(nested)
  document.body.append(root)
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 390, 844)
  )
  const hitTest = vi.fn((x: number): Element => (x < 8 ? nested : root))
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: hitTest,
  })
  expect(findDirectTranscriptWheelPoint(root)).toEqual({ x: 386, y: 422 })
  hitTest.mockReturnValue(document.body)
  expect(() => findDirectTranscriptWheelPoint(root)).toThrow(
    "No unobscured direct transcript wheel target"
  )
})

describe("observed responsiveness intervals", () => {
  it.each(["long_task", "raf_gap"] as const)(
    "includes delayed %s callbacks only when their original interval overlaps",
    (name) => {
      const marks = [
        { start: 90, duration: 30 },
        { start: 180, duration: 90 },
        { start: 20, duration: 60 },
        { start: 210, duration: 70 },
      ].map(({ start, duration }) => ({
        name,
        startTime: 300,
        detail: { durationMs: duration, observedStartMs: start },
      }))
      expect(durationsOverlappingRun(marks, name, 100, 200)).toEqual([30, 90])
    }
  )

  it("does not infer the original interval from an observer callback", () => {
    expect(() =>
      durationsOverlappingRun(
        [{ name: "long_task", startTime: 300, detail: { durationMs: 90 } }],
        "long_task",
        100,
        200
      )
    ).toThrow("missing a valid observed interval")
  })
})
