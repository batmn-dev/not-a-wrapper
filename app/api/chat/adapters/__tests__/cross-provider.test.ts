import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { adaptHistoryForProvider } from "../index"
import {
  crossProviderMetadata,
  mixedProviderAndSdkTools,
  multiStepToolChain,
  reasoningPlusText,
  singleProviderExecutedTool,
  singleSdkToolComplete,
  textOnlyAssistant,
  userMessage,
} from "./fixtures"

function hasPartType(messages: UIMessage[], type: string): boolean {
  return messages.some((message) =>
    message.parts.some((part) => part.type === type)
  )
}

function getAssistantMessages(messages: UIMessage[]): UIMessage[] {
  return messages.filter((message) => message.role === "assistant")
}

function assertNoCallProviderMetadata(messages: UIMessage[]): void {
  for (const message of messages) {
    for (const part of message.parts as Array<Record<string, unknown>>) {
      expect("callProviderMetadata" in part).toBe(false)
    }
  }
}

function assertOpenAIAtomicToolStructure(messages: UIMessage[]): void {
  for (const message of getAssistantMessages(messages)) {
    for (let index = 0; index < message.parts.length; index += 1) {
      const part = message.parts[index]
      if (!part) continue

      if (!(part.type.startsWith("tool-") || part.type === "dynamic-tool")) {
        continue
      }

      expect(
        message.parts
          .slice(0, index)
          .some((candidate) => candidate.type === "reasoning")
      ).toBe(true)
    }
  }
}

function assertAlternatingRoles(messages: UIMessage[]): void {
  for (let index = 1; index < messages.length; index += 1) {
    expect(messages[index]?.role).not.toBe(messages[index - 1]?.role)
  }
}

describe("cross-provider replay matrix", () => {
  describe("OpenAI -> Anthropic", () => {
    const provider = "anthropic"
    const context = { targetModelId: "claude-4-opus", hasTools: true }

    it("regression: handles OpenAI action/sources web_search replay without compile fallback", async () => {
      const regressionHistory: UIMessage[] = [
        userMessage(
          "reg-openai-anthropic-user-1",
          "Find Batman products on Amazon"
        ),
        {
          id: "reg-openai-anthropic-assistant-1",
          role: "assistant",
          parts: [
            { type: "step-start" },
            {
              type: "reasoning",
              reasoning: "I will check Amazon listings.",
              state: "done",
            },
            {
              type: "tool-web_search",
              state: "output-available",
              toolCallId: "reg_tc_openai_to_anthropic_1",
              toolName: "web_search",
              providerExecuted: true,
              input: { query: "Batman products Amazon official links" },
              output: {
                action: "search",
                sources: [
                  {
                    url: "https://www.amazon.com/s?k=batman+products",
                    title: "Amazon Batman search",
                    snippet: "Batman products and listings.",
                  },
                ],
              },
              callProviderMetadata: {
                openai: {
                  responseId: "msg_reg_openai_1",
                  reasoningId: "rs_reg_openai_1",
                },
              },
            },
            { type: "text", text: "I found Amazon links and product context." },
          ],
        } as UIMessage,
        userMessage(
          "reg-openai-anthropic-user-2",
          "Why were links missing before?"
        ),
      ]

      const result = await adaptHistoryForProvider(
        regressionHistory,
        provider,
        context,
        {
          useReplayCompiler: true,
        }
      )
      const assistant = result.messages.find(
        (message) => message.role === "assistant"
      )
      const hasCompiledWebSearch = Boolean(
        assistant?.parts.some((part) => part.type === "tool-web_search")
      )
      const continuityTextKept = Boolean(
        assistant?.parts.some(
          (part) =>
            part.type === "text" &&
            typeof (part as { text?: unknown }).text === "string" &&
            (part as { text: string }).text.includes("Amazon links")
        )
      )
      const replayDropWarning = result.warnings.some(
        (warning) =>
          warning.code === "replay_compile_warning" &&
          warning.detail.includes("invariant_block_dropped")
      )

      expect(
        result.warnings.some(
          (warning) => warning.code === "replay_compile_fallback"
        )
      ).toBe(false)
      expect(hasCompiledWebSearch).toBe(false)
      expect(replayDropWarning).toBe(true)
      expect(continuityTextKept).toBe(true)
      expect(
        assistant?.parts.some(
          (part) =>
            part.type === "text" &&
            typeof (part as { text?: unknown }).text === "string" &&
            (part as { text: string }).text.includes(
              "Replay context from prior web_search"
            )
        )
      ).toBe(true)
    })

    it("converts incompatible web_search replay into text and strips cross-provider metadata", async () => {
      const result = await adaptHistoryForProvider(
        [singleProviderExecutedTool],
        provider,
        context
      )
      expect(hasPartType(result.messages, "tool-web_search")).toBe(false)
      expect(hasPartType(result.messages, "text")).toBe(true)
      assertNoCallProviderMetadata(result.messages)
      expect(result.stats.providerIdsStripped).toBeGreaterThan(0)
    })

    it("keeps reasoning + tool chains", async () => {
      const result = await adaptHistoryForProvider(
        [multiStepToolChain],
        provider,
        context
      )
      expect(hasPartType(result.messages, "reasoning")).toBe(true)
      expect(hasPartType(result.messages, "tool-web_search")).toBe(false)
      expect(hasPartType(result.messages, "tool-exa_search")).toBe(true)
    })

    it("keeps provider-executed and SDK-executed tools", async () => {
      const result = await adaptHistoryForProvider(
        [mixedProviderAndSdkTools],
        provider,
        context
      )
      const parts = result.messages[0]?.parts ?? []
      expect(
        parts.some(
          (part) =>
            (part as { providerExecuted?: boolean }).providerExecuted === false
        )
      ).toBe(true)
      expect(parts.some((part) => part.type === "text")).toBe(true)
    })
  })

  describe("Anthropic -> OpenAI", () => {
    const provider = "openai"
    const context = { targetModelId: "gpt-5.2", hasTools: true }

    it("enforces atomic triples for tool calls", async () => {
      const result = await adaptHistoryForProvider(
        [singleSdkToolComplete],
        provider,
        context
      )
      expect(hasPartType(result.messages, "tool-exa_search")).toBe(true)
      assertOpenAIAtomicToolStructure(result.messages)
    })

    it("enforces atomic triples for reasoning + tool chains", async () => {
      const result = await adaptHistoryForProvider(
        [multiStepToolChain],
        provider,
        context
      )
      expect(hasPartType(result.messages, "reasoning")).toBe(true)
      expect(hasPartType(result.messages, "tool-web_search")).toBe(true)
      assertOpenAIAtomicToolStructure(result.messages)
    })

    it("strips callProviderMetadata from replayed tool parts", async () => {
      const result = await adaptHistoryForProvider(
        [crossProviderMetadata],
        provider,
        context
      )
      assertNoCallProviderMetadata(result.messages)
      expect(result.stats.providerIdsStripped).toBeGreaterThan(0)
    })

    it("handles provider-executed and SDK-executed tools without breaking triples", async () => {
      const result = await adaptHistoryForProvider(
        [mixedProviderAndSdkTools],
        provider,
        context
      )
      assertOpenAIAtomicToolStructure(result.messages)
      assertNoCallProviderMetadata(result.messages)
    })
  })

  describe("OpenAI -> OpenAI", () => {
    const provider = "openai"
    const context = { targetModelId: "gpt-5.2", hasTools: true }

    it("preserves reasoning + tool content while enforcing OpenAI replay shape", async () => {
      const history = [singleProviderExecutedTool, singleSdkToolComplete]
      const result = await adaptHistoryForProvider(history, provider, context)
      expect(hasPartType(result.messages, "reasoning")).toBe(true)
      assertOpenAIAtomicToolStructure(result.messages)
      assertNoCallProviderMetadata(result.messages)
    })
  })

  describe("Anthropic -> Google", () => {
    const provider = "google"
    const context = { targetModelId: "gemini-3-pro", hasTools: true }

    it("preserves reasoning as native-thought candidate content", async () => {
      const result = await adaptHistoryForProvider(
        [reasoningPlusText],
        provider,
        context
      )
      expect(hasPartType(result.messages, "reasoning")).toBe(true)
    })

    it("preserves reasoning + tool chains and validates role alternation", async () => {
      const roleBreakHistory = [
        userMessage("u-google-1", "first user"),
        userMessage("u-google-2", "second user"),
        multiStepToolChain,
      ]
      const result = await adaptHistoryForProvider(
        roleBreakHistory,
        provider,
        context
      )
      expect(hasPartType(result.messages, "reasoning")).toBe(true)
      assertAlternatingRoles(result.messages)
      expect(
        result.warnings.some(
          (warning) => warning.code === "role_alternation_repaired"
        )
      ).toBe(true)
    })

    it("injects Gemini 3 thought signatures for tool invocations", async () => {
      const result = await adaptHistoryForProvider(
        [singleSdkToolComplete],
        provider,
        context
      )
      const toolParts = getAssistantMessages(result.messages)
        .flatMap((message) => message.parts)
        .filter(
          (part) => part.type.startsWith("tool-") && part.type !== "tool-result"
        )
      expect(toolParts.length).toBeGreaterThan(0)

      for (const part of toolParts as Array<{
        providerMetadata?: { google?: { thoughtSignature?: string } }
      }>) {
        expect(part.providerMetadata?.google?.thoughtSignature).toBe(
          "skip_thought_signature_validator"
        )
      }
    })
  })

  describe("Perplexity target", () => {
    it("produces text-only output", async () => {
      const result = await adaptHistoryForProvider(
        [singleProviderExecutedTool, singleSdkToolComplete, reasoningPlusText],
        "perplexity",
        { targetModelId: "sonar-pro", hasTools: true }
      )

      for (const message of result.messages) {
        expect(message.parts.every((part) => part.type === "text")).toBe(true)
      }
      expect(hasPartType(result.messages, "reasoning")).toBe(false)
      expect(hasPartType(result.messages, "tool-web_search")).toBe(false)
      expect(hasPartType(result.messages, "tool-exa_search")).toBe(false)
    })
  })

  describe("OpenRouter routing", () => {
    it("routes openrouter:anthropic/* models to AnthropicAdapter behavior", async () => {
      const messages = [reasoningPlusText]
      const direct = await adaptHistoryForProvider(messages, "anthropic", {
        targetModelId: "claude-4-opus",
        hasTools: true,
      })
      const throughOpenRouter = await adaptHistoryForProvider(
        messages,
        "openrouter",
        {
          targetModelId: "openrouter:anthropic/claude-4-opus",
          hasTools: true,
        }
      )

      expect(throughOpenRouter.messages).toEqual(direct.messages)
      expect(hasPartType(throughOpenRouter.messages, "reasoning")).toBe(true)
    })

    it("routes unknown org models to DefaultAdapter behavior", async () => {
      const messages = [reasoningPlusText, textOnlyAssistant]
      const direct = await adaptHistoryForProvider(
        messages,
        "unknown-provider",
        {
          targetModelId: "unknown-org/mystery-model",
          hasTools: true,
        }
      )
      const throughOpenRouter = await adaptHistoryForProvider(
        messages,
        "openrouter",
        {
          targetModelId: "unknown-org/mystery-model",
          hasTools: true,
        }
      )

      expect(throughOpenRouter.messages).toEqual(direct.messages)
      expect(hasPartType(throughOpenRouter.messages, "reasoning")).toBe(false)
      expect(
        getAssistantMessages(throughOpenRouter.messages).every((message) =>
          hasPartType([message], "text")
        )
      ).toBe(true)
    })
  })
})
