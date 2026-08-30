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
  getSelectedConversationForViewer,
  getSelectedPathForViewer,
  getSelectedRunStateForViewer,
  selectBranchForChat,
} from "./messages"

type TableDocuments = {
  users: Doc<"users">[]
  chats: Doc<"chats">[]
  projects: Doc<"projects">[]
  messages: Doc<"messages">[]
  generationRuns: Doc<"generationRuns">[]
  toolInvocations: Doc<"toolInvocations">[]
  toolApprovalRequests: Doc<"toolApprovalRequests">[]
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
    projects: [],
    messages: [],
    generationRuns: [],
    toolInvocations: [],
    toolApprovalRequests: [],
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
    updatedAt: 1,
  }

  return { user, chat, userId, chatId }
}

describe("getPublicForChatHandler", () => {
  it("returns no messages for a tombstoned public chat", async () => {
    const { user, chat, chatId } = createOwnerFixture({ publicChat: true })
    chat.deletingAt = 2
    const { ctx } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages: [
        {
          ...createMessage({
            id: "message_1",
            orderId: 1,
            role: "user",
            content: "hidden",
          }),
          chatId,
        },
      ],
    })

    await expect(
      getPublicForChatHandler(ctx, { chatId })
    ).resolves.toEqual([])
  })

  it("returns no messages when the public Chat's Project is tombstoned", async () => {
    const { user, chat, chatId } = createOwnerFixture({ publicChat: true })
    const project: Doc<"projects"> = {
      _id: asId<"projects">("project_1"),
      _creationTime: 1,
      userId: user._id,
      name: "Deleting",
      deletingAt: 2,
    }
    chat.projectId = project._id
    const { ctx } = createMutationCtx({
      users: [user],
      chats: [chat],
      projects: [project],
      messages: [
        {
          ...createMessage({
            id: "message_1",
            orderId: 1,
            role: "user",
            content: "hidden",
          }),
          chatId,
        },
      ],
    })

    await expect(
      getPublicForChatHandler(ctx, { chatId })
    ).resolves.toEqual([])
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

    expect(getBranchInfoForMessage(messages, selectedPath[1]!)).toMatchObject({
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
    await expect(
      getPublicForChatHandler(ctx, { chatId })
    ).resolves.toMatchObject([
      { _id: "message_user_1" },
      { _id: "message_assistant_old" },
    ])
    await expect(
      getLastMessagesHandler(ctx, { chatId, limit: 1 })
    ).resolves.toMatchObject([{ _id: "message_assistant_old" }])
  })

})

describe("getSelectedConversation", () => {
  function createRunWorld({
    runStatus = "streaming" as Doc<"generationRuns">["status"],
    assistantSelected = true,
    publicChat = false,
  } = {}) {
    const { user, chat, userId, chatId } = createOwnerFixture({ publicChat })
    const runId = asId<"generationRuns">("run_1")
    const assistantId = asMessageId("message_assistant_1")
    const messages: Doc<"messages">[] = [
      createMessage({
        id: "message_user_1",
        orderId: 0,
        role: "user",
        content: "prompt",
        selected: true,
      }),
      {
        ...createMessage({
          id: "message_assistant_1",
          orderId: 1,
          role: "assistant",
          content: "partial",
          selected: assistantSelected,
        }),
        status: "streaming" as const,
        generationRunId: runId,
      },
    ]
    const run: Doc<"generationRuns"> = {
      _id: runId,
      _creationTime: 1,
      chatId,
      userId,
      requestId: "request_1",
      model: "gpt-5",
      provider: "openai",
      status: runStatus,
      startedAt: 1,
      updatedAt: 1,
      activeStreamId: assistantId,
      assistantMessageId: assistantId,
      leaseExpiresAt: 46_000,
      terminalReason: runStatus === "failed" ? "lease_expired" : undefined,
    }
    chat.statusRunId = runId
    return { user, chat, userId, chatId, runId, assistantId, messages, run }
  }

  it("returns messages and the linked run's raw facts atomically for the owner", async () => {
    const world = createRunWorld()
    const { ctx } = createMutationCtx({
      users: [world.user],
      chats: [world.chat],
      messages: world.messages,
      generationRuns: [world.run],
      toolInvocations: [
        {
          _id: asId<"toolInvocations">("tool_invocation_1"),
          _creationTime: 1,
          runId: world.runId,
          chatId: world.chatId,
          messageId: world.assistantId,
          toolCallId: "call_1",
          toolName: "web_search",
          source: "builtin",
          status: "called",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          _id: asId<"toolInvocations">("tool_invocation_2"),
          _creationTime: 1,
          runId: world.runId,
          chatId: world.chatId,
          messageId: world.assistantId,
          toolCallId: "call_2",
          toolName: "extract_content",
          source: "builtin",
          status: "completed",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      toolApprovalRequests: [
        {
          _id: asId<"toolApprovalRequests">("approval_request_1"),
          _creationTime: 1,
          chatId: world.chatId,
          runId: world.runId,
          assistantMessageId: world.assistantId,
          userId: world.userId,
          toolCallId: "call_3",
          toolName: "send_email",
          source: "mcp",
          riskClass: "destructive",
          approvalId: "approval_1",
          status: "pending",
          createdAt: 5,
          expiresAt: 90_000,
        },
      ],
    })

    const projection = await getSelectedConversationForViewer(ctx, {
      chat: world.chat,
      viewer: world.user,
    })

    expect(
      projection.selectedMessages.map((message) => message._id)
    ).toEqual(["message_user_1", "message_assistant_1"])
    expect(projection.selectedRun).toMatchObject({
      runId: world.runId,
      assistantMessageId: world.assistantId,
      status: "streaming",
      leaseExpiresAt: 46_000,
      // Experiment 2 §6.1: the projection carries approval presence +
      // expiry only; the approval UI reads message parts, not this wire.
      pendingApproval: { expiresAt: 90_000 },
    })
  })

  it("returns selectedRun null to a public non-owner viewer (no run metadata leaks)", async () => {
    const world = createRunWorld({ publicChat: true })
    // The viewer is authenticated but does NOT own the chat.
    world.chat.userId = asId<"users">("user_other")
    const { ctx } = createMutationCtx({
      users: [
        world.user,
        {
          _id: asId<"users">("user_other"),
          _creationTime: 1,
          workosUserId: "workos_user_other",
          email: "other@example.com",
        },
      ],
      chats: [world.chat],
      messages: world.messages,
      generationRuns: [world.run],
    })

    const projection = await getSelectedConversationForViewer(ctx, {
      chat: world.chat,
      viewer: world.user,
    })

    expect(projection.selectedMessages.length).toBeGreaterThan(0)
    expect(projection.selectedRun).toBeNull()
    // The message docs carry the run linkage too — nulling `selectedRun`
    // while returning raw docs would still leak run ids to a public viewer.
    for (const message of projection.selectedMessages) {
      expect(message).not.toHaveProperty("generationRunId")
      expect(message).not.toHaveProperty("requestId")
    }
  })

  it("keeps run linkage on message docs for the owner", async () => {
    const world = createRunWorld()
    const { ctx } = createMutationCtx({
      users: [world.user],
      chats: [world.chat],
      messages: world.messages,
      generationRuns: [world.run],
    })

    const projection = await getSelectedConversationForViewer(ctx, {
      chat: world.chat,
      viewer: world.user,
    })

    expect(
      projection.selectedMessages.some(
        (message) => message.generationRunId !== undefined
      )
    ).toBe(true)
  })

  it("returns no run when the linked assistant message is off the selected path", async () => {
    const world = createRunWorld({ assistantSelected: false })
    // A selected sibling displaces the run's message from the selected path.
    world.messages.push({
      ...createMessage({
        id: "message_assistant_2",
        orderId: 1,
        role: "assistant",
        content: "other branch",
        parentMessageId: asMessageId("message_user_1"),
        branchIndex: 1,
        selected: true,
      }),
    })
    world.messages[1].parentMessageId = asMessageId("message_user_1")
    world.messages[1].branchIndex = 0
    const { ctx } = createMutationCtx({
      users: [world.user],
      chats: [world.chat],
      messages: world.messages,
      generationRuns: [world.run],
    })

    const projection = await getSelectedConversationForViewer(ctx, {
      chat: world.chat,
      viewer: world.user,
    })

    expect(projection.selectedRun).toBeNull()
  })

  it("keeps projecting a terminal current run with its terminal reason (convergence metadata)", async () => {
    const world = createRunWorld({ runStatus: "failed" })
    const { ctx } = createMutationCtx({
      users: [world.user],
      chats: [world.chat],
      messages: world.messages,
      generationRuns: [world.run],
    })

    const projection = await getSelectedConversationForViewer(ctx, {
      chat: world.chat,
      viewer: world.user,
    })

    expect(projection.selectedRun).toMatchObject({
      status: "failed",
      terminalReason: "lease_expired",
    })
  })

  // Experiment 2: the split halves must reproduce the atomic projection —
  // same message derivation code, same run gauntlet minus the on-path half,
  // which the client provider enforces against the delivered path.
  it("split halves reproduce the atomic projection for the owner", async () => {
    const world = createRunWorld()
    const { ctx } = createMutationCtx({
      users: [world.user],
      chats: [world.chat],
      messages: world.messages,
      generationRuns: [world.run],
    })
    const viewer = { chat: world.chat, viewer: world.user }

    const atomic = await getSelectedConversationForViewer(ctx, viewer)
    const path = await getSelectedPathForViewer(ctx, viewer)
    const runState = await getSelectedRunStateForViewer(ctx, viewer)

    expect(path.selectedMessages).toEqual(atomic.selectedMessages)
    expect(runState).toEqual(atomic.selectedRun)
    expect(path.pathVersion.count).toBe(path.selectedMessages.length)
    expect(path.pathVersion.tailMessageId).toBe(
      path.selectedMessages.at(-1)?._id ?? null
    )
  })

  it("split run half keeps points-back server-side and leaves on-path to the client", async () => {
    // A run whose assistant message exists but is OFF the selected path:
    // the atomic query nulls it (on-path fails); the split run half still
    // returns it (points-back holds) — the provider nulls it against the
    // delivered path. Both are recorded behaviors, not accidents.
    const world = createRunWorld({ assistantSelected: false })
    world.messages.push(
      createMessage({
        id: "message_assistant_2",
        orderId: 1,
        role: "assistant",
        content: "the selected sibling",
        selected: true,
      })
    )
    const { ctx } = createMutationCtx({
      users: [world.user],
      chats: [world.chat],
      messages: world.messages,
      generationRuns: [world.run],
    })
    const viewer = { chat: world.chat, viewer: world.user }

    const atomic = await getSelectedConversationForViewer(ctx, viewer)
    const runState = await getSelectedRunStateForViewer(ctx, viewer)

    expect(atomic.selectedRun).toBeNull()
    expect(runState?.runId).toBe(world.runId)
    // The client-side check the provider performs:
    const path = await getSelectedPathForViewer(ctx, viewer)
    const onDeliveredPath = path.selectedMessages.some(
      (message) => message._id === runState?.assistantMessageId
    )
    expect(onDeliveredPath).toBe(false)
  })

  it("split run half never reads the message doc while the run is live", async () => {
    // The trim's read-set property (Experiment 2 finding 1): with
    // `activeStreamId` stamped, points-back is decided from the run doc
    // alone — so content beats, which write only the message doc, cannot
    // re-execute the run half. The message read survives only as the
    // settled-run fallback (covered by the point-back-null test, which
    // clears `activeStreamId`).
    const world = createRunWorld()
    const { ctx } = createMutationCtx({
      users: [world.user],
      chats: [world.chat],
      messages: world.messages,
      generationRuns: [world.run],
    })
    const readIds: string[] = []
    const rawGet = ctx.db.get
    ctx.db.get = (async (id: string) => {
      readIds.push(id)
      return rawGet(id as Parameters<typeof rawGet>[0])
    }) as typeof rawGet

    const runState = await getSelectedRunStateForViewer(ctx, {
      chat: world.chat,
      viewer: world.user,
    })

    expect(runState?.runId).toBe(world.runId)
    expect(readIds).toEqual([world.runId])
  })

  it("split run half returns null when the linked message does not point back", async () => {
    const world = createRunWorld()
    world.messages[1] = {
      ...world.messages[1],
      generationRunId: asId<"generationRuns">("run_other"),
    }
    world.run.activeStreamId = undefined
    const { ctx } = createMutationCtx({
      users: [world.user],
      chats: [world.chat],
      messages: world.messages,
      generationRuns: [world.run],
    })
    expect(
      await getSelectedRunStateForViewer(ctx, {
        chat: world.chat,
        viewer: world.user,
      })
    ).toBeNull()
  })

  it("split halves deny non-owner viewers exactly as the atomic query does", async () => {
    const world = createRunWorld({ publicChat: true })
    world.chat.userId = asId<"users">("user_other")
    const { ctx } = createMutationCtx({
      users: [world.user],
      chats: [world.chat],
      messages: world.messages,
      generationRuns: [world.run],
    })
    const viewer = { chat: world.chat, viewer: world.user }

    const atomic = await getSelectedConversationForViewer(ctx, viewer)
    const path = await getSelectedPathForViewer(ctx, viewer)
    const runState = await getSelectedRunStateForViewer(ctx, viewer)

    expect(runState).toBeNull()
    expect(path.selectedMessages).toEqual(atomic.selectedMessages)
    for (const message of path.selectedMessages) {
      expect(message.generationRunId).toBeUndefined()
      expect(message.status === "awaiting_approval").toBe(false)
    }
  })
})
