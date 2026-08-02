import { describe, expect, it } from "vitest"
import { createWorkDurationTracker } from "./work-duration-tracker"

describe("createWorkDurationTracker", () => {
  it("includes reasoning, tool gaps, and answer generation continuously", () => {
    let now = 0
    const tracker = createWorkDurationTracker({ now: () => now })

    // reasoning 0-436, tool/search 436-3436, reasoning 3436-3900,
    // final text 3900-5200: the work clock intentionally includes all of it.
    now = 5200
    tracker.close()
    expect(tracker.getDurationMs()).toBe(5200)
  })

  it("freezes on every repeated terminal signal", () => {
    let now = 100
    const tracker = createWorkDurationTracker({ now: () => now })
    now = 2100
    tracker.close()
    now = 9000
    tracker.close()
    expect(tracker.getDurationMs()).toBe(2000)
  })

  it("resumes from prior active work without counting an approval wait", () => {
    let now = 20_000
    const resumed = createWorkDurationTracker({
      initialDurationMs: 2400,
      now: () => now,
    })
    now = 23_600
    resumed.close()
    expect(resumed.getDurationMs()).toBe(6000)
  })
})
