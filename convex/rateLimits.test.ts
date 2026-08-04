import { describe, expect, it } from "vitest"
import {
  evaluateFixedWindow,
  getRateLimitPolicy,
  type WindowBucket,
} from "./rateLimits"

const WINDOW = 60_000
const LIMIT = 3

// A window boundary for readable timestamps: now sits 1s into this window.
const WINDOW_START = 1_000 * WINDOW
const NOW = WINDOW_START + 1_000

function bucket(
  id: string,
  windowStartMs: number,
  count: number
): WindowBucket<string> {
  return { _id: id, windowStartMs, count }
}

describe("evaluateFixedWindow", () => {
  it("keeps the public mutation policy server-owned by bucket", () => {
    expect(getRateLimitPolicy("mcp_test")).toEqual({
      limit: 10,
      windowMs: WINDOW,
    })
    expect(getRateLimitPolicy("profile_image_upload")).toEqual({
      limit: 10,
      windowMs: WINDOW,
    })
  })

  it("allows and decrements remaining when under the limit", () => {
    const d = evaluateFixedWindow([], {
      now: NOW,
      limit: LIMIT,
      windowMs: WINDOW,
    })
    expect(d.allowed).toBe(true)
    expect(d.remaining).toBe(LIMIT - 1)
    expect(d.currentBucketId).toBeNull()
    expect(d.windowStartMs).toBe(WINDOW_START)
  })

  it("counts an existing bucket in the current window", () => {
    const d = evaluateFixedWindow([bucket("b1", WINDOW_START, 2)], {
      now: NOW,
      limit: LIMIT,
      windowMs: WINDOW,
    })
    expect(d.allowed).toBe(true)
    expect(d.remaining).toBe(0)
    expect(d.currentBucketId).toBe("b1")
    expect(d.currentCount).toBe(2)
  })

  it("denies at the limit and reports retry-after to the window end", () => {
    const d = evaluateFixedWindow([bucket("b1", WINDOW_START, LIMIT)], {
      now: NOW,
      limit: LIMIT,
      windowMs: WINDOW,
    })
    expect(d.allowed).toBe(false)
    expect(d.remaining).toBe(0)
    expect(d.retryAfterMs).toBe(WINDOW_START + WINDOW - NOW)
  })

  it("ignores and sweeps buckets from prior windows", () => {
    const d = evaluateFixedWindow(
      [
        bucket("old", WINDOW_START - WINDOW, LIMIT), // full, but expired
        bucket("older", WINDOW_START - 3 * WINDOW, LIMIT),
      ],
      { now: NOW, limit: LIMIT, windowMs: WINDOW }
    )
    // A full prior window must not block the fresh one.
    expect(d.allowed).toBe(true)
    expect(d.remaining).toBe(LIMIT - 1)
    expect(d.staleBucketIds).toEqual(["old", "older"])
    expect(d.currentBucketId).toBeNull()
  })

  it("does not sweep the current window's bucket", () => {
    const d = evaluateFixedWindow(
      [bucket("cur", WINDOW_START, 1), bucket("old", WINDOW_START - WINDOW, 5)],
      { now: NOW, limit: LIMIT, windowMs: WINDOW }
    )
    expect(d.staleBucketIds).toEqual(["old"])
    expect(d.currentBucketId).toBe("cur")
  })

  it("rejects invalid configuration", () => {
    expect(() =>
      evaluateFixedWindow([], { now: NOW, limit: 0, windowMs: WINDOW })
    ).toThrow(/Invalid rate-limit/)
    expect(() =>
      evaluateFixedWindow([], { now: NOW, limit: LIMIT, windowMs: 0 })
    ).toThrow(/Invalid rate-limit/)
  })
})
