import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getFailureCount,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
  resetAllCircuits,
} from "../circuit-breaker"

// Mock the config module to control the threshold in tests
vi.mock("@/lib/config", () => ({
  MCP_CIRCUIT_BREAKER_THRESHOLD: 3,
}))

describe("circuit-breaker", () => {
  beforeEach(() => {
    resetAllCircuits()
  })

  // ===========================================================================
  // isCircuitOpen
  // ===========================================================================

  describe("isCircuitOpen", () => {
    it("returns false for unknown servers (healthy by default)", () => {
      expect(isCircuitOpen("server_1")).toBe(false)
    })

    it("returns false when failures are below threshold", () => {
      recordFailure("server_1")
      recordFailure("server_1")
      // 2 failures, threshold is 3
      expect(isCircuitOpen("server_1")).toBe(false)
    })

    it("returns true when failures reach threshold", () => {
      recordFailure("server_1")
      recordFailure("server_1")
      recordFailure("server_1")
      // 3 failures === threshold
      expect(isCircuitOpen("server_1")).toBe(true)
    })

    it("returns true when failures exceed threshold", () => {
      for (let i = 0; i < 5; i++) {
        recordFailure("server_1")
      }
      expect(isCircuitOpen("server_1")).toBe(true)
    })

    it("supports custom threshold", () => {
      recordFailure("server_1")
      // With threshold=1, a single failure opens the circuit
      expect(isCircuitOpen("server_1", 1)).toBe(true)
      // With threshold=2, it's still closed
      expect(isCircuitOpen("server_1", 2)).toBe(false)
    })
  })

  // ===========================================================================
  // recordFailure
  // ===========================================================================

  describe("recordFailure", () => {
    it("increments failure count", () => {
      expect(getFailureCount("server_1")).toBe(0)

      recordFailure("server_1")
      expect(getFailureCount("server_1")).toBe(1)

      recordFailure("server_1")
      expect(getFailureCount("server_1")).toBe(2)

      recordFailure("server_1")
      expect(getFailureCount("server_1")).toBe(3)
    })

    it("tracks failures independently per server", () => {
      recordFailure("server_1")
      recordFailure("server_1")
      recordFailure("server_2")

      expect(getFailureCount("server_1")).toBe(2)
      expect(getFailureCount("server_2")).toBe(1)
    })
  })

  // ===========================================================================
  // recordSuccess
  // ===========================================================================

  describe("recordSuccess", () => {
    it("resets failure count to zero", () => {
      recordFailure("server_1")
      recordFailure("server_1")
      recordFailure("server_1")
      expect(isCircuitOpen("server_1")).toBe(true)

      recordSuccess("server_1")
      expect(isCircuitOpen("server_1")).toBe(false)
      expect(getFailureCount("server_1")).toBe(0)
    })

    it("is a no-op for servers with no failures", () => {
      // Should not throw or create a negative state
      recordSuccess("server_1")
      expect(getFailureCount("server_1")).toBe(0)
      expect(isCircuitOpen("server_1")).toBe(false)
    })

    it("only resets the specified server", () => {
      recordFailure("server_1")
      recordFailure("server_1")
      recordFailure("server_1")
      recordFailure("server_2")
      recordFailure("server_2")
      recordFailure("server_2")

      recordSuccess("server_1")

      expect(isCircuitOpen("server_1")).toBe(false)
      expect(isCircuitOpen("server_2")).toBe(true)
    })
  })

  // ===========================================================================
  // getFailureCount
  // ===========================================================================

  describe("getFailureCount", () => {
    it("returns 0 for unknown servers", () => {
      expect(getFailureCount("nonexistent")).toBe(0)
    })

    it("returns current consecutive failure count", () => {
      recordFailure("server_1")
      expect(getFailureCount("server_1")).toBe(1)

      recordFailure("server_1")
      expect(getFailureCount("server_1")).toBe(2)
    })

    it("returns 0 after a success resets the count", () => {
      recordFailure("server_1")
      recordFailure("server_1")
      recordSuccess("server_1")
      expect(getFailureCount("server_1")).toBe(0)
    })
  })

  // ===========================================================================
  // resetAllCircuits
  // ===========================================================================

  describe("resetAllCircuits", () => {
    it("clears all tracked servers", () => {
      recordFailure("server_1")
      recordFailure("server_1")
      recordFailure("server_1")
      recordFailure("server_2")
      recordFailure("server_2")
      recordFailure("server_2")

      expect(isCircuitOpen("server_1")).toBe(true)
      expect(isCircuitOpen("server_2")).toBe(true)

      resetAllCircuits()

      expect(isCircuitOpen("server_1")).toBe(false)
      expect(isCircuitOpen("server_2")).toBe(false)
      expect(getFailureCount("server_1")).toBe(0)
      expect(getFailureCount("server_2")).toBe(0)
    })
  })

  // ===========================================================================
  // Full lifecycle
  // ===========================================================================

  describe("full lifecycle", () => {
    it("opens after threshold failures, closes after success, reopens after new failures", () => {
      // Start healthy
      expect(isCircuitOpen("server_1")).toBe(false)

      // Accumulate failures until circuit opens
      recordFailure("server_1")
      recordFailure("server_1")
      recordFailure("server_1")
      expect(isCircuitOpen("server_1")).toBe(true)

      // Success closes the circuit
      recordSuccess("server_1")
      expect(isCircuitOpen("server_1")).toBe(false)

      // Failures accumulate again from 0
      recordFailure("server_1")
      expect(getFailureCount("server_1")).toBe(1)
      expect(isCircuitOpen("server_1")).toBe(false)

      recordFailure("server_1")
      recordFailure("server_1")
      expect(isCircuitOpen("server_1")).toBe(true)
    })
  })
})
