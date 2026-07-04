import { describe, expect, it } from "vitest"
import {
  createLocalChatId,
  createOptimisticChatId,
  getChatPersistenceMode,
  getMessagePersistenceMode,
} from "./identity"

describe("chat identity helpers", () => {
  it.each([
    {
      name: "guest local",
      chatId: createLocalChatId(() => "guest"),
      chatMode: "guestLocal",
      messageMode: "localOnly",
    },
    {
      name: "optimistic server",
      chatId: createOptimisticChatId(() => "pending"),
      chatMode: "optimisticServer",
      messageMode: "optimistic",
    },
    {
      name: "durable server",
      chatId: "jh7f4n2k9p8q6r3s5t1v0wxyz",
      chatMode: "durableServer",
      messageMode: "server",
    },
  ] as const)(
    "maps $name chat IDs to persistence modes",
    ({ chatId, chatMode, messageMode }) => {
      expect(getChatPersistenceMode(chatId)).toBe(chatMode)
      expect(getMessagePersistenceMode(chatId)).toBe(messageMode)
    }
  )

  it("lets shared read-only context override server-looking IDs", () => {
    const options = { isSharedReadOnly: true }

    expect(getChatPersistenceMode("jh7f4n2k9p8q6r3s5t1v0wxyz", options)).toBe(
      "sharedReadOnly"
    )
    expect(
      getMessagePersistenceMode("jh7f4n2k9p8q6r3s5t1v0wxyz", options)
    ).toBe("localOnly")
  })
})
