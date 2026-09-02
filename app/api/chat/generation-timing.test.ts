import { describe, expect, it } from "vitest"
import {
  createGenerationTimingTracker,
  type StepTimingFacts,
} from "./generation-timing"

/** A finished SDK step, shaped exactly as `onStepEnd` delivers it. */
function step(
  performance: {
    ttfo: number | undefined
    response: number
    tools?: Record<string, number>
    /** Provider-executed (hosted) tool calls in this step. */
    hosted?: number
  },
  usage: {
    in?: number
    out?: number
    cached?: number
    reasoning?: number
  } = {}
): StepTimingFacts {
  return {
    performance: {
      timeToFirstOutputMs: performance.ttfo,
      responseTimeMs: performance.response,
      toolExecutionMs: performance.tools ?? {},
    },
    usage: {
      inputTokens: usage.in,
      outputTokens: usage.out,
      inputTokenDetails: { cacheReadTokens: usage.cached },
      outputTokenDetails: { reasoningTokens: usage.reasoning },
    },
    toolCalls: [
      ...Object.keys(performance.tools ?? {}).map(() => ({})),
      ...Array.from({ length: performance.hosted ?? 0 }, () => ({
        providerExecuted: true,
      })),
    ],
  }
}

describe("createGenerationTimingTracker", () => {
  it("reports one step exactly: window excludes time to first output", () => {
    const tracker = createGenerationTimingTracker()
    expect(tracker.stats()).toBeUndefined()
    expect(tracker.providerSegments()).toEqual({})

    tracker.recordStep(
      step({ ttfo: 250, response: 1250 }, { in: 120, out: 10, cached: 100 })
    )

    expect(tracker.stats()).toEqual({
      timeToFirstTokenMs: 250,
      outputStreamMs: 1000,
      outputTokens: 10,
      inputTokens: 120,
      cachedInputTokens: 100,
      stepCount: 1,
    })
    expect(tracker.providerSegments()).toEqual({
      providerFirstOutputMs: 250,
      modelResponseMs: 1250,
      toolExecutionMs: 0,
    })
    expect(tracker.firstOutputOffsetMs()).toBe(250)
  })

  it("keeps CLIENT tool execution and later steps' first-output waits out of the window", () => {
    const tracker = createGenerationTimingTracker()
    tracker.recordStep(
      step(
        { ttfo: 100, response: 400, tools: { search: 3000 } },
        { in: 50, out: 20 }
      )
    )
    tracker.recordStep(
      step({ ttfo: 80, response: 680 }, { in: 90, out: 60, reasoning: 15 })
    )

    expect(tracker.stats()).toEqual({
      timeToFirstTokenMs: 100,
      outputStreamMs: 900,
      outputTokens: 80,
      inputTokens: 140,
      reasoningTokens: 15,
      stepCount: 2,
    })
    expect(tracker.providerSegments()).toEqual({
      providerFirstOutputMs: 100,
      modelResponseMs: 1080,
      toolExecutionMs: 3000,
    })
  })

  it("leaves first output absent when only a later step produced output", () => {
    // A later step's offset is relative to its own dispatch, not the run's
    // first call, and the SDK exposes no step timestamps to re-anchor it.
    const tracker = createGenerationTimingTracker()
    tracker.recordStep(
      step({ ttfo: undefined, response: 300 }, { in: 5, out: 0 })
    )
    tracker.recordStep(step({ ttfo: 120, response: 620 }, { in: 9, out: 30 }))

    expect(tracker.firstOutputOffsetMs()).toBeUndefined()
    expect(tracker.stats()?.timeToFirstTokenMs).toBeUndefined()
    expect(tracker.stats()?.outputStreamMs).toBe(500)
    expect(tracker.providerSegments()).toEqual({
      modelResponseMs: 920,
      toolExecutionMs: 0,
    })
  })

  it("counts provider-run tool calls, whose time stays inside the window", () => {
    // A hosted web search runs inside the provider response: the SDK's
    // toolExecutionMs stays 0 and the window is not shortened. The stats
    // can only SAY so — hence the count.
    const tracker = createGenerationTimingTracker()
    tracker.recordStep(
      step({ ttfo: 200, response: 3500, hosted: 1 }, { in: 40, out: 90 })
    )

    expect(tracker.stats()).toEqual({
      timeToFirstTokenMs: 200,
      outputStreamMs: 3300,
      outputTokens: 90,
      inputTokens: 40,
      stepCount: 1,
      providerToolCalls: 1,
    })
    expect(tracker.providerSegments()).toEqual({
      providerFirstOutputMs: 200,
      modelResponseMs: 3500,
      toolExecutionMs: 0,
    })
  })

  it("never estimates: a step without output usage leaves tokens absent", () => {
    const tracker = createGenerationTimingTracker()
    tracker.recordStep(step({ ttfo: 10, response: 110 }, { in: 5, out: 7 }))
    tracker.recordStep(step({ ttfo: 10, response: 60 }, { in: 5 }))

    const stats = tracker.stats()
    expect(stats?.outputTokens).toBeUndefined()
    expect(stats?.inputTokens).toBe(10)
    expect(stats?.outputStreamMs).toBe(150)
  })

  it("accumulates onto a continuation seed but keeps the receipt per run", () => {
    const tracker = createGenerationTimingTracker({
      initialStats: {
        timeToFirstTokenMs: 90,
        outputStreamMs: 500,
        outputTokens: 40,
        inputTokens: 30,
        stepCount: 1,
      },
    })
    expect(tracker.stats()?.timeToFirstTokenMs).toBe(90)

    tracker.recordStep(step({ ttfo: 200, response: 700 }, { in: 70, out: 25 }))

    expect(tracker.stats()).toEqual({
      timeToFirstTokenMs: 90,
      outputStreamMs: 1000,
      outputTokens: 65,
      inputTokens: 100,
      stepCount: 2,
    })
    expect(tracker.providerSegments()).toEqual({
      providerFirstOutputMs: 200,
      modelResponseMs: 700,
      toolExecutionMs: 0,
    })
  })

  it("keeps a count absent when the continuation seed lacks it", () => {
    // The prior run's output count was unknown: this run's count alone would
    // be published as the whole message's total.
    const tracker = createGenerationTimingTracker({
      initialStats: { timeToFirstTokenMs: 90, inputTokens: 30 },
    })
    tracker.recordStep(step({ ttfo: 200, response: 700 }, { in: 70, out: 25 }))

    const stats = tracker.stats()
    expect(stats?.outputTokens).toBeUndefined()
    expect(stats?.inputTokens).toBe(100)
  })
})
