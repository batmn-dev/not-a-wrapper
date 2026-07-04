import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { anthropicAdapter } from "../anthropic"
import * as fixtures from "./fixtures"

const context = {
  targetModelId: "claude-4.5-sonnet",
  hasTools: true,
}

describe("anthropicAdapter", () => {
  it("passes through non-step parts for assistant history", async () => {
    const result = await anthropicAdapter.adaptMessages(
      [fixtures.reasoningPlusText],
      context
    )

    expect(result.messages[0].parts).toEqual(fixtures.reasoningPlusText.parts)
    expect(result.stats.partsPreserved.reasoning).toBe(1)
    expect(result.warnings).toHaveLength(0)
  })

  it("strips step-start while preserving reasoning and tools", async () => {
    const result = await anthropicAdapter.adaptMessages(
      [fixtures.singleSdkToolComplete],
      context
    )

    expect(
      result.messages[0].parts.some((part) => part.type === "step-start")
    ).toBe(false)
    expect(
      result.messages[0].parts.some((part) => part.type === "reasoning")
    ).toBe(true)
    expect(result.stats.partsDropped["step-start"]).toBe(1)
    expect(result.warnings).toHaveLength(0)
  })

  it("tolerates cross-provider reasoning and strips foreign provider metadata", async () => {
    const result = await anthropicAdapter.adaptMessages(
      [fixtures.crossProviderMetadata],
      context
    )
    const toolPart = result.messages[0].parts.find(
      (part) => part.type === "tool-web_search"
    )

    expect(
      result.messages[0].parts.some((part) => part.type === "reasoning")
    ).toBe(true)
    expect(toolPart).toBeUndefined()
    expect(
      result.messages[0].parts.some(
        (part) =>
          part.type === "text" &&
          typeof (part as { text?: unknown }).text === "string" &&
          (part as { text: string }).text.includes("Replay")
      )
    ).toBe(true)
    expect(result.stats.providerIdsStripped).toBe(1)
    expect(
      result.warnings.some((w) => w.code === "provider_ids_stripped")
    ).toBe(true)
  })

  it("emits orphan warning when tool invocation/result counts mismatch", async () => {
    const orphanAssistant = {
      id: "msg-anthropic-orphan-1",
      role: "assistant",
      parts: [
        { type: "reasoning", reasoning: "thinking", state: "done" },
        {
          type: "tool-web_search",
          toolCallId: "tc_orphan_a",
          state: "input-available",
        },
      ],
    } as unknown as UIMessage

    const result = await anthropicAdapter.adaptMessages(
      [orphanAssistant],
      context
    )

    expect(result.messages[0].parts).toEqual([
      { type: "reasoning", reasoning: "thinking", state: "done" },
    ])
    expect(result.stats.partsDropped["tool-web_search"]).toBe(1)
    expect(
      result.warnings.some((w) => w.code === "non_final_state_dropped")
    ).toBe(true)
  })

  it("warns on orphan tool result without invocation", async () => {
    const orphanResultAssistant = {
      id: "msg-anthropic-orphan-2",
      role: "assistant",
      parts: [
        {
          type: "tool-result",
          toolCallId: "tc_missing_invocation",
          output: { ok: true },
        },
      ],
    } as unknown as UIMessage

    const result = await anthropicAdapter.adaptMessages(
      [orphanResultAssistant],
      context
    )

    expect(result.messages[0].parts).toEqual(orphanResultAssistant.parts)
    expect(result.stats.partsDropped["tool-result"]).toBeUndefined()
    expect(
      result.warnings.some((w) => w.code === "incomplete_triple_dropped")
    ).toBe(true)
  })

  it("converts object-shaped web_search output to Anthropic-safe text replay context", async () => {
    const openaiShapeWebSearch = {
      id: "msg-anthropic-shape-1",
      role: "assistant",
      parts: [
        { type: "reasoning", reasoning: "Searching...", state: "done" },
        {
          type: "tool-web_search",
          state: "output-available",
          toolCallId: "tc_shape_1",
          toolName: "web_search",
          output: {
            action: { type: "search", query: "top news today" },
            sources: [
              {
                type: "url",
                url: "https://apnews.com/example",
                title: "AP News",
              },
              { type: "url", url: "https://example.com/other" },
            ],
          },
        },
      ],
    } as unknown as UIMessage

    const result = await anthropicAdapter.adaptMessages(
      [openaiShapeWebSearch],
      context
    )
    const toolPart = result.messages[0].parts.find(
      (part) => part.type === "tool-web_search"
    ) as { output?: unknown } | undefined

    expect(toolPart).toBeUndefined()
    expect(
      result.messages[0].parts.some(
        (part) =>
          part.type === "text" &&
          typeof (part as { text?: unknown }).text === "string" &&
          (part as { text: string }).text.includes(
            "Replay context from prior web_search"
          )
      )
    ).toBe(true)
    expect(result.stats.partsTransformed["tool-web_search"]).toBe(1)
  })
})
