import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createStreamLivenessTracker } from "./stream-liveness-tracker"

const THRESHOLD_MS = 1_000

function makeTracker() {
  const onSignal = vi.fn()
  const tracker = createStreamLivenessTracker({
    stalledThresholdMs: THRESHOLD_MS,
    onSignal,
  })
  return { tracker, onSignal }
}

const toolStep = {
  finishReason: "tool-calls",
  toolCallCount: 1,
  toolNames: ["web_search"],
}

describe("stream liveness tracker", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("fires one stalled-continuation signal after a tool-calls step goes quiet", () => {
    const { tracker, onSignal } = makeTracker()
    tracker.streamStarted()
    vi.advanceTimersByTime(50)
    tracker.stepEnded(toolStep)
    vi.advanceTimersByTime(THRESHOLD_MS)

    expect(onSignal).toHaveBeenCalledTimes(1)
    expect(onSignal).toHaveBeenCalledWith(
      "chat_stalled_continuation",
      expect.objectContaining({
        phase: "post_tool_continue",
        elapsedMs: 50 + THRESHOLD_MS,
        stepCounter: 1,
        observedToolCalls: 1,
        lastToolStepNumber: 1,
        lastToolNames: ["web_search"],
        awaitingPostToolContinuation: true,
        postToolContinuationDelayMs: THRESHOLD_MS,
      })
    )
    // A later step never re-fires it.
    tracker.stepEnded(toolStep)
    vi.advanceTimersByTime(THRESHOLD_MS)
    expect(onSignal).toHaveBeenCalledTimes(1)
  })

  it("disarms when a chunk arrives before the threshold", () => {
    const { tracker, onSignal } = makeTracker()
    tracker.streamStarted()
    tracker.stepEnded(toolStep)
    vi.advanceTimersByTime(THRESHOLD_MS - 1)
    tracker.chunkReleased()
    vi.advanceTimersByTime(THRESHOLD_MS)

    expect(onSignal).not.toHaveBeenCalled()
  })

  it("never signals after completion or an execution abort", () => {
    const { tracker, onSignal } = makeTracker()
    tracker.streamStarted()
    tracker.stepEnded(toolStep)
    expect(tracker.executionAborted()).toBe(true)
    expect(tracker.executionAborted()).toBe(false)
    vi.advanceTimersByTime(THRESHOLD_MS)
    tracker.requestAborted()
    expect(onSignal).not.toHaveBeenCalled()

    const second = makeTracker()
    second.tracker.streamStarted()
    second.tracker.stepEnded(toolStep)
    second.tracker.completed()
    vi.advanceTimersByTime(THRESHOLD_MS)
    second.tracker.requestAborted()
    expect(second.onSignal).not.toHaveBeenCalled()
  })

  it("reports a pre-stream client abort with zero elapsed figures, once", () => {
    const { tracker, onSignal } = makeTracker()
    tracker.requestAborted()
    tracker.requestAborted()

    expect(onSignal).toHaveBeenCalledTimes(1)
    expect(onSignal).toHaveBeenCalledWith(
      "chat_client_abort",
      expect.objectContaining({
        phase: "pre_first_chunk",
        elapsedMs: 0,
        timeSinceLastProgressMs: 0,
        timeSinceLastChunkMs: null,
        firstReleasedChunkLatencyMs: null,
      })
    )
  })
})
