import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import {
  excludeSystemRoleMessages,
  hasProviderLinkedResponseIds,
  isConvexArgumentValidationError,
  stripProviderLinkedMetadataFromMessage,
  toPlainTextModelMessages,
} from "./utils"

describe("hasProviderLinkedResponseIds", () => {
  it("distinguishes provider-linked response ids from ordinary text", () => {
    const modelMessages = [
      { role: "assistant", content: "msg_abc123 and rs_def456 and ws_ghi789" },
    ] as const
    expect(hasProviderLinkedResponseIds(modelMessages as any)).toBe(true)
    const ordinaryMessages = [
      { role: "assistant", content: "normal response text" },
    ] as const
    expect(hasProviderLinkedResponseIds(ordinaryMessages as any)).toBe(false)
  })
})

describe("toPlainTextModelMessages", () => {
  it("converts UI messages to plain text model messages", () => {
    const messages = [
      {
        id: "a",
        role: "assistant",
        parts: [
          { type: "text", text: "line 1" },
          { type: "reasoning", text: "internal" },
          { type: "text", text: "line 2" },
        ],
      },
      {
        id: "u",
        role: "user",
        parts: [{ type: "text", text: "follow-up" }],
      },
    ] as unknown as UIMessage[]

    const result = toPlainTextModelMessages(messages)
    expect(result).toEqual([
      { role: "assistant", content: "line 1\n\nline 2" },
      { role: "user", content: "follow-up" },
    ])
  })
})

describe("stripProviderLinkedMetadataFromMessage", () => {
  it("removes provider metadata carriers but keeps part semantics intact", () => {
    const message = {
      id: "tail",
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "thinking",
          providerMetadata: { openai: { itemId: "rs_abc123" } },
        },
        {
          type: "dynamic-tool",
          toolName: "deepwiki_ask_question",
          toolCallId: "call_1",
          state: "approval-responded",
          input: { question: "q" },
          approval: { id: "approval_1", approved: true },
          callProviderMetadata: { openai: { itemId: "msg_def456" } },
        },
        { type: "text", text: "plain" },
      ],
    } as unknown as UIMessage

    const stripped = stripProviderLinkedMetadataFromMessage(message)

    expect(stripped.parts).toEqual([
      { type: "reasoning", text: "thinking" },
      {
        type: "dynamic-tool",
        toolName: "deepwiki_ask_question",
        toolCallId: "call_1",
        state: "approval-responded",
        input: { question: "q" },
        approval: { id: "approval_1", approved: true },
      },
      { type: "text", text: "plain" },
    ])
    // The pairing-id detector no longer fires on the stripped message.
    expect(
      hasProviderLinkedResponseIds([
        { role: "assistant", content: JSON.stringify(stripped.parts) },
      ] as never)
    ).toBe(false)
  })
})

describe("isConvexArgumentValidationError", () => {
  it("matches Convex argument-validation rejections and nothing else", () => {
    const convexShape = new Error(
      '[Request ID: abc123] Server Error\nArgumentValidationError: Value does not match validator.\nPath: .chatId\nValue: "smoke"\nValidator: v.id("chats")'
    )
    expect(isConvexArgumentValidationError(convexShape)).toBe(true)
    expect(isConvexArgumentValidationError(new Error("stream aborted"))).toBe(
      false
    )
    expect(isConvexArgumentValidationError("not-an-error")).toBe(false)
  })
})

describe("excludeSystemRoleMessages", () => {
  it("drops system-role messages and reports the count", () => {
    const messages = [
      { id: "s", role: "system", parts: [{ type: "text", text: "legacy" }] },
      { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] },
      { id: "a", role: "assistant", parts: [{ type: "text", text: "hello" }] },
    ] as unknown as UIMessage[]

    const result = excludeSystemRoleMessages(messages)
    expect(result.excludedCount).toBe(1)
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant"])
  })
})
