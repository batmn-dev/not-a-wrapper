import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { googleAdapter } from "../google"
import * as fixtures from "./fixtures"

const gemini3Context = {
  targetModelId: "gemini-3-pro",
  hasTools: true,
}

const gemini25Context = {
  targetModelId: "gemini-2.5-pro",
  hasTools: true,
}

describe("googleAdapter", () => {
  it("enforces FC/FR parity by dropping extra unpaired results", async () => {
    const assistantWithExtraResult = {
      id: "msg-google-parity-1",
      role: "assistant",
      parts: [
        { type: "reasoning", reasoning: "do tool call", state: "done" },
        {
          type: "tool-web_search",
          toolCallId: "tc_parity_1",
          state: "output-available",
          output: { ok: true },
        },
        {
          type: "tool-result",
          toolCallId: "tc_parity_1",
          output: { ok: true },
        },
      ],
    } as unknown as UIMessage

    const result = await googleAdapter.adaptMessages(
      [assistantWithExtraResult],
      gemini25Context
    )

    expect(
      result.messages[0].parts.filter((part) => part.type === "tool-result")
    ).toHaveLength(0)
    expect(result.stats.partsDropped["tool-result"]).toBe(1)
    expect(
      result.warnings.some((w) => w.code === "incomplete_triple_dropped")
    ).toBe(true)
  })

  it("drops orphan tool results when no matching invocation exists", async () => {
    const orphanResult = {
      id: "msg-google-orphan-result-1",
      role: "assistant",
      parts: [
        {
          type: "tool-result",
          toolCallId: "tc_orphan_result",
          output: { ok: true },
        },
      ],
    } as unknown as UIMessage

    const result = await googleAdapter.adaptMessages(
      [orphanResult],
      gemini25Context
    )

    expect(result.messages[0].parts).toEqual([{ type: "text", text: "" }])
    expect(result.stats.partsDropped["tool-result"]).toBe(1)
    expect(
      result.warnings.some((w) => w.code === "empty_message_fallback")
    ).toBe(true)
  })

  it("repairs role alternation by merging consecutive user messages", async () => {
    const conversation: UIMessage[] = [
      fixtures.userMessage("u1", "First"),
      fixtures.userMessage("u2", "Second"),
    ]

    const result = await googleAdapter.adaptMessages(
      conversation,
      gemini25Context
    )

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].parts).toEqual([
      { type: "text", text: "First\n\nSecond" },
    ])
    expect(
      result.warnings.some((w) => w.code === "role_alternation_repaired")
    ).toBe(true)
  })

  it("preserves non-text user parts when merging consecutive user messages", async () => {
    const conversation: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [
          { type: "text", text: "Describe this image" },
          {
            type: "image",
            image: new Uint8Array([1, 2, 3]),
            mimeType: "image/png",
          },
        ],
      } as unknown as UIMessage,
      {
        id: "u2",
        role: "user",
        parts: [{ type: "text", text: "and compare it to this one" }],
      } as unknown as UIMessage,
    ]

    const result = await googleAdapter.adaptMessages(
      conversation,
      gemini25Context
    )

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].parts.map((part) => part.type)).toEqual([
      "text",
      "image",
      "text",
    ])
    expect(result.messages[0].parts[0]).toEqual({
      type: "text",
      text: "Describe this image",
    })
    expect(result.messages[0].parts[2]).toEqual({
      type: "text",
      text: "and compare it to this one",
    })
    expect(
      result.warnings.some((w) => w.code === "role_alternation_repaired")
    ).toBe(true)
  })

  it("repairs role alternation by merging consecutive assistant messages", async () => {
    const conversation: UIMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "one" }],
      } as unknown as UIMessage,
      {
        id: "a2",
        role: "assistant",
        parts: [{ type: "text", text: "two" }],
      } as unknown as UIMessage,
    ]

    const result = await googleAdapter.adaptMessages(
      conversation,
      gemini25Context
    )

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].parts.map((part) => part.type)).toEqual([
      "text",
      "text",
    ])
    expect(
      result.warnings.some((w) => w.code === "role_alternation_repaired")
    ).toBe(true)
  })

  it("injects thought signatures for gemini-3 tool invocations", async () => {
    const result = await googleAdapter.adaptMessages(
      [fixtures.singleSdkToolComplete],
      gemini3Context
    )
    const toolPart = result.messages[0].parts.find(
      (part) => part.type === "tool-exa_search"
    ) as {
      providerMetadata?: { google?: { thoughtSignature?: string } }
    }

    expect(toolPart.providerMetadata?.google?.thoughtSignature).toBe(
      "skip_thought_signature_validator"
    )
    expect(
      result.stats.partsTransformed["tool-exa_search"]
    ).toBeGreaterThanOrEqual(1)
    expect(
      result.warnings.some((w) => w.code === "thought_signature_injected")
    ).toBe(true)
  })

  it("does not inject thought signatures for non-gemini-3 models", async () => {
    const result = await googleAdapter.adaptMessages(
      [fixtures.singleSdkToolComplete],
      gemini25Context
    )
    const toolPart = result.messages[0].parts.find(
      (part) => part.type === "tool-exa_search"
    ) as {
      providerMetadata?: { google?: { thoughtSignature?: string } }
    }

    expect(toolPart.providerMetadata?.google?.thoughtSignature).toBeUndefined()
    expect(result.stats.partsTransformed["tool-exa_search"] ?? 0).toBe(0)
    expect(
      result.warnings.some((w) => w.code === "thought_signature_injected")
    ).toBe(false)
  })

  it("preserves reasoning parts for Gemini thought conversion", async () => {
    const result = await googleAdapter.adaptMessages(
      [fixtures.reasoningPlusText],
      gemini25Context
    )

    expect(result.messages[0].parts.map((part) => part.type)).toEqual([
      "reasoning",
      "text",
    ])
    expect(result.stats.partsPreserved.reasoning).toBe(1)
    expect(result.warnings).toHaveLength(0)
  })

  it("drops source artifact parts declared in metadata", async () => {
    const message = {
      id: "msg-google-source-artifacts",
      role: "assistant",
      parts: [
        { type: "source-url", url: "https://example.com" },
        { type: "source-document", source: { id: "doc_1", title: "Doc" } },
        { type: "text", text: "kept" },
      ],
    } as unknown as UIMessage

    const result = await googleAdapter.adaptMessages([message], gemini25Context)

    expect(result.messages[0].parts).toEqual([{ type: "text", text: "kept" }])
    expect(result.stats.partsDropped["source-url"]).toBe(1)
    expect(result.stats.partsDropped["source-document"]).toBe(1)
  })

  it("strips cross-provider callProviderMetadata from tool parts", async () => {
    const result = await googleAdapter.adaptMessages(
      [fixtures.crossProviderMetadata],
      gemini25Context
    )
    const toolPart = result.messages[0].parts.find(
      (part) => part.type === "tool-web_search"
    )

    expect(
      "callProviderMetadata" in (toolPart as Record<string, unknown>)
    ).toBe(false)
    expect(result.stats.providerIdsStripped).toBe(1)
    expect(
      result.warnings.some((w) => w.code === "provider_ids_stripped")
    ).toBe(true)
  })
})
