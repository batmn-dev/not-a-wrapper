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
        parts: [{ type: "text", text: "hello" }],
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
        serverMessageId: "convex_message_1",
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
        createdAt: 200,
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

  it("can preserve stored parts exactly for API runtime model history", () => {
    expect(
      durableStoredMessageToUiMessage(
        {
          _id: "message_runtime",
          role: "assistant",
          content: "stored content",
          parts: [],
          status: "completed",
          createdAt: 300,
          error: undefined,
          generationRunId: "run_1",
        },
        { metadataMode: "runtime" }
      )
    ).toMatchObject({
      id: "message_runtime",
      content: "stored content",
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
        createdAt: 400,
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
      serverMessageId: "message_4",
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

  it("normalizes a well-formed server branch descriptor onto metadata", () => {
    expect(
      durableStoredMessageToUiMessage({
        _id: "message_branch",
        role: "assistant",
        content: "answer",
        parts: [{ type: "text", text: "answer" }],
        status: "completed",
        createdAt: 500,
        metadata: {
          branch: {
            messageId: "message_branch",
            currentIndex: 1,
            total: 2,
            siblings: [
              { messageId: "message_branch_a" },
              { messageId: "message_branch" },
            ],
          },
        },
      }).metadata
    ).toMatchObject({
      serverMessageId: "message_branch",
      branch: {
        messageId: "message_branch",
        currentIndex: 1,
        total: 2,
      },
    })
  })

  it("drops a malformed branch descriptor instead of forwarding it", () => {
    const metadata = durableStoredMessageToUiMessage({
      _id: "message_bad_branch",
      role: "assistant",
      content: "answer",
      parts: [{ type: "text", text: "answer" }],
      status: "completed",
      createdAt: 600,
      metadata: { branch: { messageId: "", total: "two" } },
    }).metadata
    expect(metadata?.branch).toBeUndefined()
  })
})
