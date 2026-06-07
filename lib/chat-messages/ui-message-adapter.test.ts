import { describe, expect, it } from "vitest"
import { durableStoredMessageToUiMessage } from "./ui-message-adapter"

describe("durableStoredMessageToUiMessage", () => {
  it("maps a basic user message and preserves the client message id", () => {
    expect(
      durableStoredMessageToUiMessage({
        _id: "convex_message_1",
        clientMessageId: "client_message_1",
        role: "user",
        content: "hello",
        parts: [],
        status: "completed",
        createdAt: 100,
      })
    ).toEqual({
      id: "client_message_1",
      role: "user",
      content: "hello",
      createdAt: new Date(100),
      parts: [{ type: "text", text: "hello" }],
      status: "completed",
      metadata: {
        durableStatus: "completed",
      },
    })
  })

  it("maps an assistant message with stored text parts", () => {
    const parts = [{ type: "text" as const, text: "partial output" }]

    expect(
      durableStoredMessageToUiMessage({
        _id: "message_2",
        role: "assistant",
        content: "partial output",
        parts,
        status: "streaming",
      })
    ).toMatchObject({
      id: "message_2",
      role: "assistant",
      content: "partial output",
      parts,
      status: "streaming",
      metadata: {
        durableStatus: "streaming",
      },
    })
  })

  it("preserves legacy attachments as displayable file parts", () => {
    expect(
      durableStoredMessageToUiMessage({
        _id: "message_3",
        role: "user",
        content: "",
        parts: [],
        attachments: [
          {
            name: "receipt.pdf",
            contentType: "application/pdf",
            url: "https://example.com/receipt.pdf",
          },
        ],
        status: "completed",
      }).parts
    ).toEqual([
      {
        type: "file",
        filename: "receipt.pdf",
        mediaType: "application/pdf",
        url: "https://example.com/receipt.pdf",
      },
    ])
  })

  it("can preserve stored parts exactly for API runtime model history", () => {
    expect(
      durableStoredMessageToUiMessage(
        {
          _id: "message_runtime",
          role: "assistant",
          content: "legacy content",
          parts: [],
          attachments: [
            {
              name: "receipt.pdf",
              contentType: "application/pdf",
              url: "https://example.com/receipt.pdf",
            },
          ],
          status: "completed",
          error: undefined,
          generationRunId: "run_1",
        },
        { partsMode: "stored", metadataMode: "runtime" }
      )
    ).toMatchObject({
      id: "message_runtime",
      content: "legacy content",
      parts: [],
      metadata: {
        durableStatus: "completed",
      },
    })
  })

  it("merges stored metadata with durable runtime metadata", () => {
    expect(
      durableStoredMessageToUiMessage({
        _id: "message_4",
        role: "assistant",
        content: "done",
        parts: [{ type: "text", text: "done" }],
        status: "failed",
        metadata: { custom: "value", durableStatus: "legacy" },
        error: "provider failed",
        generationRunId: "run_1",
        requestId: "request_1",
        model: "gpt-5",
        provider: "openai",
        finishReason: "error",
        usage: { inputTokens: 1, outputTokens: 2 },
      }).metadata
    ).toEqual({
      custom: "value",
      durableStatus: "failed",
      durableError: "provider failed",
      generationRunId: "run_1",
      requestId: "request_1",
      model: "gpt-5",
      provider: "openai",
      finishReason: "error",
      usage: { inputTokens: 1, outputTokens: 2 },
    })
  })

  it("keeps legacy data role renderable as a system UI message", () => {
    expect(
      durableStoredMessageToUiMessage({
        _id: "message_5",
        role: "data",
        content: "system data",
        parts: [],
        status: "completed",
      }).role
    ).toBe("system")
  })

  it("tolerates malformed or partial legacy rows", () => {
    expect(
      durableStoredMessageToUiMessage({
        _id: "message_6",
        role: "unexpected",
        parts: [{ type: "text", text: "from parts" }],
        status: "unknown",
        metadata: ["not", "an", "object"],
      })
    ).toEqual({
      id: "message_6",
      role: "system",
      content: "from parts",
      parts: [{ type: "text", text: "from parts" }],
      metadata: {
        durableStatus: "unknown",
      },
    })
  })
})
