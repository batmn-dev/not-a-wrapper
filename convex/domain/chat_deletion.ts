import { getConvexSize, type Value } from "convex/values"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { closeSupersededGenerationsForChat } from "../chatRuntime"
import { takeLinkedChats } from "./chat_project_link"

export const DELETION_PHASES = [
  "toolInvocations",
  "toolApprovalRequests",
  "toolCallLog",
  "messages",
  "generationRuns",
  "attachments", // includes stored-file reference handling
  "chatRoot",
] as const
// Project jobs: phase "chats" (drain linked chats through the phases above,
// one chat at a time via job.chatId), then "projectRoot".

export const DELETION_BATCH = {
  numItems: 200,
  maximumRowsRead: 400,
  maximumBytesRead: 2 * 1024 * 1024,
  attachmentsPerBatch: 25,
} as const

type ChatDeletionPhase = (typeof DELETION_PHASES)[number]
type ChildDeletionPhase = Exclude<
  ChatDeletionPhase,
  "attachments" | "chatRoot"
>

const CHILD_DELETION_PHASES: readonly ChildDeletionPhase[] = [
  "toolInvocations",
  "toolApprovalRequests",
  "toolCallLog",
  "messages",
  "generationRuns",
]

type ChatDeletionCtx = MutationCtx

type ChildRow =
  | Doc<"toolInvocations">
  | Doc<"toolApprovalRequests">
  | Doc<"toolCallLog">
  | Doc<"messages">
  | Doc<"generationRuns">

type ChildPage = {
  page: ChildRow[]
}

type BatchProgress = {
  documentsDeleted: number
  bytesObserved: number
}

type ChatBatchResult = {
  phase: string
  chatId?: Id<"chats">
  complete: boolean
}

class DeletionFailure extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function invariant(condition: unknown): asserts condition {
  if (!condition) throw new DeletionFailure("invariant_violation")
}

function isChildDeletionPhase(phase: string): phase is ChildDeletionPhase {
  return (CHILD_DELETION_PHASES as readonly string[]).includes(phase)
}

function nextChatPhase(phase: ChatDeletionPhase): ChatDeletionPhase {
  const index = DELETION_PHASES.indexOf(phase)
  invariant(index >= 0 && index < DELETION_PHASES.length - 1)
  return DELETION_PHASES[index + 1]
}

async function paginateChildPhase(
  ctx: ChatDeletionCtx,
  phase: ChildDeletionPhase,
  chatId: Id<"chats">
): Promise<ChildPage> {
  const paginationOptions = {
    cursor: null,
    numItems: DELETION_BATCH.numItems,
    maximumRowsRead: DELETION_BATCH.maximumRowsRead,
    maximumBytesRead: DELETION_BATCH.maximumBytesRead,
  }

  switch (phase) {
    case "toolInvocations":
      return await ctx.db
        .query("toolInvocations")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .paginate(paginationOptions)
    case "toolApprovalRequests":
      return await ctx.db
        .query("toolApprovalRequests")
        .withIndex("by_chat_status", (q) => q.eq("chatId", chatId))
        .paginate(paginationOptions)
    case "toolCallLog":
      return await ctx.db
        .query("toolCallLog")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .paginate(paginationOptions)
    case "messages":
      return await ctx.db
        .query("messages")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .paginate(paginationOptions)
    case "generationRuns":
      return await ctx.db
        .query("generationRuns")
        .withIndex("by_chat", (q) => q.eq("chatId", chatId))
        .paginate(paginationOptions)
  }
}

async function deleteRow(
  ctx: ChatDeletionCtx,
  row: ChildRow | Doc<"chatAttachments"> | Doc<"chats"> | Doc<"projects">,
  progress: BatchProgress
): Promise<void> {
  await ctx.db.delete(row._id)
  progress.documentsDeleted++
  progress.bytesObserved += getConvexSize(row as unknown as Value)
}

function isMissingStorageError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("already deleted")
  )
}

async function deleteAttachmentsBatch(
  ctx: ChatDeletionCtx,
  chatId: Id<"chats">,
  progress: BatchProgress
): Promise<ChatDeletionPhase> {
  const attachments = await ctx.db
    .query("chatAttachments")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETION_BATCH.attachmentsPerBatch + 1)

  if (attachments.length === 0) return "chatRoot"

  for (const attachment of attachments.slice(
    0,
    DELETION_BATCH.attachmentsPerBatch
  )) {
    if (attachment.storageId) {
      const references = await ctx.db
        .query("chatAttachments")
        .withIndex("by_storage", (q) =>
          q.eq("storageId", attachment.storageId)
        )
        .take(2)
      if (
        references.length === 1 &&
        references[0]?._id === attachment._id
      ) {
        try {
          await ctx.storage.delete(attachment.storageId)
        } catch (error) {
          if (!isMissingStorageError(error)) {
            throw new DeletionFailure("storage_delete_failed")
          }
        }
      }
    }
    await deleteRow(ctx, attachment, progress)
  }

  return "attachments"
}

async function firstRemainingPhase(
  ctx: ChatDeletionCtx,
  chatId: Id<"chats">
): Promise<Exclude<ChatDeletionPhase, "chatRoot"> | null> {
  if (
    await ctx.db
      .query("toolInvocations")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .first()
  ) {
    return "toolInvocations"
  }
  if (
    await ctx.db
      .query("toolApprovalRequests")
      .withIndex("by_chat_status", (q) => q.eq("chatId", chatId))
      .first()
  ) {
    return "toolApprovalRequests"
  }
  if (
    await ctx.db
      .query("toolCallLog")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .first()
  ) {
    return "toolCallLog"
  }
  if (
    await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .first()
  ) {
    return "messages"
  }
  if (
    await ctx.db
      .query("generationRuns")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .first()
  ) {
    return "generationRuns"
  }
  if (
    await ctx.db
      .query("chatAttachments")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .first()
  ) {
    return "attachments"
  }
  return null
}

async function runChatBatch(
  ctx: ChatDeletionCtx,
  job: Doc<"deletionJobs">,
  chatId: Id<"chats">,
  progress: BatchProgress
): Promise<ChatBatchResult> {
  const phase =
    job.targetKind === "project" && job.phase === "chats"
      ? DELETION_PHASES[0]
      : job.phase

  if (isChildDeletionPhase(phase)) {
    const rows = await paginateChildPhase(ctx, phase, chatId)
    for (const row of rows.page) {
      await deleteRow(ctx, row, progress)
    }
    return {
      phase: rows.page.length === 0 ? nextChatPhase(phase) : phase,
      chatId,
      complete: false,
    }
  }

  if (phase === "attachments") {
    return {
      phase: await deleteAttachmentsBatch(ctx, chatId, progress),
      chatId,
      complete: false,
    }
  }

  invariant(phase === "chatRoot")
  const chat = await ctx.db.get(chatId)
  if (chat) {
    const remainingPhase = await firstRemainingPhase(ctx, chatId)
    if (remainingPhase) {
      return { phase: remainingPhase, chatId, complete: false }
    }
    await deleteRow(ctx, chat, progress)
  }

  if (job.targetKind === "chat") {
    return { phase: "chatRoot", chatId, complete: true }
  }
  return { phase: "chats", chatId: undefined, complete: false }
}

async function runProjectBatch(
  ctx: ChatDeletionCtx,
  job: Doc<"deletionJobs">,
  progress: BatchProgress
): Promise<ChatBatchResult> {
  invariant(job.projectId)

  if (job.phase === "projectRoot") {
    const project = await ctx.db.get(job.projectId)
    invariant(project)
    await deleteRow(ctx, project, progress)
    return { phase: "projectRoot", complete: true }
  }

  if (job.chatId) {
    return await runChatBatch(ctx, job, job.chatId, progress)
  }

  invariant(job.phase === "chats")
  const project = await ctx.db.get(job.projectId)
  invariant(project)
  const chats = await takeLinkedChats(ctx, project, 2)
  const chat = chats[0]
  if (!chat) return { phase: "projectRoot", complete: false }

  // Project deletion reaches chats through this worker rather than
  // chats.remove. Close and defer live runs before any child row can be
  // deleted, using the same lifecycle path as direct Chat deletion.
  await closeSupersededGenerationsForChat(
    ctx,
    chat._id,
    job.userId,
    Date.now()
  )
  if (chat.deletingAt === undefined) {
    await ctx.db.patch(chat._id, { deletingAt: Date.now() })
  }
  return { phase: "chats", chatId: chat._id, complete: false }
}

async function findActiveChatJob(
  ctx: ChatDeletionCtx,
  chatId: Id<"chats">
): Promise<Doc<"deletionJobs"> | null> {
  return await ctx.db
    .query("deletionJobs")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .filter((q) => q.neq(q.field("state"), "complete"))
    .first()
}

async function findActiveProjectJob(
  ctx: ChatDeletionCtx,
  projectId: Id<"projects">
): Promise<Doc<"deletionJobs"> | null> {
  return await ctx.db
    .query("deletionJobs")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .filter((q) => q.neq(q.field("state"), "complete"))
    .first()
}

export async function ensureChatDeletionJob(
  ctx: ChatDeletionCtx,
  chat: Doc<"chats">,
  user: Doc<"users">
): Promise<Doc<"deletionJobs">> {
  const existing = await findActiveChatJob(ctx, chat._id)
  if (existing) return existing

  const now = Date.now()
  const jobId = await ctx.db.insert("deletionJobs", {
    targetKind: "chat",
    chatId: chat._id,
    userId: user._id,
    state: "pending",
    phase: DELETION_PHASES[0],
    version: 1,
    batchesProcessed: 0,
    documentsDeleted: 0,
    bytesObserved: 0,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  })
  const job = await ctx.db.get(jobId)
  invariant(job)
  return job
}

export async function ensureProjectDeletionJob(
  ctx: ChatDeletionCtx,
  project: Doc<"projects">,
  user: Doc<"users">
): Promise<Doc<"deletionJobs">> {
  const existing = await findActiveProjectJob(ctx, project._id)
  if (existing) return existing

  const now = Date.now()
  const jobId = await ctx.db.insert("deletionJobs", {
    targetKind: "project",
    projectId: project._id,
    userId: user._id,
    state: "pending",
    phase: "chats",
    version: 1,
    batchesProcessed: 0,
    documentsDeleted: 0,
    bytesObserved: 0,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  })
  const job = await ctx.db.get(jobId)
  invariant(job)
  return job
}

export async function runDeletionBatchImpl(
  ctx: ChatDeletionCtx,
  jobId: Id<"deletionJobs">
): Promise<void> {
  const job = await ctx.db.get(jobId)
  if (!job || job.state === "complete" || job.state === "blocked") return

  const now = Date.now()
  await ctx.db.patch(job._id, { state: "running", updatedAt: now })
  const progress: BatchProgress = {
    documentsDeleted: 0,
    bytesObserved: 0,
  }

  try {
    let result: ChatBatchResult
    if (job.targetKind === "chat") {
      invariant(job.chatId)
      result = await runChatBatch(ctx, job, job.chatId, progress)
    } else {
      result = await runProjectBatch(ctx, job, progress)
    }

    await ctx.db.patch(job._id, {
      state: result.complete ? "complete" : "running",
      phase: result.phase,
      chatId: result.chatId,
      batchesProcessed: job.batchesProcessed + 1,
      documentsDeleted: job.documentsDeleted + progress.documentsDeleted,
      bytesObserved: job.bytesObserved + progress.bytesObserved,
      failureCode: undefined,
      updatedAt: now,
      completedAt: result.complete ? now : undefined,
    })

    if (!result.complete) {
      await ctx.scheduler.runAfter(
        0,
        internal.deletionCleanup.runDeletionBatch,
        { jobId }
      )
    }
  } catch (error) {
    await ctx.db.patch(job._id, {
      state: "blocked",
      batchesProcessed: job.batchesProcessed + 1,
      documentsDeleted: job.documentsDeleted + progress.documentsDeleted,
      bytesObserved: job.bytesObserved + progress.bytesObserved,
      retryCount: job.retryCount + 1,
      failureCode:
        error instanceof DeletionFailure ? error.code : "batch_failed",
      updatedAt: now,
    })
  }
}
