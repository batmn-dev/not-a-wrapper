import { describe, expect, it } from "vitest"
import {
  pacingOverheadMs,
  sanitizeRunTimingReceipt,
  serverTimeToFirstOutputMs,
} from "./runTimingReceipt"

describe("sanitizeRunTimingReceipt", () => {
  it("drops malformed durations and build ids, never zero-fills", () => {
    expect(
      sanitizeRunTimingReceipt({
        prepareMs: 120,
        providerFirstOutputMs: -5,
        wireStreamMs: Number.NaN,
        buildId: "not a build id!",
      })
    ).toEqual({ prepareMs: 120 })
    expect(sanitizeRunTimingReceipt({ buildId: "abc123def456" })).toEqual({
      buildId: "abc123def456",
    })
    expect(sanitizeRunTimingReceipt({})).toBeUndefined()
    expect(sanitizeRunTimingReceipt(undefined)).toBeUndefined()
  })
})

describe("derived figures", () => {
  it("decomposes server time to first output and pacing overhead", () => {
    const receipt = {
      prepareMs: 120,
      providerFirstOutputMs: 250,
      firstWriteDelayMs: 30,
      modelResponseMs: 1250,
      toolExecutionMs: 0,
      wireStreamMs: 1040,
    }
    expect(serverTimeToFirstOutputMs(receipt)).toBe(400)
    // Released window (1040) minus the provider's output window (1250 − 250).
    expect(pacingOverheadMs(receipt)).toBe(40)
  })

  it("stays undefined when a segment was unobserved", () => {
    expect(serverTimeToFirstOutputMs({ prepareMs: 1 })).toBeUndefined()
    expect(pacingOverheadMs({ wireStreamMs: 1 })).toBeUndefined()
    // An unobserved tool segment is never read as zero.
    expect(
      pacingOverheadMs({
        wireStreamMs: 1040,
        modelResponseMs: 1250,
        providerFirstOutputMs: 250,
      })
    ).toBeUndefined()
  })
})
