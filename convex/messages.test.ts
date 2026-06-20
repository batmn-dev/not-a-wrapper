import { describe, expect, it } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import {
  getBranchInfoForMessage,
  getSelectedPathMessages,
} from "./domain/message_branches"
import {
  getForChatHandler,
  getLastMessagesHandler,
  getPublicForChatHandler,
  normalizeMessagePartsForStorage,
  selectBranchForChat,
} from "./messages"

type TableDocuments = {
  users: Doc<"users">[]
  chats: Doc<"chats">[]
  messages: Doc<"messages">[]
}

type TableName = keyof TableDocuments

type QueryBuilder = {
  eq: (fieldName: string, value: unknown) => QueryBuilder
}

function asMessageId(value: string): Id<"messages"> {
  return value as Id<"messages">
}

function asId<Table extends TableName | "messages" | "users" | "chats">(
  value: string
): Id<Table> {
  return value as Id<Table>
}

function createMessage({
  id,
  orderId,
  role,
  content,
  parentMessageId,
  branchIndex,
  selected,
}: {
  id: string
  orderId: number
  role: "user" | "assistant"
  content: string
  parentMessageId?: Id<"messages">
  branchIndex?: number
  selected?: boolean
}): Doc<"messages"> {
  return {
    _id: asMessageId(id),
    _creationTime: orderId,
    chatId: "chat_1" as Id<"chats">,
    orderId,
    role,
    content,
    parts: [{ type: "text", text: content }],
    parentMessageId,
    branchIndex,
    selected,
    status: "completed",
    createdAt: orderId,
    updatedAt: orderId,
  }
}

function createMutationCtx(tablesInput: Partial<TableDocuments>) {
  const tables: TableDocuments = {
    users: [],
    chats: [],
    messages: [],
    ...tablesInput,
  }

  function findDocument(id: string) {
    for (const documents of Object.values(tables)) {
      const document = documents.find((candidate) => candidate._id === id)
      if (document) return document
    }
    return null
  }

  const ctx = {
    db: {
      get: async (id: string) => findDocument(id),
      query: (tableName: TableName) => ({
        withIndex: (
          _indexName: string,
          buildQuery: (query: QueryBuilder) => unknown
        ) => {
          const filters = new Map<string, unknown>()
          const query: QueryBuilder = {
            eq: (fieldName, value) => {
              filters.set(fieldName, value)
              return query
            },
          }
          buildQuery(query)

          let results = tables[tableName].filter((document) => {
            const record = document as unknown as Record<string, unknown>
            for (const [fieldName, value] of filters) {
              if (record[fieldName] !== value) return false
            }
            return true
          })

          const resultApi = {
            collect: async () => results,
            unique: async () => {
              expect(results.length).toBeLessThanOrEqual(1)
              return results[0] ?? null
            },
            order: (direction: "asc" | "desc") => {
              results = [...results].sort((a, b) => {
                const left = (a as unknown as { orderId?: number }).orderId ?? 0
                const right =
                  (b as unknown as { orderId?: number }).orderId ?? 0
                return direction === "desc" ? right - left : left - right
              })
              return resultApi
            },
            first: async () => results[0] ?? null,
          }
          return resultApi
        },
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        const document = findDocument(id)
        expect(document).not.toBeNull()
        Object.assign(document as Record<string, unknown>, value)
      },
    },
    auth: {
      getUserIdentity: async () => ({ subject: "workos_user_1" }),
    },
  } as unknown as MutationCtx & QueryCtx

  return { ctx, tables }
}

function createOwnerFixture({ publicChat = false } = {}) {
  const userId = asId<"users">("user_1")
  const chatId = asId<"chats">("chat_1")
  const user: Doc<"users"> = {
    _id: userId,
    _creationTime: 1,
    workosUserId: "workos_user_1",
    email: "user@example.com",
  }
  const chat: Doc<"chats"> = {
    _id: chatId,
    _creationTime: 1,
    userId,
    public: publicChat,
    pinned: false,
  }

  return { user, chat, userId, chatId }
}

describe("normalizeMessagePartsForStorage", () => {
  it("defaults missing parts to an empty array", () => {
    expect(normalizeMessagePartsForStorage(undefined)).toEqual([])
  })

  it("bridges legacy attachments into file parts for storage", () => {
    expect(
      normalizeMessagePartsForStorage(
        [{ type: "text", text: "see attached" }],
        [
          {
            name: "receipt.pdf",
            contentType: "application/pdf",
            url: "https://example.com/receipt.pdf",
          },
        ]
      )
    ).toEqual([
      { type: "text", text: "see attached" },
      {
        type: "file",
        filename: "receipt.pdf",
        mediaType: "application/pdf",
        url: "https://example.com/receipt.pdf",
      },
    ])
  })

  it("keeps existing file parts canonical when legacy attachments are duplicated", () => {
    const filePart = {
      type: "file",
      filename: "photo.png",
      mediaType: "image/png",
      url: "https://example.com/photo.png",
    }

    expect(
      normalizeMessagePartsForStorage([filePart], [
        {
          name: "legacy-photo.png",
          contentType: "image/png",
          url: "https://example.com/legacy-photo.png",
        },
      ])
    ).toEqual([filePart])
  })

  it("ignores malformed legacy attachments", () => {
    expect(
      normalizeMessagePartsForStorage([], [
        null,
        { name: "missing-url.pdf", contentType: "application/pdf" },
        { name: "", contentType: "", url: "https://example.com/file.bin" },
      ])
    ).toEqual([
      {
        type: "file",
        filename: "file",
        mediaType: "application/octet-stream",
        url: "https://example.com/file.bin",
      },
    ])
  })
})

describe("message branch selection", () => {
  it("walks the selected path and reports sibling branch metadata", () => {
    const messages = [
      createMessage({
        id: "user_1",
        orderId: 0,
        role: "user",
        content: "prompt",
        branchIndex: 0,
        selected: true,
      }),
      createMessage({
        id: "assistant_old",
        orderId: 1,
        role: "assistant",
        content: "old answer",
        parentMessageId: asMessageId("user_1"),
        branchIndex: 0,
        selected: false,
      }),
      createMessage({
        id: "assistant_new",
        orderId: 2,
        role: "assistant",
        content: "new answer",
        parentMessageId: asMessageId("user_1"),
        branchIndex: 1,
        selected: true,
      }),
      createMessage({
        id: "user_2",
        orderId: 3,
        role: "user",
        content: "follow up",
        parentMessageId: asMessageId("assistant_new"),
        branchIndex: 0,
        selected: true,
      }),
    ]

    const selectedPath = getSelectedPathMessages(messages)
    expect(selectedPath.map((message) => message._id)).toEqual([
      "user_1",
      "assistant_new",
      "user_2",
    ])

    expect(
      getBranchInfoForMessage(messages, selectedPath[1]!)
    ).toMatchObject({
      messageId: "assistant_new",
      currentIndex: 1,
      total: 2,
      siblings: [
        { messageId: "assistant_old" },
        { messageId: "assistant_new" },
      ],
    })
  })

  it("returns selected-path messages from chat queries after a branch switch", async () => {
    const { user, chat, userId, chatId } = createOwnerFixture({
      publicChat: true,
    })
    const messages = [
      {
        ...createMessage({
          id: "message_user_1",
          orderId: 0,
          role: "user",
          content: "prompt",
          branchIndex: 0,
          selected: true,
        }),
        chatId,
        userId,
      },
      createMessage({
        id: "message_assistant_old",
        orderId: 1,
        role: "assistant",
        content: "old answer",
        parentMessageId: asMessageId("message_user_1"),
        branchIndex: 0,
        selected: false,
      }),
      createMessage({
        id: "message_assistant_new",
        orderId: 2,
        role: "assistant",
        content: "new answer",
        parentMessageId: asMessageId("message_user_1"),
        branchIndex: 1,
        selected: true,
      }),
      createMessage({
        id: "message_user_2",
        orderId: 3,
        role: "user",
        content: "follow up",
        parentMessageId: asMessageId("message_assistant_new"),
        branchIndex: 0,
        selected: true,
      }),
    ].map((message) => ({ ...message, chatId }))
    const { ctx } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages,
    })

    await selectBranchForChat(ctx, {
      chatId,
      messageId: asMessageId("message_assistant_old"),
    })

    await expect(getForChatHandler(ctx, { chatId })).resolves.toMatchObject([
      { _id: "message_user_1" },
      { _id: "message_assistant_old" },
    ])
    await expect(getPublicForChatHandler(ctx, { chatId })).resolves
      .toMatchObject([{ _id: "message_user_1" }, { _id: "message_assistant_old" }])
    await expect(getLastMessagesHandler(ctx, { chatId, limit: 1 })).resolves
      .toMatchObject([{ _id: "message_assistant_old" }])
  })
})
