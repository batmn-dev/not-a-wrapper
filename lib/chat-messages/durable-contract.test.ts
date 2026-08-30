import { describe, expect, it } from "vitest"
import {
  DURABLE_MESSAGE_STATUSES,
  GENERATION_STATUSES,
  isDurableMessageStatus,
  isGenerationStatus,
} from "./durable-contract"
import {
  isActiveGenerationStatus,
  isAwaitingApprovalStatus,
  isTerminalGenerationStatus,
  isTerminalMessageStatus,
} from "./lifecycle"

describe("durable message contract", () => {
  it("documents the current stored durable message statuses", () => {
    expect(DURABLE_MESSAGE_STATUSES).toEqual([
      "submitted",
      "streaming",
      "completed",
      "aborted",
      "failed",
      "awaiting_approval",
    ])
    expect(isDurableMessageStatus("streaming")).toBe(true)
    expect(isDurableMessageStatus("ready")).toBe(false)
  })

  it("documents the current stored generation statuses", () => {
    expect(GENERATION_STATUSES).toEqual([
      "queued",
      "running",
      "streaming",
      "awaiting_approval",
      "completed",
      "aborted",
      "failed",
    ])
    expect(isGenerationStatus("queued")).toBe(true)
    expect(isGenerationStatus("pending")).toBe(false)
  })

  it("classifies lifecycle statuses without accepting unknown values", () => {
    expect(isTerminalMessageStatus("completed")).toBe(true)
    expect(isTerminalMessageStatus("aborted")).toBe(true)
    expect(isTerminalMessageStatus("streaming")).toBe(false)
    expect(isTerminalMessageStatus("ready")).toBe(false)

    expect(isTerminalGenerationStatus("failed")).toBe(true)
    expect(isActiveGenerationStatus("queued")).toBe(true)
    expect(isActiveGenerationStatus("awaiting_approval")).toBe(true)
    expect(isActiveGenerationStatus("pending")).toBe(false)
    expect(isAwaitingApprovalStatus("awaiting_approval")).toBe(true)
  })
})
