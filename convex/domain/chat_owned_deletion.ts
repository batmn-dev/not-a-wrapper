import { getConvexSize, type Value } from "convex/values"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { requireLinkedProject, takeLinkedChats } from "./chat_project_link"
import { recordKnownProjectActivity } from "./project_activity"

type ChatOwnedDeletionCtx = Pick<MutationCtx, "db" | "meta" | "storage">

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
  transactionDocumentReserve: 32,
  transactionByteReserve: 1024 * 1024,
  transactionReadDocumentReserve: 2_000,
  transactionReadByteReserve: 2 * 1024 * 1024,
  transactionQueryReserve: 128,
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

function nextRangeReadLimit(
  budget: DeletionBudget,
  rangeLimit?: number
): number {
  const remainingDocuments =
    CHAT_OWNED_DELETION_LIMITS.documents - budget.documents
  if (remainingDocuments < 0) throwLimitError()

  // Read one beyond the tightest remaining limit. Returning fewer rows proves
  // the indexed range is complete; returning the sentinel row fails preflight.
  return Math.min(remainingDocuments, rangeLimit ?? remainingDocuments) + 1
}

async function collectBounded<T>(
  loadRange: (limit: number) => Promise<T[]>,
  budget: DeletionBudget,
  rangeLimit?: number
): Promise<T[]> {
  const rows = await loadRange(nextRangeReadLimit(budget, rangeLimit))
  if (rangeLimit !== undefined && rows.length > rangeLimit) {
    throwLimitError()
  }
  addToBudget(budget, rows)
  return rows
}

async function collectChatGraph(
  ctx: ChatOwnedDeletionCtx,
  chat: Doc<"chats">,
  budget: DeletionBudget
): Promise<ChatGraph> {
  const chatId = chat._id

  const messages = await collectBounded(
    (limit) =>
      ctx.db
        .query("messages")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .take(limit),
    budget
  )
  const generationRuns = await collectBounded(
    (limit) =>
      ctx.db
        .query("generationRuns")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .take(limit),
    budget
  )
  const assistantMessageSnapshots = await collectBounded(
    (limit) =>
      ctx.db
        .query("assistantMessageSnapshots")
        .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
        .take(limit),
    budget
  )
  const toolInvocations = await collectBounded(
    (limit) =>
      ctx.db
        .query("toolInvocations")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .take(limit),
    budget
  )
  const toolApprovalRequests = await collectBounded(
    (limit) =>
      ctx.db
        .query("toolApprovalRequests")
        .withIndex("by_chat_status", (q) => q.eq("chatId", chatId))
        .take(limit),
    budget
  )
  const toolCallLogs = await collectBounded(
    (limit) =>
      ctx.db
        .query("toolCallLog")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .take(limit),
    budget
  )
  const attachments = await collectBounded(
    (limit) =>
      ctx.db
        .query("chatAttachments")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .take(limit),
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

async function exclusiveStoredFileIds(
  ctx: ChatOwnedDeletionCtx,
  graphs: readonly ChatGraph[]
): Promise<Id<"_storage">[]> {
  const targetReferenceCounts = new Map<Id<"_storage">, number>()
  for (const graph of graphs) {
    for (const attachment of graph.attachments) {
      if (!attachment.storageId) continue
      targetReferenceCounts.set(
        attachment.storageId,
        (targetReferenceCounts.get(attachment.storageId) ?? 0) + 1
      )
    }
  }

  if (targetReferenceCounts.size > CHAT_OWNED_DELETION_LIMITS.storedFiles) {
    throwLimitError()
  }

  const exclusiveIds: Id<"_storage">[] = []
  for (const [storageId, targetReferenceCount] of targetReferenceCounts) {
    // Every target reference is still present in this transaction snapshot.
    // One additional row is therefore enough to prove that the blob is shared
    // outside the graphs being deleted, without collecting an unbounded range.
    const references = await ctx.db
      .query("chatAttachments")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .take(targetReferenceCount + 1)
    if (references.length === targetReferenceCount) {
      exclusiveIds.push(storageId)
    }
  }

  return exclusiveIds
}

async function assertTransactionHeadroom(
  ctx: ChatOwnedDeletionCtx,
  budget: DeletionBudget,
  storedFileCount: number
): Promise<void> {
  const metrics = await ctx.meta.getTransactionMetrics()
  const documentHeadroom =
    metrics.documentsWritten.remaining -
    CHAT_OWNED_DELETION_LIMITS.transactionDocumentReserve
  const byteHeadroom =
    metrics.bytesWritten.remaining -
    CHAT_OWNED_DELETION_LIMITS.transactionByteReserve

  if (
    budget.documents + storedFileCount > documentHeadroom ||
    budget.bytes > byteHeadroom ||
    metrics.documentsRead.remaining <
      CHAT_OWNED_DELETION_LIMITS.transactionReadDocumentReserve ||
    metrics.bytesRead.remaining <
      CHAT_OWNED_DELETION_LIMITS.transactionReadByteReserve ||
    metrics.databaseQueries.remaining <
      CHAT_OWNED_DELETION_LIMITS.transactionQueryReserve
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
 * Chat<->Project hops go through `chat_project_link`, so a corrupted
 * cross-owner link fails closed before any read is budgeted or any write runs.
 */
export function createChatOwnedDeletion(
  ctx: ChatOwnedDeletionCtx
): ChatOwnedDeletion {
  return {
    async deleteChat(chat) {
      const budget: DeletionBudget = { documents: 0, bytes: 0 }
      addToBudget(budget, [chat])

      const project = await requireLinkedProject(ctx, chat)
      if (project) addToBudget(budget, [project])

      const graph = await collectChatGraph(ctx, chat, budget)
      const storageIds = await exclusiveStoredFileIds(ctx, [graph])
      await assertTransactionHeadroom(ctx, budget, storageIds.length)

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

      const chats = await collectBounded(
        (limit) => takeLinkedChats(ctx, project, limit),
        budget,
        CHAT_OWNED_DELETION_LIMITS.projectChats
      )

      const graphs: ChatGraph[] = []
      for (const chat of chats) {
        graphs.push(await collectChatGraph(ctx, chat, budget))
      }

      const storageIds = await exclusiveStoredFileIds(ctx, graphs)
      await assertTransactionHeadroom(ctx, budget, storageIds.length)
      await deleteStoredFiles(ctx, storageIds)

      for (const graph of graphs) {
        await deleteChatChildren(ctx, graph)
        await ctx.db.delete(graph.chat._id)
      }
    },
  }
}
