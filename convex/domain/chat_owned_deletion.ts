import { getConvexSize, type Value } from "convex/values"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { recordKnownProjectActivity } from "./project_activity"

type ChatOwnedDeletionCtx = Pick<MutationCtx, "db" | "meta" | "storage">

type Page<T> = {
  page: T[]
  isDone: boolean
  continueCursor: string
}

type DeletionBudget = {
  documents: number
  bytes: number
}

type ChatGraph = {
  chat: Doc<"chats">
  messages: Doc<"messages">[]
  generationRuns: Doc<"generationRuns">[]
  assistantMessageSnapshots: Doc<"assistantMessageSnapshots">[]
  toolInvocations: Doc<"toolInvocations">[]
  toolApprovalRequests: Doc<"toolApprovalRequests">[]
  toolCallLogs: Doc<"toolCallLog">[]
  attachments: Doc<"chatAttachments">[]
}

/**
 * Product limits for the synchronous deletion contract. They deliberately
 * reserve substantial room below Convex's transaction ceilings; exceeding one
 * fails before any write instead of turning "deleted" into eventual cleanup.
 */
export const CHAT_OWNED_DELETION_LIMITS = {
  documents: 5_000,
  bytes: 8 * 1024 * 1024,
  projectChats: 250,
  storedFiles: 500,
  pageSize: 4,
  transactionDocumentReserve: 32,
  transactionByteReserve: 1024 * 1024,
} as const

export const CHAT_OWNED_DELETION_LIMIT_ERROR =
  "Chat-owned deletion exceeds atomic transaction limits"

export type ChatOwnedDeletion = {
  deleteChat(chat: Doc<"chats">): Promise<void>
  deleteChatsForProject(project: Doc<"projects">): Promise<void>
}

function throwLimitError(): never {
  throw new Error(CHAT_OWNED_DELETION_LIMIT_ERROR)
}

function addToBudget<T>(budget: DeletionBudget, rows: readonly T[]): void {
  for (const row of rows) {
    budget.documents += 1
    budget.bytes += getConvexSize(row as unknown as Value)
  }

  if (
    budget.documents > CHAT_OWNED_DELETION_LIMITS.documents ||
    budget.bytes > CHAT_OWNED_DELETION_LIMITS.bytes
  ) {
    throwLimitError()
  }
}

async function collectBounded<T>(
  loadPage: (cursor: string | null) => Promise<Page<T>>,
  budget: DeletionBudget,
  rangeLimit?: number
): Promise<T[]> {
  const rows: T[] = []
  let cursor: string | null = null

  while (true) {
    const result = await loadPage(cursor)
    rows.push(...result.page)
    addToBudget(budget, result.page)

    if (rangeLimit !== undefined && rows.length > rangeLimit) {
      throwLimitError()
    }
    if (result.isDone) return rows
    cursor = result.continueCursor
  }
}

async function collectChatGraph(
  ctx: ChatOwnedDeletionCtx,
  chat: Doc<"chats">,
  budget: DeletionBudget
): Promise<ChatGraph> {
  const chatId = chat._id
  const page = { numItems: CHAT_OWNED_DELETION_LIMITS.pageSize }

  const messages = await collectBounded(
    (cursor) =>
      ctx.db
        .query("messages")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .paginate({ ...page, cursor }),
    budget
  )
  const generationRuns = await collectBounded(
    (cursor) =>
      ctx.db
        .query("generationRuns")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .paginate({ ...page, cursor }),
    budget
  )
  const assistantMessageSnapshots = await collectBounded(
    (cursor) =>
      ctx.db
        .query("assistantMessageSnapshots")
        .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
        .paginate({ ...page, cursor }),
    budget
  )
  const toolInvocations = await collectBounded(
    (cursor) =>
      ctx.db
        .query("toolInvocations")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .paginate({ ...page, cursor }),
    budget
  )
  const toolApprovalRequests = await collectBounded(
    (cursor) =>
      ctx.db
        .query("toolApprovalRequests")
        .withIndex("by_chat_status", (q) => q.eq("chatId", chatId))
        .paginate({ ...page, cursor }),
    budget
  )
  const toolCallLogs = await collectBounded(
    (cursor) =>
      ctx.db
        .query("toolCallLog")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .paginate({ ...page, cursor }),
    budget
  )
  const attachments = await collectBounded(
    (cursor) =>
      ctx.db
        .query("chatAttachments")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .paginate({ ...page, cursor }),
    budget
  )

  return {
    chat,
    messages,
    generationRuns,
    assistantMessageSnapshots,
    toolInvocations,
    toolApprovalRequests,
    toolCallLogs,
    attachments,
  }
}

function storedFileIds(graphs: readonly ChatGraph[]): Id<"_storage">[] {
  const ids = new Set<Id<"_storage">>()
  for (const graph of graphs) {
    for (const attachment of graph.attachments) {
      if (attachment.storageId) ids.add(attachment.storageId)
    }
  }

  if (ids.size > CHAT_OWNED_DELETION_LIMITS.storedFiles) {
    throwLimitError()
  }
  return [...ids]
}

async function assertWriteHeadroom(
  ctx: ChatOwnedDeletionCtx,
  budget: DeletionBudget
): Promise<void> {
  const metrics = await ctx.meta.getTransactionMetrics()
  const documentHeadroom =
    metrics.documentsWritten.remaining -
    CHAT_OWNED_DELETION_LIMITS.transactionDocumentReserve
  const byteHeadroom =
    metrics.bytesWritten.remaining -
    CHAT_OWNED_DELETION_LIMITS.transactionByteReserve

  if (
    budget.documents > documentHeadroom ||
    budget.bytes > byteHeadroom
  ) {
    throwLimitError()
  }
}

async function deleteStoredFiles(
  ctx: ChatOwnedDeletionCtx,
  storageIds: readonly Id<"_storage">[]
): Promise<void> {
  for (const storageId of storageIds) {
    await ctx.storage.delete(storageId)
  }
}

async function deleteChatChildren(
  ctx: ChatOwnedDeletionCtx,
  graph: ChatGraph
): Promise<void> {
  // Cross-record references point into runs/messages/approvals, so delete the
  // leaves first and keep the Chat root available until every child is gone.
  for (const snapshot of graph.assistantMessageSnapshots) {
    await ctx.db.delete(snapshot._id)
  }
  for (const invocation of graph.toolInvocations) {
    await ctx.db.delete(invocation._id)
  }
  for (const approval of graph.toolApprovalRequests) {
    await ctx.db.delete(approval._id)
  }
  for (const log of graph.toolCallLogs) {
    await ctx.db.delete(log._id)
  }
  for (const message of graph.messages) {
    await ctx.db.delete(message._id)
  }
  for (const run of graph.generationRuns) {
    await ctx.db.delete(run._id)
  }
  for (const attachment of graph.attachments) {
    await ctx.db.delete(attachment._id)
  }
}

/**
 * Construct the mutation-scoped module. Authenticated handlers retain
 * authorization and root ownership; this module owns the complete Chat graph.
 */
export function createChatOwnedDeletion(
  ctx: ChatOwnedDeletionCtx
): ChatOwnedDeletion {
  return {
    async deleteChat(chat) {
      const budget: DeletionBudget = { documents: 0, bytes: 0 }
      addToBudget(budget, [chat])

      const project = chat.projectId
        ? await ctx.db.get(chat.projectId)
        : null
      if (chat.projectId && !project) throw new Error("Project not found")
      if (project) addToBudget(budget, [project])

      const graph = await collectChatGraph(ctx, chat, budget)
      const storageIds = storedFileIds([graph])
      await assertWriteHeadroom(ctx, budget)

      // Storage participates in the mutation. Doing it before database writes
      // also leaves test fakes and local diagnostics free of partial DB state.
      await deleteStoredFiles(ctx, storageIds)
      await deleteChatChildren(ctx, graph)
      await recordKnownProjectActivity(ctx, project ?? undefined, Date.now())
      await ctx.db.delete(chat._id)
    },

    async deleteChatsForProject(project) {
      const budget: DeletionBudget = { documents: 0, bytes: 0 }
      // Reserve the Project root write even though the owning handler performs
      // it after this operation returns.
      addToBudget(budget, [project])

      const page = { numItems: CHAT_OWNED_DELETION_LIMITS.pageSize }
      const chats = await collectBounded(
        (cursor) =>
          ctx.db
            .query("chats")
            .withIndex("by_project", (q) =>
              q.eq("projectId", project._id)
            )
            .paginate({ ...page, cursor }),
        budget,
        CHAT_OWNED_DELETION_LIMITS.projectChats
      )

      const graphs: ChatGraph[] = []
      for (const chat of chats) {
        graphs.push(await collectChatGraph(ctx, chat, budget))
      }

      const storageIds = storedFileIds(graphs)
      await assertWriteHeadroom(ctx, budget)
      await deleteStoredFiles(ctx, storageIds)

      for (const graph of graphs) {
        await deleteChatChildren(ctx, graph)
        await ctx.db.delete(graph.chat._id)
      }
    },
  }
}
