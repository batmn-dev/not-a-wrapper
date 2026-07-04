import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { textOnlyAdapter } from "../text-only"
import * as fixtures from "./fixtures"

const context = {
  targetModelId: "sonar",
  hasTools: false,
}

describe("textOnlyAdapter", () => {
  it("extracts only text parts from mixed assistant content", async () => {
    const result = await textOnlyAdapter.adaptMessages(
      [fixtures.singleSdkToolComplete],
      context
    )

    expect(result.messages[0].parts).toEqual([
      { type: "text", text: "Here are the top search results." },
    ])
    expect(result.stats.partsDropped["tool-exa_search"]).toBe(1)
    expect(result.warnings).toHaveLength(0)
  })

  it("injects fallback text when all parts are non-text", async () => {
    const nonTextAssistant = {
      id: "msg-text-only-fallback-1",
      role: "assistant",
      parts: [{ type: "reasoning", reasoning: "hidden", state: "done" }],
    } as unknown as UIMessage

    const result = await textOnlyAdapter.adaptMessages(
      [nonTextAssistant],
      context
    )

    expect(result.messages[0].parts).toEqual([{ type: "text", text: "" }])
    expect(result.stats.partsDropped.reasoning).toBe(1)
    expect(
      result.warnings.some((w) => w.code === "empty_message_fallback")
    ).toBe(true)
  })

  it("filters out role=tool messages entirely", async () => {
    const toolMessage = {
      id: "msg-tool-1",
      role: "tool",
      parts: [{ type: "text", text: "tool response" }],
    } as unknown as UIMessage

    const result = await textOnlyAdapter.adaptMessages(
      [
        fixtures.userMessage("u1", "hello"),
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
    expect(result.warnings).toHaveLength(0)
  })
})
