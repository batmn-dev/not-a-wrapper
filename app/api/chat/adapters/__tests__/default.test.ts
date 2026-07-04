import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { sanitizeMessagesForProvider } from "../../utils"
import { defaultAdapter } from "../default"
import * as fixtures from "./fixtures"

const context = {
  targetModelId: "unknown-model",
  hasTools: true,
}

function shape(messages: UIMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    parts: message.parts,
  }))
}

describe("defaultAdapter", () => {
  it("matches legacy strip-all sanitize behavior by message shape", async () => {
    const conversation = [
      fixtures.userMessage("u1", "Find Batman products"),
      fixtures.singleSdkToolComplete,
      fixtures.userMessage("u2", "Thanks"),
    ]

    const adapted = await defaultAdapter.adaptMessages(conversation, context)
    const legacy = sanitizeMessagesForProvider(
      conversation as unknown as UIMessage[],
      "openai"
    )

    expect(shape(adapted.messages)).toEqual(
      shape(legacy as unknown as UIMessage[])
    )
    expect(adapted.stats.partsDropped.reasoning).toBe(1)
    expect(adapted.warnings).toHaveLength(0)
  })

  it("injects fallback text for assistant messages with only stripped parts", async () => {
    const strippedAssistant = {
      id: "msg-default-fallback-1",
      role: "assistant",
      parts: [
        { type: "reasoning", reasoning: "thinking", state: "done" },
        {
          type: "tool-web_search",
          toolCallId: "tc_default_1",
          state: "output-available",
          output: { ok: true },
        },
      ],
    } as unknown as UIMessage

    const result = await defaultAdapter.adaptMessages(
      [strippedAssistant],
      context
    )

    expect(result.messages[0].parts).toEqual([{ type: "text", text: "" }])
    expect(result.stats.partsTransformed["fallback-text"]).toBe(1)
    expect(
      result.warnings.some((w) => w.code === "empty_message_fallback")
    ).toBe(true)
  })

  it("drops role=tool messages from the transcript", async () => {
    const toolMessage = {
      id: "msg-default-tool-1",
      role: "tool",
      parts: [
        {
          type: "tool-result",
          toolCallId: "tc_default_2",
          output: { ok: true },
        },
      ],
    } as unknown as UIMessage

    const result = await defaultAdapter.adaptMessages(
      [
        fixtures.userMessage("u1", "Q"),
        toolMessage,
        fixtures.textOnlyAssistant,
      ],
      context
    )

    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ])
    expect(result.stats.droppedMessages).toBe(1)
    expect(
      result.warnings.some((w) => w.code === "incomplete_triple_dropped")
    ).toBe(true)
  })

  it("strips non-text user parts in default fallback path", async () => {
    const userWithUnsupportedParts = {
      id: "msg-default-user-1",
      role: "user",
      parts: [
        { type: "text", text: "Hi" },
        { type: "reasoning", reasoning: "should-not-pass", state: "done" },
        {
          type: "tool-web_search",
          state: "output-available",
          toolCallId: "tc_default_user_1",
          output: {},
        },
      ],
    } as unknown as UIMessage

    const result = await defaultAdapter.adaptMessages(
      [userWithUnsupportedParts],
      context
    )

    expect(result.messages[0].parts).toEqual([{ type: "text", text: "Hi" }])
    expect(result.stats.partsDropped.reasoning).toBe(1)
    expect(result.stats.partsDropped["tool-web_search"]).toBe(1)
  })
})
