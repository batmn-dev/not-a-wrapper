import type { Doc } from "@/convex/_generated/dataModel"
import { describe, expect, it } from "vitest"
import type { Chats } from "../types"
import { pickChat, resolveGetByIdArgs } from "./use-chat"

// A Convex id: length > 20 and no "-" (see isConvexId). Guest/local ids are
// short and/or contain dashes.
const CONVEX_ID = "abcdefghijklmnopqrstuvwxyz"
const GUEST_ID = "local-abc-123"

function makeChat(id: string): Chats {
  return {
    id,
    user_id: "user-1",
    title: "Some chat",
    model: null,
    system_prompt: null,
    project_id: null,
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: null,
    updated_at: null,
  }
}

describe("resolveGetByIdArgs (useChat fallback decision)", () => {
  it("skips when there is no chat id", () => {
    expect(resolveGetByIdArgs(null, undefined)).toBe("skip")
    expect(resolveGetByIdArgs(undefined, undefined)).toBe("skip")
  })

  it("skips when the chat is already in the live window", () => {
    expect(resolveGetByIdArgs(CONVEX_ID, makeChat(CONVEX_ID))).toBe("skip")
  })

  it("skips a guest/local id with no server record", () => {
    expect(resolveGetByIdArgs(GUEST_ID, undefined)).toBe("skip")
  })

  it("fetches a durable id that is not in the window", () => {
    expect(resolveGetByIdArgs(CONVEX_ID, undefined)).toEqual({
      chatId: CONVEX_ID,
    })
  })
})

describe("pickChat (in-window precedence)", () => {
  it("returns the in-window chat synchronously, ignoring the server read", () => {
    const inWindow = makeChat(CONVEX_ID)
    expect(pickChat(inWindow, null)).toBe(inWindow)
  })

  it("falls back to the mapped server chat when out of window", () => {
    const serverChat = {
      _id: CONVEX_ID,
      _creationTime: 1700000000000,
      userId: "user-1",
      title: "Old chat",
      public: false,
      pinned: false,
      updatedAt: 1700000000000,
    } as unknown as Doc<"chats">

    expect(pickChat(undefined, serverChat)).toMatchObject({
      id: CONVEX_ID,
      title: "Old chat",
    })
  })

  it("is undefined while the fallback is loading or not found", () => {
    expect(pickChat(undefined, undefined)).toBeUndefined()
    expect(pickChat(undefined, null)).toBeUndefined()
  })
})
