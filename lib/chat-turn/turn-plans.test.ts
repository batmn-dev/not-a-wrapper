import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { describe, expect, it } from "vitest"
import {
  buildChatTurnRequestBody,
  buildEditRequest,
  buildSelectedPathToken,
  prepareEditTurnPlan,
  prepareRegenerationTurnPlan,
  type ChatTurnMessage,
} from "./turn-plans"

function userMessage(
  id: string,
  text: string,
  createdAt = new Date("2026-01-01T00:00:00.000Z")
): ChatTurnMessage {
  return {
    id,
    role: "user",
    createdAt,
    parts: [{ type: "text", text }],
  }
}

function assistantMessage(
  id: string,
  text: string,
  createdAt = new Date("2026-01-01T00:00:01.000Z")
): ChatTurnMessage {
  return {
    id,
    role: "assistant",
    createdAt,
    parts: [{ type: "text", text }],
  }
}

describe("chat turn plans", () => {
  it("prepares regeneration intent for the targeted latest assistant", () => {
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const messages = [
      userMessage("user-1", "first"),
      assistantMessage("assistant-1", "first answer"),
      userMessage("user-2", "second"),
      assistantMessage("assistant-2", "second answer", targetCreatedAt),
    ]

    const plan = prepareRegenerationTurnPlan(messages, "assistant-2")

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.regeneration).toEqual({
      targetAssistantMessageId: "assistant-2",
      targetAssistantCreatedAt: targetCreatedAt.getTime(),
      expectedChatVersion: 4,
      precedingUserMessageId: "user-2",
    })
    expect(plan.retainedMessages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
      "user-2",
    ])
  })

  it("prepares regeneration after a stopped turn without retaining stale empty placeholders", () => {
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const emptyAssistant: ChatTurnMessage = {
      id: "empty-assistant",
      role: "assistant",
      parts: [],
    }
    const partialAssistant = assistantMessage(
      "partial-assistant",
      "partial answer"
    )
    const targetAssistant = assistantMessage(
      "assistant-2",
      "second answer",
      targetCreatedAt
    )
    const messages = [
      userMessage("user-1", "first"),
      partialAssistant,
      emptyAssistant,
      userMessage("user-2", "second"),
      targetAssistant,
    ]
    const plan = prepareRegenerationTurnPlan(messages, "assistant-2")

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.originalMessages.map((message) => message.id)).toEqual([
      "user-1",
      "partial-assistant",
      "user-2",
      "assistant-2",
    ])
    expect(plan.retainedMessages.map((message) => message.id)).toEqual([
      "user-1",
      "partial-assistant",
      "user-2",
    ])
    expect(plan.regeneration.expectedChatVersion).toBe(4)
  })

  it("prepares edit truncation after stopped or regenerated turns without stale empty placeholders", () => {
    const emptyAssistant: ChatTurnMessage = {
      id: "empty-assistant",
      role: "assistant",
      parts: [],
    }
    const partialAssistant = assistantMessage(
      "partial-assistant",
      "partial answer"
    )
    const regeneratedAssistant = assistantMessage(
      "assistant-2",
      "regenerated answer"
    )
    const messages = [
      userMessage("user-1", "first"),
      partialAssistant,
      emptyAssistant,
      userMessage("user-2", "second"),
      regeneratedAssistant,
    ]

    const plan = prepareEditTurnPlan({
      messages,
      messageId: "user-2",
      newContent: "edited second",
      createOptimisticEditMessageId: () => "optimistic-edit",
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.originalMessages.map((message) => message.id)).toEqual([
      "user-1",
      "partial-assistant",
      "user-2",
      "assistant-2",
    ])
    expect(plan.trimmedMessages.map((message) => message.id)).toEqual([
      "user-1",
      "partial-assistant",
    ])
    expect(plan.expectedChatVersion).toBe(4)
    expect(plan.chatVersion).toBe(3)
  })

  it("builds edit intents for AI SDK client message IDs", () => {
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const clientMessageId = "msg-client-123"
    const plan = prepareEditTurnPlan({
      messages: [
        userMessage(clientMessageId, "old text", targetCreatedAt),
        assistantMessage("assistant-1", "old answer"),
      ],
      messageId: clientMessageId,
      newContent: "new text",
      createOptimisticEditMessageId: () => "optimistic-edit",
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.trimmedMessages).toEqual([])
    expect(plan.cutoffTimestamp).toBe(targetCreatedAt.getTime())
    expect(plan.optimisticEditedMessage).toMatchObject({
      id: "optimistic-edit",
      role: "user",
      parts: [{ type: "text", text: "new text" }],
    })
    expect(buildEditRequest(clientMessageId, plan)).toMatchObject({
      editedMessageId: clientMessageId,
      editCutoffTimestamp: targetCreatedAt.getTime(),
      replacementMessage: {
        id: "optimistic-edit",
        role: "user",
        content: "new text",
        parts: [{ type: "text", text: "new text" }],
      },
    })
  })

  it("rejects invalid regeneration targets", () => {
    expect(
      prepareRegenerationTurnPlan([userMessage("user-1", "prompt")], "user-1")
    ).toEqual({ ok: false, reason: "invalid-target-role" })

    expect(
      prepareRegenerationTurnPlan(
        [
          userMessage("user-1", "prompt"),
          {
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "answer" }],
          },
        ],
        "assistant-1"
      )
    ).toEqual({ ok: false, reason: "missing-message-timestamp" })

    expect(
      prepareRegenerationTurnPlan(
        [assistantMessage("assistant-1", "answer")],
        "assistant-1"
      )
    ).toEqual({ ok: false, reason: "missing-preceding-user" })
  })

  it("accepts a non-tail assistant regeneration target", () => {
    const plan = prepareRegenerationTurnPlan(
      [
        userMessage("user-1", "first"),
        assistantMessage("assistant-1", "first answer"),
        userMessage("user-2", "second"),
        assistantMessage("assistant-2", "second answer"),
      ],
      "assistant-1"
    )

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.retainedMessages.map((message) => message.id)).toEqual([
      "user-1",
    ])
    expect(plan.regeneration).toMatchObject({
      targetAssistantMessageId: "assistant-1",
      precedingUserMessageId: "user-1",
      expectedChatVersion: 4,
    })
  })

  it("builds consistent request bodies for send, edit, and regeneration turns", () => {
    const base = {
      chatId: "chat-1",
      userId: "user-1",
      selectedModel: "model-1",
    }

    expect(
      buildChatTurnRequestBody({
        ...base,
        systemPrompt: "custom system",
        enableSearch: false,
        chatVersion: 2,
        selectedPathToken: {
          expectedVisibleMessageCount: 2,
          tailMessageId: "message_assistant_1",
        },
      })
    ).toEqual({
      chatId: "chat-1",
      userId: "user-1",
      model: "model-1",
      systemPrompt: "custom system",
      enableSearch: false,
      chatVersion: 2,
      expectedVisibleMessageCount: 2,
      tailMessageId: "message_assistant_1",
    })

    expect(
      buildChatTurnRequestBody({
        ...base,
        chatVersion: 1,
      })
    ).toEqual({
      chatId: "chat-1",
      userId: "user-1",
      model: "model-1",
      systemPrompt: SYSTEM_PROMPT_DEFAULT,
      chatVersion: 1,
    })

    const regeneration = {
      targetAssistantMessageId: "assistant-1",
      targetAssistantCreatedAt: 1700000000000,
      expectedChatVersion: 2,
      precedingUserMessageId: "user-1",
    }
    expect(
      buildChatTurnRequestBody({
        ...base,
        chatVersion: 2,
        regeneration,
      })
    ).toEqual({
      chatId: "chat-1",
      userId: "user-1",
      model: "model-1",
      systemPrompt: SYSTEM_PROMPT_DEFAULT,
      chatVersion: 2,
      regeneration,
    })
  })

  it("builds selected-path tokens from visible durable server message ids", () => {
    expect(
      buildSelectedPathToken([
        {
          ...userMessage("client-user-1", "prompt"),
          metadata: { serverMessageId: "message_user_1" },
        },
        {
          ...assistantMessage("client-assistant-1", "answer"),
          metadata: { serverMessageId: "message_assistant_1" },
        },
      ])
    ).toEqual({
      expectedVisibleMessageCount: 2,
      tailMessageId: "message_assistant_1",
    })

    expect(buildSelectedPathToken([])).toEqual({
      expectedVisibleMessageCount: 0,
    })
  })

  it("reads the selected-path token tail through the typed serverMessageId accessor", () => {
    // Guards the readServerMessageId contract the token now depends on:
    // an empty or non-string serverMessageId must yield no tail anchor.
    expect(
      buildSelectedPathToken([
        {
          ...assistantMessage("client-assistant-1", "answer"),
          metadata: { serverMessageId: "" },
        },
      ])
    ).toEqual({ expectedVisibleMessageCount: 1 })

    expect(
      buildSelectedPathToken([
        {
          ...assistantMessage("client-assistant-1", "answer"),
          metadata: { serverMessageId: 123 as unknown as string },
        },
      ])
    ).toEqual({ expectedVisibleMessageCount: 1 })
  })
})
