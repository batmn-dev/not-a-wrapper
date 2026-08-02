import { describe, expect, it } from "vitest"
import { compileReplay } from "../compilers"
import type { ReplayMessage } from "../types"

const context = {
  targetModelId: "gpt-5.2",
  hasTools: true,
}

function hasToolPart(parts: Array<{ type: string }>): boolean {
  return parts.some(
    (part) => part.type.startsWith("tool-") || part.type === "dynamic-tool"
  )
}

describe("openai replay compiler", () => {
  it("lowers replayable web_search exchanges to text context with citations", async () => {
    const messages: ReplayMessage[] = [
      {
        id: "msg-openai-compile-1",
        role: "assistant",
        parts: [
          { type: "text", text: "I checked one source." },
          {
            type: "tool-exchange",
            tool: {
              toolName: "web_search",
              toolCallId: "tc_openai_compile_1",
              replayable: true,
              webSearch: {
                query: "Batman Amazon links",
                results: [
                  {
                    url: "https://amazon.com/batman-item",
                    title: "Batman Item",
                    snippet: "A relevant listing",
                  },
                ],
              },
            },
          },
          { type: "text", text: "I can share links." },
        ],
      },
    ]

    const result = await compileReplay(messages, "openai", context)
    const assistant = result.messages[0]

    // Never fabricate an OpenAI hosted tool call: the Responses conversion
    // would replay it as an item_reference with a foreign id and 400.
    expect(hasToolPart(assistant.parts)).toBe(false)
    const contextText = assistant.parts
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text"
      )
      .map((part) => part.text)
      .join("\n")
    expect(contextText).toContain('web_search for "Batman Amazon links"')
    expect(contextText).toContain("https://amazon.com/batman-item")
    expect(contextText).toContain("Batman Item")
    expect(
      result.warnings.some((warning) => warning.code === "tool_lowered_to_text")
    ).toBe(true)
    expect(result.stats.toolExchangesSeen).toBe(1)
    expect(result.stats.toolExchangesCompiled).toBe(1)
    expect(result.stats.toolExchangesDropped).toBe(0)
  })

  it("bounds normalized web_search replay while retaining useful citations", async () => {
    const results = Array.from({ length: 4 }, (_, index) => ({
      url: `https://example.com/result-${index + 1}${index === 0 ? "/" + "u".repeat(3_000) : ""}`,
      title: `Result ${index + 1}${index === 0 ? "t".repeat(1_000) : ""}`,
      snippet: `Snippet ${index + 1}${index === 0 ? "s".repeat(3_000) : ""}`,
    }))
    const messages: ReplayMessage[] = [
      {
        id: "msg-openai-all-search-results",
        role: "assistant",
        parts: [
          {
            type: "tool-exchange",
            tool: {
              toolName: "web_search",
              replayable: true,
              webSearch: { query: "all results", results },
            },
          },
        ],
      },
    ]

    const result = await compileReplay(messages, "openai", context)
    const contextText = result.messages[0].parts
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text"
      )
      .map((part) => part.text)
      .join("\n")

    for (const searchResult of results.slice(0, 3)) {
      expect(contextText).toContain(
        searchResult.url.slice(0, "https://example.com/result-1".length)
      )
      expect(contextText).toContain(searchResult.title.slice(0, 8))
      expect(contextText).toContain(searchResult.snippet.slice(0, 9))
    }
    expect(contextText).not.toContain(results[3].url)
    expect(contextText).not.toContain(results[0].url)
    expect(contextText).not.toContain(results[0].title)
    expect(contextText).not.toContain(results[0].snippet)
    expect(contextText).toContain(
      "[1 additional web_search result omitted from replay.]"
    )
    expect(contextText.length).toBeLessThan(6_000)
  })

  it("drops non-replayable tool exchanges and injects an empty text fallback", async () => {
    const messages: ReplayMessage[] = [
      {
        id: "msg-openai-compile-2",
        role: "assistant",
        parts: [
          {
            type: "tool-exchange",
            tool: {
              toolName: "exa_search",
              replayable: false,
              nonReplayableReason: "Unsupported tool for replay: exa_search",
            },
          },
        ],
      },
    ]

    const result = await compileReplay(messages, "openai", context)
    const assistant = result.messages[0]

    expect(hasToolPart(assistant.parts)).toBe(false)
    expect(assistant.parts).toEqual([{ type: "text", text: "" }])
    expect(
      result.warnings.some((warning) => warning.code === "tool_non_replayable")
    ).toBe(true)
    expect(
      result.warnings.some(
        (warning) => warning.code === "message_empty_fallback"
      )
    ).toBe(true)
    expect(result.stats.toolExchangesCompiled).toBe(0)
    expect(result.stats.toolExchangesDropped).toBe(1)
  })

  it("preserves platform tool continuity when a tool-only message is non-replayable", async () => {
    const messages: ReplayMessage[] = [
      {
        id: "msg-openai-compile-pay-status",
        role: "assistant",
        parts: [
          {
            type: "tool-exchange",
            tool: {
              toolName: "pay_status",
              replayable: false,
              nonReplayableReason:
                'Platform tool "pay_status" is non-replayable (side-effect safety).',
              platformToolContext: {
                toolKey: "pay_status",
                jobId: "job_replay_test_2",
                status: "completed",
                isTerminal: true,
              },
            },
          },
        ],
      },
    ]

    const result = await compileReplay(messages, "openai", context)
    const assistant = result.messages[0]

    expect(hasToolPart(assistant.parts)).toBe(false)
    expect(assistant.parts).toEqual([
      {
        type: "text",
        text: "Replay context: Purchase status check for job job_replay_test_2: completed (completed).",
      },
    ])
    expect(
      result.warnings.some((warning) => warning.code === "tool_non_replayable")
    ).toBe(true)
    expect(
      result.warnings.some(
        (warning) => warning.code === "message_empty_fallback"
      )
    ).toBe(false)
    expect(result.stats.toolExchangesCompiled).toBe(0)
    expect(result.stats.toolExchangesDropped).toBe(1)
  })

  it("drops tool exchanges from non-assistant roles and rewrites tool role to assistant", async () => {
    const messages: ReplayMessage[] = [
      {
        id: "msg-openai-compile-3",
        role: "tool",
        parts: [
          {
            type: "tool-exchange",
            tool: {
              toolName: "web_search",
              replayable: true,
              webSearch: { query: "ignored", results: [] },
            },
          },
        ],
      },
    ]

    const result = await compileReplay(messages, "openai", context)
    const message = result.messages[0]

    expect(message.role).toBe("assistant")
    expect(hasToolPart(message.parts)).toBe(false)
    expect(message.parts).toEqual([{ type: "text", text: "" }])
    expect(
      result.warnings.some(
        (warning) => warning.code === "tool_dropped_invalid_role"
      )
    ).toBe(true)
  })
})
