import { describe, expect, it } from "vitest"
import {
  CHAT_ROUTE_MAX_DURATION_SECONDS,
  CHAT_TURN_EXECUTION_BUDGET,
  deriveChatTurnExecutionBudget,
} from "./execution-budget"

// The budget is one derivation with one load-bearing property: the deadline
// ordering (gameplan §0). Test the ordering and the decided top-line, not one
// assertion per field.

describe("chat-turn execution budget", () => {
  it("derives the enforced ordering from the 300 s top-line", () => {
    const b = CHAT_TURN_EXECUTION_BUDGET
    expect(CHAT_ROUTE_MAX_DURATION_SECONDS).toBe(300)
    expect(b.routeMaxMs).toBe(300_000)
    expect(b.providerDeadlineMs).toBeLessThan(b.settlementReserveBoundaryMs)
    expect(b.settlementReserveBoundaryMs).toBeLessThan(b.routeMaxMs)
    expect(b.routeMaxMs).toBeLessThan(b.grantTtlMs)
    expect(b.grantTtlMs).toBeLessThan(b.reaperGraceMs)
    expect(b.clientStreamWatchdogMs).toBeGreaterThan(b.routeMaxMs)
    expect(b.settlementReserveBoundaryMs).toBe(
      b.routeMaxMs - b.settlementReserveMs
    )
  })

  it("rejects a top-line too small to hold the settlement reserve", () => {
    // A route budget inside the reserve inverts the ordering — the derivation
    // must throw rather than emit a nonsensical budget.
    expect(() => deriveChatTurnExecutionBudget({ routeMaxMs: 20_000 })).toThrow(
      /ordering violated/
    )
  })
})
