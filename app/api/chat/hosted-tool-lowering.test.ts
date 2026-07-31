import { anthropic } from "@ai-sdk/anthropic"
import { openai } from "@ai-sdk/openai"
import type { ToolSet, UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { lowerForeignHostedToolParts } from "./hosted-tool-lowering"

// These tests run the REAL installed provider tool schemas — the exact
// incompatibility that produced the production failure (Anthropic array
// output vs OpenAI object schema under the shared `web_search` key).

const openaiTools = {
  web_search: openai.tools.webSearch({}),
} as unknown as ToolSet
const anthropicTools = {
  web_search: anthropic.tools.webSearch_20250305(),
} as unknown as ToolSet

const ENCRYPTED = "ENCRYPTED_CONTENT_SENTINEL"

function anthropicSearchMessage(): UIMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-web_search",
        state: "output-available",
        toolCallId: "srvtoolu_abc123",
        providerExecuted: true,
        input: { query: "batman merch" },
        output: [
          {
            type: "web_search_result",
            url: "https://example.com/merch",
            title: "Merch",
            pageAge: null,
            encryptedContent: ENCRYPTED,
          },
        ],
      },
      { type: "text", text: "Here is what I found." },
    ],
  } as UIMessage
}

function modernOpenAISearchMessage(): UIMessage {
  return {
    id: "o1",
    role: "assistant",
    parts: [
      {
        type: "tool-web_search",
        state: "output-available",
        toolCallId: "ws_abc123",
        providerExecuted: true,
        input: {},
        output: {
          action: { type: "search", queries: ["q"] },
          sources: [{ type: "url", url: "https://example.com" }],
        },
      },
      { type: "text", text: "Done." },
    ],
  } as UIMessage
}

describe("lowerForeignHostedToolParts", () => {
  it("lowers an Anthropic-origin web_search under an OpenAI registry to citation text", async () => {
    const result = await lowerForeignHostedToolParts(
      [anthropicSearchMessage()],
      openaiTools
    )

    expect(result.loweredCount).toBe(1)
    expect(result.details[0]).toMatchObject({
      toolName: "web_search",
      reason: "schema_mismatch",
    })

    const parts = result.messages[0]!.parts
    expect(parts.some((part) => part.type === "tool-web_search")).toBe(false)
    const loweredText = parts.find(
      (part) => part.type === "text" && part.text.includes("web search")
    )
    expect(loweredText).toBeDefined()
    expect((loweredText as { text: string }).text).toContain("batman merch")
    expect((loweredText as { text: string }).text).toContain(
      "https://example.com/merch"
    )
    // Opaque provider payloads must never survive lowering.
    expect(JSON.stringify(result.messages)).not.toContain(ENCRYPTED)
    expect(JSON.stringify(result.messages)).not.toContain("srvtoolu_")
  })

  it("keeps an Anthropic-origin web_search under an Anthropic registry", async () => {
    const result = await lowerForeignHostedToolParts(
      [anthropicSearchMessage()],
      anthropicTools
    )
    expect(result.loweredCount).toBe(0)
    expect(
      result.messages[0]!.parts.some((part) => part.type === "tool-web_search")
    ).toBe(true)
  })

  it("keeps a modern OpenAI-shaped web_search under an OpenAI registry", async () => {
    const result = await lowerForeignHostedToolParts(
      [modernOpenAISearchMessage()],
      openaiTools
    )
    expect(result.loweredCount).toBe(0)
  })

  it("lowers an OpenAI-origin web_search under an Anthropic registry", async () => {
    const result = await lowerForeignHostedToolParts(
      [modernOpenAISearchMessage()],
      anthropicTools
    )
    expect(result.loweredCount).toBe(1)
    expect(
      result.messages[0]!.parts.some((part) => part.type === "tool-web_search")
    ).toBe(false)
    expect(JSON.stringify(result.messages)).not.toContain("ws_abc123")
  })

  it("lowers hosted parts when the tool is absent from the registry", async () => {
    const result = await lowerForeignHostedToolParts(
      [anthropicSearchMessage()],
      {} as ToolSet
    )
    expect(result.loweredCount).toBe(1)
    expect(result.details[0]!.reason).toBe("tool_not_registered")
  })

  it("never touches client-executed tool parts or dynamic-tool parts", async () => {
    const message = {
      id: "c1",
      role: "assistant",
      parts: [
        {
          type: "tool-search",
          state: "output-available",
          toolCallId: "call_1",
          input: { query: "q" },
          output: { anything: true },
        },
        {
          type: "dynamic-tool",
          toolName: "mcp_thing",
          state: "output-available",
          toolCallId: "call_2",
          input: {},
          output: { ok: true },
        },
      ],
    } as unknown as UIMessage

    const result = await lowerForeignHostedToolParts([message], openaiTools)
    expect(result.loweredCount).toBe(0)
    expect(result.messages[0]!.parts).toEqual(message.parts)
  })

  it("leaves user messages and text-only history untouched", async () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ] as UIMessage[]
    const result = await lowerForeignHostedToolParts(messages, openaiTools)
    expect(result.messages).toEqual(messages)
    expect(result.loweredCount).toBe(0)
  })
})
