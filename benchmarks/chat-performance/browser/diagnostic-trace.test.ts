import { afterEach, expect, it, vi } from "vitest"
import { TRACE_COMPLETION_TIMEOUT_MS, waitForTraceCompletion } from "./diagnostic-trace"

afterEach(() => vi.useRealTimers())

it("returns the trace handle and clears its timeout", async () => {
  vi.useFakeTimers()
  await expect(waitForTraceCompletion(Promise.resolve("trace-stream"))).resolves.toBe("trace-stream")
  expect(vi.getTimerCount()).toBe(0)
})

it("rejects a missing completion event so the harness finally block can close the page", async () => {
  vi.useFakeTimers()
  const result = expect(waitForTraceCompletion(new Promise(() => {}))).rejects.toThrow("Diagnostic trace completion timed out")
  await vi.advanceTimersByTimeAsync(TRACE_COMPLETION_TIMEOUT_MS)
  await result
  expect(vi.getTimerCount()).toBe(0)
})
