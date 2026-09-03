import { describe, expect, it } from "vitest"
import {
  createChatPublicId,
  createOptimisticEditMessageId,
  getChatPersistenceMode,
  getMessagePersistenceMode,
  isChatPublicId,
  isOptimisticEditMessageId,
} from "./identity"

describe("chat identity helpers", () => {
  it("mints UUID chat ids and recognizes only that shape", () => {
    expect(isChatPublicId(createChatPublicId())).toBe(true)
    expect(isChatPublicId("jh7f4n2k9p8q6r3s5t1v0wxyz")).toBe(false)
    expect(isChatPublicId("local-guest")).toBe(false)
    expect(isChatPublicId(null)).toBe(false)
  })

  it.each([
    {
      name: "guest",
      isAuthenticated: false,
      chatMode: "guestLocal",
      messageMode: "localOnly",
    },
    {
      name: "signed-in",
      isAuthenticated: true,
      chatMode: "durableServer",
      messageMode: "server",
    },
  ] as const)(
    "derives $name persistence from auth, never from the id",
    ({ isAuthenticated, chatMode, messageMode }) => {
      expect(getChatPersistenceMode(isAuthenticated)).toBe(chatMode)
      expect(getMessagePersistenceMode(isAuthenticated)).toBe(messageMode)
    }
  )

  it("lets shared read-only context override a signed-in caller", () => {
    const options = { isSharedReadOnly: true }

    expect(getChatPersistenceMode(true, options)).toBe("sharedReadOnly")
    expect(getMessagePersistenceMode(true, options)).toBe("localOnly")
  })

  it("distinguishes optimistic edits from ordinary optimistic messages", () => {
    expect(
      isOptimisticEditMessageId(
        createOptimisticEditMessageId(() => "replacement")
      )
    ).toBe(true)
    expect(isOptimisticEditMessageId("optimistic-new-message")).toBe(false)
    expect(isOptimisticEditMessageId("message-server-owned")).toBe(false)
  })
})
