import { describe, expect, it } from "vitest"
import { compileReplay } from "../compilers"
import type { ReplayMessage } from "../types"

const context = {
  targetModelId: "gpt-5.2",
  hasTools: true,
}

function hasToolPart(parts: Array<{ type: string }>): boolean {
  return parts.some((part) => part.type.startsWith("tool-") || part.type === "dynamic-tool")
}

describe("openai replay compiler", () => {
  it("injects reasoning before replayed tool blocks and keeps final tool output", async () => {
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
    const toolIndex = assistant.parts.findIndex(
      (part) => part.type.startsWith("tool-") || part.type === "dynamic-tool",
    )
    const toolPart = assistant.parts[toolIndex] as { state?: string; output?: unknown }

    expect(toolIndex).toBeGreaterThan(0)
    expect(
      assistant.parts.slice(0, toolIndex).some((part) => part.type === "reasoning"),
    ).toBe(true)
    expect(toolPart.state).toBe("output-available")
    expect(toolPart.output).toBeDefined()
    expect(result.stats.toolExchangesSeen).toBe(1)
    expect(result.stats.toolExchangesCompiled).toBe(1)
    expect(result.stats.toolExchangesDropped).toBe(0)
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
    expect(result.warnings.some((warning) => warning.code === "tool_non_replayable")).toBe(true)
    expect(result.warnings.some((warning) => warning.code === "message_empty_fallback")).toBe(true)
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
    expect(result.warnings.some((warning) => warning.code === "tool_non_replayable")).toBe(true)
    expect(result.warnings.some((warning) => warning.code === "message_empty_fallback")).toBe(false)
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
    expect(result.warnings.some((warning) => warning.code === "tool_dropped_invalid_role")).toBe(true)
  })
})
