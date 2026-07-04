import { describe, expect, it } from "vitest"
import {
  isTerminalOutcomeStub,
  isVisibleChatMessage,
  projectModelHistoryMessages,
} from "./message_visibility"

const user = {
  role: "user",
  content: "q",
  parts: [{ type: "text", text: "q" }],
}
const answered = {
  role: "assistant",
  content: "a",
  parts: [{ type: "text", text: "a" }],
  status: "completed",
}

function emptyAssistant(status: string) {
  return { role: "assistant", content: "", parts: [], status }
}

describe("terminal outcome stubs", () => {
  it("empty assistants are visible only with a terminal failed/aborted outcome", () => {
    expect(isVisibleChatMessage(emptyAssistant("failed"))).toBe(true)
    expect(isVisibleChatMessage(emptyAssistant("aborted"))).toBe(true)
    // In-flight placeholders stay hidden — a live turn's empty message is not
    // an outcome, and durable streaming is never trusted for liveness.
    expect(isVisibleChatMessage(emptyAssistant("streaming"))).toBe(false)
    expect(isVisibleChatMessage(emptyAssistant("submitted"))).toBe(false)
    expect(isTerminalOutcomeStub(answered)).toBe(false)
  })

  it("projects stubs into model history as explicit never-answered markers", () => {
    const history = projectModelHistoryMessages([
      user,
      emptyAssistant("failed"),
      user,
      emptyAssistant("aborted"),
      user,
      emptyAssistant("streaming"),
      answered,
    ])

    expect(history.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ])
    expect(history[1].parts).toEqual([
      {
        type: "text",
        text: "[This response failed with an error before producing content.]",
      },
    ])
    expect(history[3].parts).toEqual([
      {
        type: "text",
        text: "[This response was stopped before producing content.]",
      },
    ])
    // The in-flight empty placeholder is dropped, not marker-ized.
    expect(history[5]).toMatchObject({ content: "a" })
  })
})
