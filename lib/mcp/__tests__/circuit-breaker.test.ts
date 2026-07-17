import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getFailureCount,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
  resetAllCircuits,
} from "../circuit-breaker"

vi.mock("@/lib/config", () => ({
  MCP_CIRCUIT_BREAKER_THRESHOLD: 3,
}))

describe("circuit-breaker", () => {
  beforeEach(() => {
    resetAllCircuits()
  })

  it("opens at the consecutive-failure threshold and closes on success", () => {
    expect(isCircuitOpen("server-1")).toBe(false)

    recordFailure("server-1")
    recordFailure("server-1")
    expect(getFailureCount("server-1")).toBe(2)
    expect(isCircuitOpen("server-1")).toBe(false)

    recordFailure("server-1")
    expect(isCircuitOpen("server-1")).toBe(true)

    recordSuccess("server-1")
    expect(getFailureCount("server-1")).toBe(0)
    expect(isCircuitOpen("server-1")).toBe(false)
  })

  it("isolates server state and honors a caller-provided threshold", () => {
    recordFailure("server-1")
    recordFailure("server-2")
    recordFailure("server-2")

    expect(isCircuitOpen("server-1", 1)).toBe(true)
    expect(isCircuitOpen("server-1", 2)).toBe(false)
    expect(getFailureCount("server-2")).toBe(2)

    recordSuccess("server-1")
    expect(getFailureCount("server-2")).toBe(2)
  })

  it("clears all tracked servers", () => {
    recordFailure("server-1")
    recordFailure("server-2")

    resetAllCircuits()

    expect(getFailureCount("server-1")).toBe(0)
    expect(getFailureCount("server-2")).toBe(0)
  })
})
