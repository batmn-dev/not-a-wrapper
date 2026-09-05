import { describe, expect, it } from "vitest"
import { durationsOverlappingRun } from "./marks"

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
