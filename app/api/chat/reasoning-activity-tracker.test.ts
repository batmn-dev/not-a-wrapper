import { describe, expect, it } from "vitest"
import { createReasoningActivityTracker } from "./reasoning-activity-tracker"

describe("createReasoningActivityTracker", () => {
  it("measures the union of multiple and overlapping reasoning blocks", () => {
    let now = 0
    const tracker = createReasoningActivityTracker(() => now)

    tracker.start("a")
    now = 100
    tracker.start("b")
    now = 300
    tracker.end("a")
    now = 500
    tracker.end("b")
    now = 800
    tracker.start("c")
    now = 1000
    tracker.end("c")

    expect(tracker.getDurationMs()).toBe(700)
  })

  it("ignores duplicate starts, unknown ends, and repeated terminal closes", () => {
    let now = 10
    const tracker = createReasoningActivityTracker(() => now)

    tracker.end("missing")
    expect(tracker.getDurationMs()).toBeUndefined()

    tracker.start("a")
    tracker.start("a")
    now = 60
    tracker.close()
    now = 500
    tracker.close()
    tracker.end("a")
    tracker.start("after-close")

    expect(tracker.getDurationMs()).toBe(50)
  })

  it("records an observed instantaneous block as zero milliseconds", () => {
    const tracker = createReasoningActivityTracker(() => 42)
    tracker.start("a")
    tracker.end("a")
    expect(tracker.getDurationMs()).toBe(0)
  })
})
