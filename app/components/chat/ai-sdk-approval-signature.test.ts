import { Chat, type UIMessage } from "@ai-sdk/react"
import { describe, expect, it } from "vitest"

describe("AI SDK approval signature transition", () => {
  it("preserves the approval request signature when the user responds", async () => {
    const signature = "signed-approval-payload"
    const chat = new Chat<UIMessage>({
      messages: [
        {
          id: "assistant-message",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "testTool",
              toolCallId: "tool-call",
              state: "approval-requested",
              input: { value: "original" },
              approval: {
                id: "approval-request",
                signature,
              },
            },
          ],
        },
      ],
    })

    await chat.addToolApprovalResponse({
      id: "approval-request",
      approved: true,
      reason: "Approved",
    })

    expect(chat.messages[0]?.parts[0]).toMatchObject({
      state: "approval-responded",
      approval: {
        id: "approval-request",
        approved: true,
        reason: "Approved",
        signature,
      },
    })
  })
})
