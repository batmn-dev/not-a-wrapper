import { describe, expect, it } from "vitest"
import type { ExtendedUIMessage } from "@/lib/chat-store/messages/api"
import { getMessageText } from "./use-chat-preview"

describe("getMessageText", () => {
  it("uses text parts before legacy content", () => {
    expect(
      getMessageText({
        id: "message-1",
        role: "assistant",
        content: "stale legacy content",
        parts: [{ type: "text", text: "stored parts content" }],
      } as ExtendedUIMessage)
    ).toBe("stored parts content")
  })

  it("falls back to legacy content when parts have no text", () => {
    expect(
      getMessageText({
        id: "message-2",
        role: "assistant",
        content: "legacy content",
        parts: [],
      } as ExtendedUIMessage)
    ).toBe("legacy content")
  })
})
