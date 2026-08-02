import { safeValidateUIMessages } from "ai"
import { describe, expect, it } from "vitest"
import { anthropicReplayCompiler } from "../compilers/anthropic"
import type { ReplayMessage } from "../types"

const context = {
  targetModelId: "claude-4.5-sonnet",
  hasTools: true,
}

function webSearchMessage(options: {
  replayable: boolean
  encryptedContent?: string
  resultType?: "web_search_result"
}): ReplayMessage {
  return {
    id: "search",
    role: "assistant",
    parts: [
      { type: "text", text: "Let me check." },
      {
        type: "tool-exchange",
        tool: {
          toolName: "web_search",
          toolCallId: "provider-linked-id",
          state: "output-available",
          replayable: options.replayable,
          nonReplayableReason: options.replayable
            ? undefined
            : "Unsupported web_search output shape.",
          webSearch: {
            query: "Batman figures",
            rawShape: options.replayable ? "array-anthropic-native" : "unknown",
            providerOrigin: "anthropic",
            results: options.replayable
              ? [
                  {
                    url: "https://example.com/figure",
                    title: "Figure Listing",
                    snippet: "Popular Batman item",
                    pageAge: "1d",
                    encryptedContent: options.encryptedContent,
                    resultType: options.resultType,
                  },
                ]
              : [],
          },
        },
      },
    ],
  }
}

describe("anthropicReplayCompiler", () => {
  it("lowers native-looking web_search to text without opaque payloads or ids", async () => {
    const result = await anthropicReplayCompiler.compileReplay(
      [
        webSearchMessage({
          replayable: true,
          encryptedContent: "OPAQUE_ENCRYPTED_SENTINEL",
          resultType: "web_search_result",
        }),
      ],
      context
    )

    expect(result.messages[0]?.parts).toEqual([
      { type: "text", text: "Let me check." },
      {
        type: "text",
        text: 'Replay context from prior web_search for "Batman figures":\n- Figure Listing (https://example.com/figure) - Popular Batman item',
      },
    ])
    const serialized = JSON.stringify(result.messages)
    expect(serialized).not.toContain("tool-web_search")
    expect(serialized).not.toContain("provider-linked-id")
    expect(serialized).not.toContain("OPAQUE_ENCRYPTED_SENTINEL")
    expect(
      result.warnings.some((warning) => warning.code === "tool_lowered_to_text")
    ).toBe(true)
    expect(result.stats.toolExchangesCompiled).toBe(1)
    expect(result.stats.toolExchangesDropped).toBe(0)
  })

  it("projects unknown-shape web_search to a safe continuity note", async () => {
    const result = await anthropicReplayCompiler.compileReplay(
      [webSearchMessage({ replayable: false })],
      context
    )

    expect(result.messages[0]?.parts).toEqual([
      { type: "text", text: "Let me check." },
      {
        type: "text",
        text: 'Replay note: web_search for "Batman figures" was omitted for Anthropic-safe replay.',
      },
    ])
    expect(
      result.warnings.some((warning) => warning.code === "tool_lowered_to_text")
    ).toBe(true)
  })

  it("preserves multimodal files and projects source URLs to citation text", async () => {
    const messages: ReplayMessage[] = [
      {
        id: "multimodal",
        role: "user",
        parts: [
          { type: "text", text: "inspect" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "image.png",
            url: "https://example.com/image.png",
          },
          {
            type: "source-url",
            sourceId: "private-source-id",
            url: "https://example.com/source",
            title: "Source",
          },
        ],
      },
    ]

    const result = await anthropicReplayCompiler.compileReplay(
      messages,
      context
    )
    expect(result.messages[0]?.parts).toEqual([
      { type: "text", text: "inspect" },
      {
        type: "file",
        mediaType: "image/png",
        filename: "image.png",
        url: "https://example.com/image.png",
      },
      {
        type: "text",
        text: "[Earlier cited source: Source (https://example.com/source)]",
      },
    ])
    expect(JSON.stringify(result.messages)).not.toContain("private-source-id")
  })

  it("lowers incomplete legacy files to replay notes", async () => {
    const messages: ReplayMessage[] = [
      {
        id: "missing-url",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            filename: "legacy-image.png",
          },
        ],
      },
      {
        id: "missing-media-type",
        role: "user",
        parts: [
          {
            type: "file",
            url: "https://example.com/legacy-file.pdf",
          },
        ],
      },
    ]

    const result = await anthropicReplayCompiler.compileReplay(
      messages,
      context
    )

    expect(result.messages.map((message) => message.parts)).toEqual([
      [
        {
          type: "text",
          text: "Replay note: legacy-image.png was present in prior context.",
        },
      ],
      [
        {
          type: "text",
          text: "Replay note: attached file was present in prior context.",
        },
      ],
    ])
    expect(result.stats.invariantsRepaired).toBe(2)
    await expect(
      safeValidateUIMessages({ messages: result.messages })
    ).resolves.toMatchObject({ success: true })
  })
})
