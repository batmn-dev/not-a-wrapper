import { describe, expect, it } from "vitest"
import {
  createGuestUserId,
  createLocalChatId,
  createOptimisticChatId,
  createOptimisticEditMessageId,
  createOptimisticMessageId,
  getChatPersistenceMode,
  getMessagePersistenceMode,
  isGuestUserId,
  isLocalChatId,
  isLocalMessageId,
  isOptimisticChatId,
  isOptimisticMessageId,
  isServerChatId,
} from "./identity"

describe("chat identity helpers", () => {
  it("creates existing chat and message ID shapes", () => {
    expect(createLocalChatId(() => "abc")).toBe("local-abc")
    expect(createOptimisticChatId(() => "abc")).toBe("optimistic-abc")
    expect(createOptimisticMessageId(() => "abc")).toBe("optimistic-abc")
    expect(createOptimisticEditMessageId(() => "abc")).toBe(
      "optimistic-edit-abc"
    )
    expect(createGuestUserId(() => "abc")).toBe("guest_abc")
  })

  it.each([
    {
      id: "local-123",
      localChat: true,
      optimisticChat: false,
      serverChat: false,
      localMessage: true,
      optimisticMessage: false,
      guestUser: false,
    },
    {
      id: "optimistic-123",
      localChat: false,
      optimisticChat: true,
      serverChat: false,
      localMessage: false,
      optimisticMessage: true,
      guestUser: false,
    },
    {
      id: "optimistic-edit-123",
      localChat: false,
      optimisticChat: true,
      serverChat: false,
      localMessage: false,
      optimisticMessage: true,
      guestUser: false,
    },
    {
      id: "guest_123",
      localChat: false,
      optimisticChat: false,
      serverChat: true,
      localMessage: false,
      optimisticMessage: false,
      guestUser: true,
    },
    {
      id: "jh7f4n2k9p8q6r3s5t1v0wxyz",
      localChat: false,
      optimisticChat: false,
      serverChat: true,
      localMessage: false,
      optimisticMessage: false,
      guestUser: false,
    },
  ])("classifies $id by existing prefix semantics", (example) => {
    expect(isLocalChatId(example.id)).toBe(example.localChat)
    expect(isOptimisticChatId(example.id)).toBe(example.optimisticChat)
    expect(isServerChatId(example.id)).toBe(example.serverChat)
    expect(isLocalMessageId(example.id)).toBe(example.localMessage)
    expect(isOptimisticMessageId(example.id)).toBe(example.optimisticMessage)
    expect(isGuestUserId(example.id)).toBe(example.guestUser)
  })

  it.each([
    {
      chatId: "local-123",
      chatMode: "guestLocal",
      messageMode: "localOnly",
    },
    {
      chatId: "optimistic-123",
      chatMode: "optimisticServer",
      messageMode: "optimistic",
    },
    {
      chatId: "jh7f4n2k9p8q6r3s5t1v0wxyz",
      chatMode: "durableServer",
      messageMode: "server",
    },
  ] as const)(
    "maps $chatId to persistence modes",
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
    expect(getMessagePersistenceMode("jh7f4n2k9p8q6r3s5t1v0wxyz", options)).toBe(
      "localOnly"
    )
  })
})
