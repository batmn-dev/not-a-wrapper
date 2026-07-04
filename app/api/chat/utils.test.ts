import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import {
  excludeSystemRoleMessages,
  hasProviderLinkedResponseIds,
  sanitizeMessagesForProvider,
  toPlainTextModelMessages,
} from "./utils"

describe("sanitizeMessagesForProvider", () => {
  it("keeps Anthropic history unchanged", () => {
    const messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "thinking..." },
          { type: "tool-web_search", toolCallId: "tc1", input: { q: "x" } },
          { type: "text", text: "Answer" },
        ],
      },
    ] as unknown as UIMessage[]

    const result = sanitizeMessagesForProvider(messages, "anthropic")
    expect(result).toBe(messages)
  })

  it("strips tool/reasoning artifacts for non-Anthropic providers", () => {
    const messages = [
      {
        id: "tool-role",
        role: "tool",
        parts: [
          { type: "tool-result", toolCallId: "tc1", output: { ok: true } },
        ],
      },
      {
        id: "assistant-with-mixed-parts",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "reasoning", text: "thinking..." },
          {
            type: "tool-web_search",
            toolCallId: "tc1",
            input: { q: "batman" },
          },
          { type: "text", text: "Here are suggestions." },
          { type: "source-url", sourceId: "s1", url: "https://example.com" },
        ],
      },
      {
        id: "user-msg",
        role: "user",
        parts: [{ type: "text", text: "next question" }],
      },
    ] as unknown as UIMessage[]

    const result = sanitizeMessagesForProvider(messages, "openai")

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("assistant-0")
    expect(result[1].id).toBe("user-1")

    const assistantPartTypes = result[0].parts.map((p) => p.type)
    expect(assistantPartTypes).toEqual(["text"])
  })

  it("adds empty text fallback when all assistant parts were stripped", () => {
    const messages = [
      {
        id: "assistant-only-artifacts",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "thinking..." },
          {
            type: "tool-web_search",
            toolCallId: "tc1",
            input: { q: "batman" },
          },
        ],
      },
    ] as unknown as UIMessage[]

    const result = sanitizeMessagesForProvider(messages, "openai")
    expect(result).toHaveLength(1)
    expect(result[0].parts).toEqual([{ type: "text", text: "" }])
  })

  it("normalizes replayed OpenAI-style assistant ids to avoid msg_/rs_ coupling", () => {
    const messages = [
      {
        id: "msg_0080e5637f66cbf800698f6838df448193806d367845156964",
        role: "assistant",
        parts: [{ type: "text", text: "answer" }],
      },
    ] as unknown as UIMessage[]

    const result = sanitizeMessagesForProvider(messages, "openai")
    expect(result[0].id).toBe("assistant-0")
    expect(result[0].parts).toEqual([{ type: "text", text: "answer" }])
  })
})

describe("hasProviderLinkedResponseIds", () => {
  it("detects linked response ids in model messages", () => {
    const modelMessages = [
      { role: "assistant", content: "msg_abc123 and rs_def456 and ws_ghi789" },
    ] as const
    expect(hasProviderLinkedResponseIds(modelMessages as any)).toBe(true)
  })

  it("returns false for regular text-only model messages", () => {
    const modelMessages = [
      { role: "assistant", content: "normal response text" },
    ] as const
    expect(hasProviderLinkedResponseIds(modelMessages as any)).toBe(false)
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

  it("returns the same array reference when nothing is excluded", () => {
    const messages = [
      { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] },
    ] as unknown as UIMessage[]

    const result = excludeSystemRoleMessages(messages)
    expect(result.excludedCount).toBe(0)
    expect(result.messages).toBe(messages)
  })
})
