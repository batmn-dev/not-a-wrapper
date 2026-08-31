import { describe, expect, it } from "vitest"
import {
  DURABLE_MESSAGE_STATUSES,
  extractTextFromMessageParts,
  GENERATION_RUN_STATUSES,
  isActiveGenerationRunStatus,
  isAwaitingApprovalStatus,
  isDurableMessageStatus,
  isGenerationRunStatus,
  isTerminalGenerationRunStatus,
  isTerminalMessageStatus,
  type DurableMessageStatus,
  type GenerationRunStatus,
} from "./message_facts"

describe("message facts", () => {
  it("owns the durable status vocabulary and type guards", () => {
    expect(DURABLE_MESSAGE_STATUSES).toEqual([
      "submitted",
      "streaming",
      "completed",
      "aborted",
      "failed",
      "awaiting_approval",
    ])
    expect(GENERATION_RUN_STATUSES).toEqual([
      "queued",
      "running",
      "streaming",
      "awaiting_approval",
      "completed",
      "aborted",
      "failed",
    ])

    const messageStatus: unknown = "streaming"
    const generationStatus: unknown = "queued"
    expect(isDurableMessageStatus(messageStatus)).toBe(true)
    expect(isGenerationRunStatus(generationStatus)).toBe(true)
    if (isDurableMessageStatus(messageStatus)) {
      expect(messageStatus satisfies DurableMessageStatus).toBe("streaming")
    }
    if (isGenerationRunStatus(generationStatus)) {
      expect(generationStatus satisfies GenerationRunStatus).toBe("queued")
    }
    expect(isDurableMessageStatus("ready")).toBe(false)
    expect(isGenerationRunStatus("pending")).toBe(false)
  })

  it("classifies the shared lifecycle states", () => {
    expect(isTerminalMessageStatus("completed")).toBe(true)
    expect(isTerminalMessageStatus("streaming")).toBe(false)
    expect(isTerminalGenerationRunStatus("failed")).toBe(true)
    expect(isActiveGenerationRunStatus("queued")).toBe(true)
    expect(isActiveGenerationRunStatus("awaiting_approval")).toBe(true)
    expect(isActiveGenerationRunStatus("pending")).toBe(false)
    expect(isAwaitingApprovalStatus("awaiting_approval")).toBe(true)
  })

  it("extracts only ordered, valid text parts", () => {
    expect(
      extractTextFromMessageParts([
        { type: "text", text: "hello" },
        { type: "reasoning", text: "hidden" },
        { type: "text", text: " world" },
        { type: "file", filename: "receipt.pdf" },
        { type: "text", text: 123 },
        null,
      ])
    ).toBe("hello world")
    expect(extractTextFromMessageParts(undefined)).toBe("")
    expect(extractTextFromMessageParts({ type: "text", text: "ignored" })).toBe(
      ""
    )
  })
})
