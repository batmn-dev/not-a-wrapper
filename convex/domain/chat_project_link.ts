import type { Doc } from "../_generated/dataModel"
import type { QueryCtx } from "../_generated/server"

type ChatProjectLinkCtx = Pick<QueryCtx, "db">

/**
 * The single sanctioned Chat<->Project traversal.
 *
 * `chat.projectId` is established under `requireOwnedProject` at its only
 * write site (chats.create), so a stored link always joins documents with the
 * same owner. Consumers must not re-derive the join from `chat.projectId` or
 * the `by_project` indexes directly: every traversal here re-checks the owner
 * pair and fails closed, so corrupted or legacy cross-owner links surface as
 * errors instead of silently reading or mutating another user's data. This is
 * the same move `lib/authedFunctions.ts` makes for root ownership — an
 * invariant a consumer cannot forget to check — applied to the relationship.
 *
 * A mismatch always throws rather than filtering: a filtered row would strand
 * the corruption (e.g. a foreign chat left dangling after its project's
 * deletion) and hide that the write-boundary guarantee was violated.
 */
export const CHAT_PROJECT_LINK_OWNER_ERROR = "Chat-Project link crosses owners"

function assertLinkedOwners(
  chat: Doc<"chats">,
  project: Doc<"projects">
): void {
  if (chat.userId !== project.userId) {
    throw new Error(CHAT_PROJECT_LINK_OWNER_ERROR)
  }
}

/**
 * Resolve a chat's parent project, or null for a non-project chat. Throws on
 * a dangling reference or a cross-owner link.
 */
export async function requireLinkedProject(
  ctx: ChatProjectLinkCtx,
  chat: Doc<"chats">
): Promise<Doc<"projects"> | null> {
  if (!chat.projectId) return null

  const project = await ctx.db.get(chat.projectId)
  if (!project) throw new Error("Project not found")
  assertLinkedOwners(chat, project)
  return project
}

/**
 * All chats linked to a project, unordered. For query handlers, which may not
 * paginate more than once per execution.
 */
export async function collectLinkedChats(
  ctx: ChatProjectLinkCtx,
  project: Doc<"projects">
): Promise<Doc<"chats">[]> {
  const chats = await ctx.db
    .query("chats")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect()
  for (const chat of chats) {
    assertLinkedOwners(chat, project)
  }
  return chats
}

/**
 * A bounded prefix of chats linked to a project. Deletion preflights request
 * one row beyond their remaining limit, so a full result proves overflow
 * without using Convex pagination (a function may execute only one paginated
 * database query).
 */
export async function takeLinkedChats(
  ctx: ChatProjectLinkCtx,
  project: Doc<"projects">,
  limit: number
): Promise<Doc<"chats">[]> {
  const chats = await ctx.db
    .query("chats")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .take(limit)
  for (const chat of chats) {
    assertLinkedOwners(chat, project)
  }
  return chats
}

/** The project's most recently active linked chat, if any. */
export async function newestLinkedChat(
  ctx: ChatProjectLinkCtx,
  project: Doc<"projects">
): Promise<Doc<"chats"> | null> {
  const chat = await ctx.db
    .query("chats")
    .withIndex("by_project_updated", (q) => q.eq("projectId", project._id))
    .order("desc")
    .first()
  if (chat) assertLinkedOwners(chat, project)
  return chat
}
