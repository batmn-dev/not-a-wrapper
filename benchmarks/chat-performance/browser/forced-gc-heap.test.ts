import type { CDPSession } from "playwright"
import { describe, expect, it, vi } from "vitest"
import { readForcedGcHeap } from "./forced-gc-heap"

describe("forced-GC heap acquisition", () => {
  it("reads heap only after successful GC", async () => {
    const send = vi
      .fn<CDPSession["send"]>()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        metrics: [{ name: "JSHeapUsedSize", value: 1234 }],
      })
    await expect(
      readForcedGcHeap({ send: send as CDPSession["send"] })
    ).resolves.toBe(1234)
    expect(send.mock.calls).toEqual([
      ["HeapProfiler.collectGarbage"],
      ["Performance.getMetrics"],
    ])
  })

  it.each(["gc", "metrics"])(
    "rejects %s failures instead of reporting an unverified sample",
    async (stage) => {
      const send = vi.fn<CDPSession["send"]>()
      if (stage === "metrics") send.mockResolvedValueOnce({})
      send.mockRejectedValueOnce(new Error(`${stage} unavailable`))
      await expect(
        readForcedGcHeap({ send: send as CDPSession["send"] })
      ).rejects.toThrow(`${stage} unavailable`)
      expect(send).toHaveBeenCalledTimes(stage === "gc" ? 1 : 2)
    }
  )

  it.each([undefined, NaN, Infinity, -1])(
    "rejects missing or invalid heap values: %s",
    async (value) => {
      const send = vi
        .fn<CDPSession["send"]>()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          metrics:
            value === undefined ? [] : [{ name: "JSHeapUsedSize", value }],
        })
      await expect(
        readForcedGcHeap({ send: send as CDPSession["send"] })
      ).rejects.toThrow("heap metric is missing or invalid")
    }
  )
})
