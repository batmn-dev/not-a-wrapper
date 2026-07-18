import type { Doc } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { requireLinkedProject } from "./chat_project_link"

type ActivityMutationCtx = Pick<MutationCtx, "db">

type ProjectActivityPatch = Partial<
  Omit<Doc<"projects">, "_id" | "_creationTime" | "userId" | "updatedAt">
>

type ChatActivityPatch = Partial<
  Omit<
    Doc<"chats">,
    "_id" | "_creationTime" | "userId" | "projectId" | "updatedAt"
  >
>

/**
 * The project directory's canonical modification timestamp. Legacy rows use
 * their creation time until the production-safe optional field is backfilled
 * or the project receives new activity.
 */
export function getProjectModifiedAt(
  project: Pick<Doc<"projects">, "_creationTime" | "updatedAt">
): number {
  return project.updatedAt ?? project._creationTime
}

/** Record activity when the caller already resolved the parent project. */
export async function recordKnownProjectActivity(
  ctx: ActivityMutationCtx,
  project: Doc<"projects"> | undefined,
  occurredAt: number
): Promise<void> {
  if (!project) return
  if (occurredAt <= getProjectModifiedAt(project)) return

  await ctx.db.patch(project._id, { updatedAt: occurredAt })
}

/**
 * Patch project metadata and its activity timestamp atomically. Project write
 * paths use this instead of remembering a separate timestamp patch.
 */
export async function patchProjectActivity(
  ctx: ActivityMutationCtx,
  project: Doc<"projects">,
  patch: ProjectActivityPatch,
  occurredAt: number
): Promise<void> {
  await ctx.db.patch(project._id, {
    ...patch,
    updatedAt: Math.max(getProjectModifiedAt(project), occurredAt),
  })
}

/**
 * Patch a chat and propagate the same monotonic activity timestamp to its
 * parent project. Non-project chats retain the existing single-document write.
 * Project reassignment is deliberately excluded from this patch type because
 * a move must update both the old and new parent aggregates explicitly.
 */
export async function patchChatActivity(
  ctx: ActivityMutationCtx,
  chat: Doc<"chats">,
  patch: ChatActivityPatch,
  occurredAt: number
): Promise<void> {
  // Resolve (and owner-check) the parent before the chat write so a corrupted
  // link fails before any document changes.
  const project = await requireLinkedProject(ctx, chat)
  const activityAt = Math.max(chat.updatedAt, occurredAt)
  await ctx.db.patch(chat._id, { ...patch, updatedAt: activityAt })
  await recordKnownProjectActivity(ctx, project ?? undefined, activityAt)
}

/** Record chat activity when no other chat fields need to change. */
export async function recordChatActivity(
  ctx: ActivityMutationCtx,
  chat: Doc<"chats">,
  occurredAt: number
): Promise<void> {
  await patchChatActivity(ctx, chat, {}, occurredAt)
}
