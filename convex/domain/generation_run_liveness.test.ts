import { describe, expect, it } from "vitest"
import { CHAT_TURN_EXECUTION_BUDGET } from "../../lib/chat-turn/execution-budget"
import {
  computeLeaseExpiresAt,
  computeLiveRunFreshUntil,
  HEARTBEAT_INTERVAL_MS,
  isContentWritableRunStatus,
  isLeaseExpired,
  isWorkerExecutingStatus,
  LEASE_DURATION_MS,
  REAPER_INTERVAL_MS,
  runOwnsChatStatusSlot,
} from "./generation_run_liveness"

// The load-bearing distinction: TWO write predicates, not one. Heartbeats
// require worker execution (no pause); content writes require only
// non-terminal (pause included — the approval worker's final flush must land).

describe("worker-write predicates", () => {
  it("isWorkerExecutingStatus excludes the approval pause and every terminal", () => {
    expect(isWorkerExecutingStatus("queued")).toBe(true)
    expect(isWorkerExecutingStatus("running")).toBe(true)
    expect(isWorkerExecutingStatus("streaming")).toBe(true)
    expect(isWorkerExecutingStatus("awaiting_approval")).toBe(false)
    expect(isWorkerExecutingStatus("completed")).toBe(false)
    expect(isWorkerExecutingStatus("aborted")).toBe(false)
    expect(isWorkerExecutingStatus("failed")).toBe(false)
  })

  it("content writes stay legal on the approval pause but never on a terminal", () => {
    expect(isContentWritableRunStatus("streaming")).toBe(true)
    expect(isContentWritableRunStatus("awaiting_approval")).toBe(true)
    expect(isContentWritableRunStatus("completed")).toBe(false)
    expect(isContentWritableRunStatus("aborted")).toBe(false)
    expect(isContentWritableRunStatus("failed")).toBe(false)
  })
})

describe("lease math", () => {
  it("keeps the timing policy ordering: heartbeat < reaper tick < lease", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThan(REAPER_INTERVAL_MS)
    expect(REAPER_INTERVAL_MS).toBeLessThan(LEASE_DURATION_MS)
    // 4.5 heartbeat intervals of slack.
    expect(LEASE_DURATION_MS / HEARTBEAT_INTERVAL_MS).toBe(4.5)
  })

  it("classifies expiry at the boundary and never for a lease-less run", () => {
    const now = 1_000_000
    expect(isLeaseExpired(computeLeaseExpiresAt(now), now)).toBe(false)
    expect(isLeaseExpired(now - 1, now)).toBe(true)
    expect(isLeaseExpired(now, now)).toBe(false)
    // Missing lease fields are a pre-heartbeat row, never an expired one.
    expect(isLeaseExpired(undefined, now)).toBe(false)
  })
})

describe("ownership and freshness", () => {
  it("only the statusRunId owner holds the chat slot", () => {
    expect(
      runOwnsChatStatusSlot({ _id: "run_1" }, { statusRunId: "run_1" })
    ).toBe(true)
    expect(
      runOwnsChatStatusSlot({ _id: "run_1" }, { statusRunId: "run_2" })
    ).toBe(false)
    expect(runOwnsChatStatusSlot({ _id: "run_1" }, {})).toBe(false)
  })

  it("liveRunFreshUntil is the budget ceiling from turn start", () => {
    expect(computeLiveRunFreshUntil(10_000)).toBe(
      10_000 +
        CHAT_TURN_EXECUTION_BUDGET.routeMaxMs +
        CHAT_TURN_EXECUTION_BUDGET.liveRunFreshSlackMs
    )
  })
})
