import { describe, expect, it } from "vitest"
import {
  DURABLE_MESSAGE_STATUSES,
  GENERATION_RUN_STATUSES,
  isActiveGenerationRunStatus,
  isAwaitingApprovalStatus,
  isTerminalGenerationRunStatus,
  isTerminalMessageStatus,
} from "./message_contract"

describe("Convex durable message contract", () => {
  it("keeps Convex message statuses explicit", () => {
    expect(DURABLE_MESSAGE_STATUSES).toEqual([
      "submitted",
      "streaming",
      "completed",
      "aborted",
      "failed",
      "awaiting_approval",
    ])
  })

  it("keeps Convex generation run statuses explicit", () => {
    expect(GENERATION_RUN_STATUSES).toEqual([
      "queued",
      "running",
      "streaming",
      "awaiting_approval",
      "completed",
      "aborted",
      "failed",
    ])
  })

  it("classifies lifecycle statuses used by chatRuntime", () => {
    expect(isTerminalMessageStatus("completed")).toBe(true)
    expect(isTerminalMessageStatus("streaming")).toBe(false)
    expect(isTerminalMessageStatus("ready")).toBe(false)

    expect(isTerminalGenerationRunStatus("failed")).toBe(true)
    expect(isActiveGenerationRunStatus("queued")).toBe(true)
    expect(isActiveGenerationRunStatus("running")).toBe(true)
    expect(isActiveGenerationRunStatus("pending")).toBe(false)
    expect(isAwaitingApprovalStatus("awaiting_approval")).toBe(true)
  })
})
