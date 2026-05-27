import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import {
  extractApprovalResponses,
  getFinalAssistantText,
  getLatestUserMessage,
  isDurableConvexChat,
  toDurableUiMessage,
} from "./durable-runtime"

describe("durable chat runtime helpers", () => {
  it("only enables Convex durability for authenticated Convex chats", () => {
    expect(
      isDurableConvexChat({
        isAuthenticated: true,
        convexToken: "token",
        chatId: "chat_123",
      })
    ).toBe(true)
    expect(
      isDurableConvexChat({
        isAuthenticated: true,
        convexToken: "token",
        chatId: "local-123",
      })
    ).toBe(false)
    expect(
      isDurableConvexChat({
        isAuthenticated: false,
        convexToken: "token",
        chatId: "chat_123",
      })
    ).toBe(false)
  })

  it("uses the latest user message instead of trusting full client history", () => {
    const messages = [
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "old" }] },
      { id: "u1", role: "user", parts: [{ type: "text", text: "first" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "latest" }] },
    ] as UIMessage[]

    expect(getLatestUserMessage(messages)?.id).toBe("u2")
  })

  it("preserves approval responses for the next server turn", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-send_email",
            toolCallId: "call-1",
            state: "approval-responded",
            input: { to: "person@example.com" },
            approval: {
              id: "approval-1",
              approved: false,
              reason: "Denied by user",
            },
          },
        ],
      },
    ] as unknown as UIMessage[]

    expect(extractApprovalResponses(messages)).toEqual([
      {
        messageId: "assistant-1",
        approvalId: "approval-1",
        toolCallId: "call-1",
        toolName: "send_email",
        approved: false,
        reason: "Denied by user",
      },
    ])
  })

  it("maps streaming Convex messages into nonblank UI messages", () => {
    const message = toDurableUiMessage({
      _id: "msg_1",
      _creationTime: 100,
      chatId: "chat_1",
      orderId: 0,
      role: "assistant",
      content: "partial output",
      parts: [{ type: "text", text: "partial output" }],
      status: "aborted",
      createdAt: 100,
      updatedAt: 200,
    } as Parameters<typeof toDurableUiMessage>[0])

    expect(message.id).toBe("msg_1")
    expect(message.status).toBe("aborted")
    expect(getFinalAssistantText(message)).toBe("partial output")
    expect(message.metadata?.durableStatus).toBe("aborted")
  })

  it("validates UI messages before converting them to model messages", () => {
    const routeSource = readFileSync(
      join(process.cwd(), "app/api/chat/route.ts"),
      "utf8"
    )

    const validateCallIndex = routeSource.indexOf(
      "const validatedMessages = await validateUIMessages"
    )
    const convertCallIndex = routeSource.indexOf(
      "let modelMessages: ModelMessage[] = await convertToModelMessages"
    )

    expect(validateCallIndex).toBeGreaterThan(-1)
    expect(convertCallIndex).toBeGreaterThan(-1)
    expect(validateCallIndex).toBeLessThan(
      convertCallIndex
    )
  })
})
