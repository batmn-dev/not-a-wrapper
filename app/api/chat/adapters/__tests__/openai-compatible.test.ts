import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { openaiCompatibleAdapter } from "../openai-compatible"
import * as fixtures from "./fixtures"

const context = {
  targetModelId: "grok-4",
  hasTools: true,
}

describe("openaiCompatibleAdapter", () => {
  it("drops reasoning parts from assistant history", async () => {
    const result = await openaiCompatibleAdapter.adaptMessages(
      [fixtures.reasoningPlusText],
      context
    )

    expect(result.messages[0].parts).toEqual([
      { type: "text", text: "Here's my answer" },
    ])
    expect(result.stats.partsDropped.reasoning).toBe(1)
    expect(result.warnings).toHaveLength(0)
  })

  it("keeps complete tool pairs", async () => {
    const result = await openaiCompatibleAdapter.adaptMessages(
      [fixtures.singleSdkToolComplete],
      context
    )
    const toolParts = result.messages[0].parts.filter((part) =>
      part.type.startsWith("tool-")
    )

    expect(toolParts.length).toBeGreaterThanOrEqual(1)
    expect(result.stats.partsTransformed["tool-exa_search"]).toBe(1)
    expect(result.warnings).toHaveLength(0)
  })

  it("drops orphan tool parts and falls back to text", async () => {
    const orphanResultOnly = {
      id: "msg-openai-compat-orphan-1",
      role: "assistant",
      parts: [
        { type: "tool-result", toolCallId: "tc_missing", output: { ok: true } },
      ],
    } as unknown as UIMessage

    const result = await openaiCompatibleAdapter.adaptMessages(
      [orphanResultOnly],
      context
    )

    expect(result.messages[0].parts).toEqual([{ type: "text", text: "" }])
    expect(result.stats.partsDropped["tool-result"]).toBe(1)
    expect(
      result.warnings.some((w) => w.code === "incomplete_triple_dropped")
    ).toBe(true)
  })

  it("enforces name on tool results by deriving from invocation toolName", async () => {
    const invocationAndResult = {
      id: "msg-openai-compat-name-1",
      role: "assistant",
      parts: [
        {
          type: "tool-web_search",
          toolCallId: "tc_name_1",
          toolName: "web_search",
          output: { ok: true },
        },
        { type: "tool-result", toolCallId: "tc_name_1", output: { ok: true } },
      ],
    } as unknown as UIMessage

    const result = await openaiCompatibleAdapter.adaptMessages(
      [invocationAndResult],
      context
    )
    const toolResultPart = result.messages[0].parts.find(
      (part) => part.type === "tool-result"
    ) as {
      name?: unknown
    }

    expect(toolResultPart.name).toBe("web_search")
    expect(result.stats.partsTransformed["tool-result"]).toBe(1)
    expect(result.warnings).toHaveLength(0)
  })

  it("strips callProviderMetadata from tool parts", async () => {
    const result = await openaiCompatibleAdapter.adaptMessages(
      [fixtures.crossProviderMetadata],
      context
    )
    const toolPart = result.messages[0].parts.find(
      (part) => part.type === "tool-web_search"
    )

    expect(
      "callProviderMetadata" in (toolPart as Record<string, unknown>)
    ).toBe(false)
    expect(result.stats.providerIdsStripped).toBe(1)
    expect(result.warnings).toHaveLength(0)
  })
})
