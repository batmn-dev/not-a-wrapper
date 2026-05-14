import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { normalizeReplayMessages } from "../normalize"

describe("normalizeReplayMessages", () => {
  it("normalizes OpenAI web_search object output shape ({ action, sources })", () => {
    const messages = [
      {
        id: "msg-openai-1",
        role: "assistant",
        parts: [
          {
            type: "tool-web_search",
            toolName: "web_search",
            toolCallId: "tc-openai-1",
            state: "output-available",
            input: { query: "Batman products" },
            output: {
              action: "search",
              sources: [
                {
                  url: "https://example.com/a",
                  title: "A",
                  snippet: "First result",
                },
              ],
            },
            callProviderMetadata: {
              openai: {
                responseId: "resp_1",
              },
            },
          },
        ],
      } as unknown as UIMessage,
    ]

    const result = normalizeReplayMessages(messages)

    expect(result.warnings).toHaveLength(0)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].parts).toEqual([
      {
        type: "tool-exchange",
        tool: {
          toolName: "web_search",
          toolCallId: "tc-openai-1",
          state: "output-available",
          replayable: true,
          webSearch: {
            query: "Batman products",
            rawShape: "object-action-sources",
            providerOrigin: "openai",
            results: [
              {
                url: "https://example.com/a",
                title: "A",
                snippet: "First result",
              },
            ],
          },
        },
      },
    ])
  })

  it("normalizes Anthropic web_search array output shape", () => {
    const messages = [
      {
        id: "msg-anthropic-1",
        role: "assistant",
        parts: [
          {
            type: "tool-web_search",
            toolName: "web_search",
            toolCallId: "tc-anthropic-1",
            state: "output-available",
            input: { query: "Batman comics" },
            output: [
              {
                url: "https://example.com/b",
                title: "B",
                snippet: "Second result",
                pageAge: "2h",
                encryptedContent: "enc_payload_2",
                type: "web_search_result",
              },
            ],
            callProviderMetadata: {
              anthropic: {
                requestId: "req_1",
              },
            },
          },
        ],
      } as unknown as UIMessage,
    ]

    const result = normalizeReplayMessages(messages)

    expect(result.warnings).toHaveLength(0)
    expect(result.messages[0].parts[0]).toEqual({
      type: "tool-exchange",
      tool: {
        toolName: "web_search",
        toolCallId: "tc-anthropic-1",
        state: "output-available",
        replayable: true,
        webSearch: {
          query: "Batman comics",
          rawShape: "array-anthropic-native",
          providerOrigin: "anthropic",
          results: [
            {
              url: "https://example.com/b",
              title: "B",
              snippet: "Second result",
              pageAge: "2h",
              encryptedContent: "enc_payload_2",
              resultType: "web_search_result",
            },
          ],
        },
      },
    })
  })

  it("marks malformed web_search output as non-replayable and does not throw", () => {
    const messages = [
      {
        id: "msg-malformed-1",
        role: "assistant",
        parts: [
          {
            type: "tool-web_search",
            toolName: "web_search",
            toolCallId: "tc-malformed-1",
            state: "output-available",
            input: { query: "Batman cowl" },
            output: { action: "search" },
          },
        ],
      } as unknown as UIMessage,
    ]

    expect(() => normalizeReplayMessages(messages)).not.toThrow()

    const result = normalizeReplayMessages(messages)
    expect(result.messages[0].parts[0]).toEqual({
      type: "tool-exchange",
      tool: {
        toolName: "web_search",
        toolCallId: "tc-malformed-1",
        state: "output-available",
        replayable: false,
        nonReplayableReason: "Unsupported web_search output shape.",
        webSearch: {
          query: "Batman cowl",
          rawShape: "unknown",
          providerOrigin: undefined,
          results: [],
        },
      },
    })
    expect(result.warnings.some((warning) => warning.code === "tool_non_replayable")).toBe(true)
  })

  it("captures pay_purchase URL from legacy tool input for continuity fallback", () => {
    const messages = [
      {
        id: "msg-pay-purchase-1",
        role: "assistant",
        parts: [
          {
            type: "tool-pay_purchase",
            toolCallId: "tc-pay-1",
            state: "output-available",
            input: { url: "https://store.example.com/mouse", maxSpend: 4800 },
            output: {
              jobId: "job_123",
              status: "created",
              message: "Purchase job created",
            },
          },
        ],
      } as unknown as UIMessage,
    ]

    const result = normalizeReplayMessages(messages)
    expect(result.warnings.some((warning) => warning.code === "tool_non_replayable")).toBe(true)
    expect(result.messages[0]?.parts[0]).toEqual({
      type: "tool-exchange",
      tool: {
        toolName: "pay_purchase",
        toolCallId: "tc-pay-1",
        state: "output-available",
        replayable: false,
        nonReplayableReason:
          'Platform tool "pay_purchase" is non-replayable (side-effect safety).',
        platformToolContext: {
          toolKey: "pay_purchase",
          jobId: "job_123",
          status: "created",
          url: "https://store.example.com/mouse",
          isTerminal: undefined,
        },
      },
    })
  })
})
