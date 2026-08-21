import { APICallError } from "ai"
import { describe, expect, it, vi } from "vitest"
import {
  fallbackChatTitle,
  generateChatTitle,
  sanitizeGeneratedChatTitle,
  selectChatTitleModelConfig,
} from "./chat-title"

describe("chat title generation", () => {
  it("removes model labels, quotes, and ending punctuation", () => {
    expect(
      sanitizeGeneratedChatTitle(
        'Title: "Open Source Audio Alternatives."',
        "x"
      )
    ).toBe("Open Source Audio Alternatives")
  })

  it("keeps sidebar titles to four words", () => {
    expect(
      sanitizeGeneratedChatTitle(
        "Reliable Durable AI Chat Message Persistence",
        "x"
      )
    ).toBe("Reliable Durable AI Chat")
  })

  it("uses ChatGPT-like wording for a greeting-only conversation", () => {
    expect(fallbackChatTitle("Hello! ")).toBe("Greeting Exchange")
  })

  it("falls back to a bounded excerpt when the model returns no title", () => {
    // Word cap (4) applies first, then the character cap (32) truncates on a
    // word boundary: "Compare local speech transcription" is 34 characters.
    expect(
      sanitizeGeneratedChatTitle(
        "<think>nothing useful</think>",
        "Compare local speech transcription libraries"
      )
    ).toBe("Compare local speech")
  })

  it("uses a small bounded generation request and reports usage", async () => {
    const generateText = vi.fn(async () => ({
      text: "Streaming Response Optimization",
      usage: { inputTokens: 120, outputTokens: 6 },
    }))
    const model = {} as Parameters<typeof generateChatTitle>[0]["model"]

    await expect(
      generateChatTitle({
        generateText: generateText as unknown as Parameters<
          typeof generateChatTitle
        >[0]["generateText"],
        model,
        modelId: "gpt-5.4-mini",
        userText: "How can I improve response streaming?",
      })
    ).resolves.toEqual({
      title: "Streaming Response Optimization",
      modelId: "gpt-5.4-mini",
      usage: { inputTokens: 120, outputTokens: 6 },
    })

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        maxOutputTokens: 48,
        maxRetries: 1,
        timeout: 8_000,
      })
    )
  })

  it("names the chat with the fallback route when the title route is retired upstream", async () => {
    const titleModel = { id: "retired" } as unknown as Parameters<
      typeof generateChatTitle
    >[0]["model"]
    const answerModel = { id: "answer" } as unknown as Parameters<
      typeof generateChatTitle
    >[0]["model"]
    const retired = new APICallError({
      message: "This model is no longer available to new users.",
      url: "https://generativelanguage.googleapis.com/v1beta/models/x",
      requestBodyValues: {},
      statusCode: 404,
    })
    const generateText = vi.fn(async ({ model }: { model: unknown }) => {
      if (model === titleModel) throw retired
      return {
        text: "Sans-Serif Classics",
        usage: { inputTokens: 90, outputTokens: 4 },
      }
    })

    await expect(
      generateChatTitle({
        generateText: generateText as unknown as Parameters<
          typeof generateChatTitle
        >[0]["generateText"],
        model: titleModel,
        modelId: "gemini-2.5-flash-lite",
        fallback: { model: answerModel, modelId: "gemini-3.1-flash-lite" },
        userText: "Name two classic sans-serif typefaces.",
      })
    ).resolves.toEqual({
      title: "Sans-Serif Classics",
      modelId: "gemini-3.1-flash-lite",
      usage: { inputTokens: 90, outputTokens: 4 },
    })
    expect(generateText).toHaveBeenCalledTimes(2)

    // Anything but a retired route propagates; the fallback is not a retry.
    const unavailable = new APICallError({
      message: "overloaded",
      url: "https://example.test",
      requestBodyValues: {},
      statusCode: 503,
    })
    const failing = vi.fn(async () => {
      throw unavailable
    })
    await expect(
      generateChatTitle({
        generateText: failing as unknown as Parameters<
          typeof generateChatTitle
        >[0]["generateText"],
        model: titleModel,
        modelId: "gemini-2.5-flash-lite",
        fallback: { model: answerModel, modelId: "gemini-3.1-flash-lite" },
        userText: "Name two classic sans-serif typefaces.",
      })
    ).rejects.toBe(unavailable)
    expect(failing).toHaveBeenCalledTimes(1)
  })

  it("prefers a fast inexpensive non-reasoning model from the same provider", () => {
    const selected = {
      id: "flagship",
      providerId: "openai",
      catalogStatus: "visible",
      reasoningText: true,
      speed: "Medium",
      inputCost: 5,
    }
    const titleModel = {
      id: "mini",
      providerId: "openai",
      catalogStatus: "visible",
      reasoningText: false,
      speed: "Fast",
      tags: ["cheap"],
      inputCost: 0.2,
    }
    const otherProvider = {
      ...titleModel,
      id: "other",
      providerId: "anthropic",
    }

    expect(
      selectChatTitleModelConfig(
        [selected, otherProvider, titleModel] as never,
        selected as never
      )
    ).toBe(titleModel)
  })
})
