import { deriveAssistantTurnView } from "./assistant-turn"
import { turnRowModelsEqual, type TurnRowModel } from "./turn-row"
import { describe, expect, it } from "vitest"

describe("turnRowModelsEqual", () => {
  it("compares rendered user attachment and branch facts", () => {
    const base: TurnRowModel = {
      kind: "user",
      id: "user-1",
      text: "hello",
      attachments: [
        { name: "a.txt", contentType: "text/plain", url: "/a" },
      ],
      branch: {
        messageId: "user-1",
        currentIndex: 0,
        total: 2,
        siblings: [{ messageId: "user-1" }, { messageId: "user-2" }],
      },
    }

    expect(turnRowModelsEqual(base, structuredClone(base))).toBe(true)
    expect(
      turnRowModelsEqual(base, {
        ...structuredClone(base),
        attachments: [
          { name: "b.txt", contentType: "text/plain", url: "/a" },
        ],
      })
    ).toBe(false)
    expect(
      turnRowModelsEqual(base, {
        ...structuredClone(base),
        branch: {
          ...base.branch!,
          siblings: [{ messageId: "user-1" }, { messageId: "user-3" }],
        },
      })
    ).toBe(false)
  })

  it("retains the Assistant view's streaming reasoning/source exclusion", () => {
    const first: TurnRowModel = {
      kind: "assistant",
      id: "assistant-1",
      text: "",
      status: "streaming",
      view: deriveAssistantTurnView(
        { parts: [{ type: "reasoning", text: "one" }] as never },
        "streaming"
      ),
    }
    const next: TurnRowModel = {
      ...first,
      view: deriveAssistantTurnView(
        { parts: [{ type: "reasoning", text: "two" }] as never },
        "streaming"
      ),
    }

    expect(turnRowModelsEqual(first, next)).toBe(true)
  })
})
