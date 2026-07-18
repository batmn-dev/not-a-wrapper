import { describe, expect, it } from "vitest"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { getSelectedPathMessages } from "./message_branches"
import { createMessageBranchWriter } from "./message_branch_writes"

type ChatMessage = Doc<"messages">

const chatId = "chat_1" as Id<"chats">
const otherChatId = "chat_2" as Id<"chats">
const userId = "user_1" as Id<"users">

function message(
  id: string,
  orderId: number,
  role: "user" | "assistant",
  options: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    _id: id as Id<"messages">,
    _creationTime: orderId,
    chatId,
    orderId,
    role,
    content: `${role} ${orderId}`,
    parts: [],
    status: "completed",
    createdAt: orderId,
    updatedAt: orderId,
    ...options,
  }
}

function createHarness(initialMessages: ChatMessage[] = []) {
  const messages = structuredClone(initialMessages)
  let nextId = 1

  const ctx = {
    db: {
      get: async (id: string) =>
        messages.find((candidate) => candidate._id === id) ?? null,
      query: (table: string) => {
        expect(table).toBe("messages")
        return {
          withIndex: (
            index: string,
            build: (query: {
              eq: (field: string, value: unknown) => unknown
            }) => unknown
          ) => {
            expect(index).toBe("by_chat_order")
            let selectedChatId: unknown
            const query = {
              eq: (field: string, value: unknown) => {
                expect(field).toBe("chatId")
                selectedChatId = value
                return query
              },
            }
            build(query)
            return {
              collect: async () =>
                messages
                  .filter((candidate) => candidate.chatId === selectedChatId)
                  .sort((left, right) => left.orderId - right.orderId),
            }
          },
        }
      },
      patch: async (id: string, patch: Partial<ChatMessage>) => {
        const target = messages.find((candidate) => candidate._id === id)
        if (!target) throw new Error(`Missing message ${id}`)
        Object.assign(target, patch)
      },
      insert: async (table: string, value: Omit<ChatMessage, "_id" | "_creationTime">) => {
        expect(table).toBe("messages")
        const id = `inserted_${nextId++}` as Id<"messages">
        messages.push({
          _id: id,
          _creationTime: value.createdAt,
          ...value,
        })
        return id
      },
    },
  } as unknown as MutationCtx

  return { ctx, messages }
}

function writer(ctx: MutationCtx) {
  return createMessageBranchWriter(ctx, { chatId, now: 100 })
}

function userInput(overrides: Record<string, unknown> = {}) {
  return {
    clientMessageId: "client_user_1",
    userId,
    content: "hello",
    parts: [{ type: "text", text: "hello" }],
    requestId: "request_1",
    model: "model_1",
    provider: "provider_1",
    ...overrides,
  }
}

function assistantInput(overrides: Record<string, unknown> = {}) {
  return {
    generationRunId: "run_1" as Id<"generationRuns">,
    requestId: "request_1",
    model: "model_1",
    provider: "provider_1",
    ...overrides,
  }
}

describe("Message branch writer", () => {
  it("writes a normal user and assistant sequence with one Selected path", async () => {
    const { ctx, messages } = createHarness()
    const branches = writer(ctx)

    const user = await branches.writeUserMessage(userInput())
    const assistant = await branches.writeAssistantPlaceholder(assistantInput())

    expect(assistant).toMatchObject({
      role: "assistant",
      parentMessageId: user._id,
      branchIndex: 0,
      selected: true,
      status: "streaming",
      generationRunId: "run_1",
    })
    // Assert the Selected path from stored state — the same projection
    // production reads — rather than a courtesy copy on the result.
    expect(getSelectedPathMessages(messages).map((item) => item._id)).toEqual([
      user._id,
      assistant._id,
    ])
  })

  it("selects an existing user message for a repeated client id", async () => {
    const existing = message("user_old", 0, "user", {
      clientMessageId: "client_user_1",
      branchIndex: 0,
      selected: false,
    })
    const sibling = message("user_new", 1, "user", {
      branchIndex: 1,
      selected: true,
    })
    const { ctx, messages } = createHarness([existing, sibling])

    const result = await writer(ctx).writeUserMessage(userInput())

    expect(result._id).toBe("user_old")
    // No insert happened — the repeated client id selected the existing row.
    expect(messages).toHaveLength(2)
    expect(messages.find((item) => item._id === "user_old")?.selected).toBe(true)
    expect(messages.find((item) => item._id === "user_new")?.selected).toBe(false)
  })

  it("writes an un-stamped first-turn user message, then adopts the claiming run's provenance", async () => {
    const { ctx, messages } = createHarness()
    const branches = writer(ctx)

    // The atomic first-turn creation writes before any generation request
    // exists, so it carries no provenance stamp.
    const firstTurn = await branches.writeUserMessage(
      userInput({ requestId: undefined, model: undefined, provider: undefined })
    )
    expect(firstTurn).toMatchObject({
      requestId: undefined,
      model: undefined,
      provider: undefined,
      selected: true,
      status: "completed",
    })

    // The generation's idempotent write (same clientMessageId) claims the row:
    // no duplicate insert, and the run's stamp is adopted.
    const claimed = await writer(ctx).writeUserMessage(userInput())
    expect(claimed._id).toBe(firstTurn._id)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      requestId: "request_1",
      model: "model_1",
      provider: "provider_1",
    })

    // A later repeat with different provenance does NOT restamp — the first
    // claiming run keeps ownership.
    await writer(ctx).writeUserMessage(userInput({ requestId: "request_2" }))
    expect(messages[0]?.requestId).toBe("request_1")
  })

  it("writes an edit sibling while preserving the replaced descendants", async () => {
    const original = message("user_original", 0, "user", {
      branchIndex: 0,
      selected: true,
    })
    const descendant = message("assistant_original", 1, "assistant", {
      parentMessageId: original._id,
      branchIndex: 0,
      selected: true,
    })
    const { ctx, messages } = createHarness([original, descendant])

    const result = await writer(ctx).writeUserMessage(
      userInput({ clientMessageId: "client_edit", replaces: original._id })
    )

    expect(result).toMatchObject({
      parentMessageId: undefined,
      branchIndex: 1,
      selected: true,
    })
    expect(messages.find((item) => item._id === original._id)?.selected).toBe(false)
    expect(messages.find((item) => item._id === descendant._id)).toBeDefined()
    expect(getSelectedPathMessages(messages).map((item) => item._id)).toEqual([
      result._id,
    ])
  })

  it("writes a regeneration sibling with structural provenance", async () => {
    const user = message("user_1", 0, "user", {
      branchIndex: 0,
      selected: true,
    })
    const original = message("assistant_original", 1, "assistant", {
      parentMessageId: user._id,
      branchIndex: 0,
      selected: true,
    })
    const { ctx } = createHarness([user, original])

    const result = await writer(ctx).writeAssistantPlaceholder(
      assistantInput({ replaces: original._id })
    )

    expect(result).toMatchObject({
      parentMessageId: user._id,
      branchIndex: 1,
      regenerationSourceMessageId: original._id,
      selected: true,
    })
  })

  it("normalizes legacy and sparse siblings without index collisions", async () => {
    const user = message("user_1", 0, "user")
    const indexed = message("assistant_indexed", 1, "assistant", {
      parentMessageId: user._id,
      branchIndex: 2,
      selected: true,
    })
    const missingOne = message("assistant_missing_1", 2, "assistant", {
      parentMessageId: user._id,
    })
    const missingTwo = message("assistant_missing_2", 3, "assistant", {
      parentMessageId: user._id,
    })
    const { ctx, messages } = createHarness([
      user,
      indexed,
      missingOne,
      missingTwo,
    ])

    await writer(ctx).select(missingTwo._id)

    const siblings = messages.filter((item) => item.role === "assistant")
    expect(siblings.map((item) => item.branchIndex).sort()).toEqual([0, 1, 2])
    expect(siblings.filter((item) => item.selected)).toHaveLength(1)
    expect(messages.find((item) => item._id === user._id)).toMatchObject({
      branchIndex: 0,
      selected: true,
    })
  })

  it("explicitly selects one sibling and restores its Selected path", async () => {
    const user = message("user_1", 0, "user", {
      branchIndex: 0,
      selected: true,
    })
    const oldAnswer = message("assistant_old", 1, "assistant", {
      parentMessageId: user._id,
      branchIndex: 0,
      selected: false,
    })
    const newAnswer = message("assistant_new", 2, "assistant", {
      parentMessageId: user._id,
      branchIndex: 1,
      selected: true,
    })
    const { ctx, messages } = createHarness([user, oldAnswer, newAnswer])

    const result = await writer(ctx).select(oldAnswer._id)

    const selectedPath = getSelectedPathMessages(messages)
    expect(selectedPath.map((item) => item._id)).toEqual([
      user._id,
      oldAnswer._id,
    ])
    expect(selectedPath.at(-1)?.selected).toBe(true)
    expect(result._id).toBe(oldAnswer._id)
  })

  it("rejects missing, cross-chat, and role-mismatched targets without writes", async () => {
    const user = message("user_1", 0, "user", {
      branchIndex: 0,
      selected: true,
    })
    const crossChat = message("assistant_other", 1, "assistant", {
      chatId: otherChatId,
    })
    const { ctx, messages } = createHarness([user, crossChat])
    const before = structuredClone(messages)
    const branches = writer(ctx)

    await expect(
      branches.select("missing" as Id<"messages">)
    ).rejects.toThrow("Message not found")
    await expect(branches.select(crossChat._id)).rejects.toThrow(
      "Message not found"
    )
    await expect(
      branches.writeAssistantPlaceholder(
        assistantInput({ replaces: user._id })
      )
    ).rejects.toThrow("must be an assistant message")
    expect(messages).toEqual(before)
  })
})
