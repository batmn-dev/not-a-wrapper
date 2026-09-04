import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type ConvexCtx = QueryCtx | MutationCtx
type ChatActivityCtx = Pick<QueryCtx, "db">
type IdentityCtx = Pick<QueryCtx, "auth">

export type AuthenticatedChatOwner = {
  user: Doc<"users">
  chat: Doc<"chats">
}

/**
 * A chat owner plus the generation run the caller is acting on. Ownership is
 * transitive: the run is reached through its `chatId`, so verifying the chat
 * owner verifies the run. Injected by `ownedGenerationRunMutation`.
 */
export type AuthenticatedRunOwner = AuthenticatedChatOwner & {
  run: Doc<"generationRuns">
}

/**
 * A run owner plus the tool approval request the caller is deciding on.
 * Ownership is transitive through approval → run → chat. Injected by
 * `ownedToolApprovalMutation`.
 */
export type AuthenticatedToolApprovalOwner = AuthenticatedRunOwner & {
  approval: Doc<"toolApprovalRequests">
}

/** A chat is active when neither it nor its linked project is being deleted.
 * The project read is required so tombstoning a project instantly revokes
 * every linked chat without patching children. Fail closed on a dangling
 * projectId (same policy as chat_project_link). */
export function isChatDocActive(chat: Doc<"chats">): boolean {
  return chat.deletingAt === undefined
}

export async function isChatActive(
  ctx: ChatActivityCtx,
  chat: Doc<"chats">
): Promise<boolean> {
  if (!isChatDocActive(chat)) return false
  if (!chat.projectId) return true
  const project = await ctx.db.get(chat.projectId)
  return project !== null && project.deletingAt === undefined
}

/**
 * Parent-aware projection for bounded Chat result sets. Project ids are
 * de-duplicated so a page containing siblings reads each logical root once;
 * missing projects fail closed like `isChatActive`.
 */
export async function filterActiveChats(
  ctx: ChatActivityCtx,
  chats: readonly Doc<"chats">[]
): Promise<Doc<"chats">[]> {
  const rootActiveChats = chats.filter(isChatDocActive)
  const projectIds = [
    ...new Set(
      rootActiveChats.flatMap((chat) =>
        chat.projectId ? [chat.projectId] : []
      )
    ),
  ]
  const projects = await Promise.all(
    projectIds.map(async (projectId) => await ctx.db.get(projectId))
  )
  const activeProjectIds = new Set(
    projects
      .filter(
        (project): project is Doc<"projects"> =>
          project !== null && project.deletingAt === undefined
      )
      .map((project) => project._id)
  )

  return rootActiveChats.filter(
    (chat) => !chat.projectId || activeProjectIds.has(chat.projectId)
  )
}

async function getUserByWorkosSubject(ctx: ConvexCtx, subject: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", subject))
    .unique()
}

export async function getCurrentUser(
  ctx: ConvexCtx
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return null

  return await getUserByWorkosSubject(ctx, identity.subject)
}

/**
 * Resolve both the raw identity and the synced user row, each nullable. For
 * optional-auth / anonymous paths that must distinguish "no identity" (a guest)
 * from "identity present but user not synced yet" (deny), a distinction a plain
 * user-or-null lookup collapses.
 */
export async function getOptionalAuth(ctx: ConvexCtx): Promise<{
  identity: Awaited<ReturnType<ConvexCtx["auth"]["getUserIdentity"]>>
  user: Doc<"users"> | null
}> {
  const identity = await ctx.auth.getUserIdentity()
  const user = identity
    ? await getUserByWorkosSubject(ctx, identity.subject)
    : null
  return { identity, user }
}

/**
 * Require a signed-in caller's raw identity (throws if absent) without resolving
 * the user row. For self-identity-match handlers that compare `identity.subject`
 * to a client argument, and the create-user bootstrap path where the row may not
 * exist yet.
 */
export async function requireIdentity(ctx: IdentityCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Not authenticated")
  return identity
}

export async function requireCurrentUser(
  ctx: ConvexCtx
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Not authenticated")

  const user = await getUserByWorkosSubject(ctx, identity.subject)
  if (!user) throw new Error("User not found")

  return user
}

/**
 * The client-facing chat lookup (ADR-0033): clients only ever name a chat by
 * its client-minted `publicId`; `_id` never crosses the boundary. Unique by
 * construction (creation is idempotent on publicId in one transaction).
 */
export async function findChatByPublicId(
  ctx: ChatActivityCtx,
  publicId: string
): Promise<Doc<"chats"> | null> {
  return await ctx.db
    .query("chats")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique()
}

async function authorizeChatForRead(
  ctx: ConvexCtx,
  chat: Doc<"chats"> | null
): Promise<Doc<"chats"> | null> {
  if (!chat) return null
  if (!(await isChatActive(ctx, chat))) return null
  if (chat.public) return chat

  const user = await getCurrentUser(ctx)
  if (!user || chat.userId !== user._id) return null

  return chat
}

export async function getAuthorizedChatForRead(
  ctx: ConvexCtx,
  chatId: Id<"chats">
): Promise<Doc<"chats"> | null> {
  return await authorizeChatForRead(ctx, await ctx.db.get(chatId))
}

/** Boundary read: the owner, or anyone when the chat is public. */
export async function getReadableChatByPublicId(
  ctx: ConvexCtx,
  publicId: string
): Promise<Doc<"chats"> | null> {
  return await authorizeChatForRead(ctx, await findChatByPublicId(ctx, publicId))
}

// Authenticate BEFORE the chat read: an unauthenticated caller never touches
// the chat row, and the same predicate serves both id shapes.
async function requireOwnedChatDoc(
  ctx: ConvexCtx,
  loadChat: () => Promise<Doc<"chats"> | null>
): Promise<AuthenticatedChatOwner> {
  const user = await requireUserForOwnedResource(ctx)
  const chat = await loadChat()
  if (!chat) throw new Error("Chat not found")

  if (chat.userId !== user._id) {
    throw new Error("Not authorized")
  }
  if (!(await isChatActive(ctx, chat))) throw new Error("Chat not found")

  return { user, chat }
}

export async function requireOwnedChat(
  ctx: ConvexCtx,
  chatId: Id<"chats">
): Promise<AuthenticatedChatOwner> {
  return await requireOwnedChatDoc(ctx, () => ctx.db.get(chatId))
}

/**
 * Boundary ownership check: resolves a client `publicId` to the owner-verified
 * chat exactly once, so no handler behind it ever sees an unresolved id.
 */
export async function requireOwnedChatByPublicId(
  ctx: ConvexCtx,
  publicId: string
): Promise<AuthenticatedChatOwner> {
  return await requireOwnedChatDoc(ctx, () =>
    findChatByPublicId(ctx, publicId)
  )
}

async function requireUserForOwnedResource(
  ctx: ConvexCtx
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Not authenticated")

  const user = await getUserByWorkosSubject(ctx, identity.subject)
  if (!user) throw new Error("Not authorized")

  return user
}

/**
 * Require the caller to own a generation run without exposing whether another
 * user's run exists. Auth is resolved before reading `generationRuns`, then
 * missing, not-owned, and broken-link rows all collapse to "Run not found".
 * Returns the owner-verified user, chat, and run. Backs
 * `ownedGenerationRunMutation`.
 */
export async function requireOwnedGenerationRun(
  ctx: ConvexCtx,
  runId: Id<"generationRuns">
): Promise<AuthenticatedRunOwner> {
  const user = await requireUserForOwnedResource(ctx)
  const run = await ctx.db.get(runId)
  if (!run) throw new Error("Run not found")
  if (run.userId !== user._id) throw new Error("Run not found")

  const chat = await ctx.db.get(run.chatId)
  if (!chat || chat.userId !== user._id) throw new Error("Run not found")
  if (!(await isChatActive(ctx, chat))) throw new Error("Run not found")

  return { user, chat, run }
}

/**
 * Require the caller to own a tool approval request, keyed by the public
 * `approvalId`. Same shape as `requireOwnedGenerationRun`: auth first, then
 * missing, not-owned, and broken-link rows all collapse to "Approval not
 * found". Backs `ownedToolApprovalMutation`.
 */
export async function requireOwnedToolApproval(
  ctx: ConvexCtx,
  approvalId: string
): Promise<AuthenticatedToolApprovalOwner> {
  const user = await requireUserForOwnedResource(ctx)
  const approval = await ctx.db
    .query("toolApprovalRequests")
    .withIndex("by_approval", (q) => q.eq("approvalId", approvalId))
    .unique()
  if (!approval || approval.userId !== user._id) {
    throw new Error("Approval not found")
  }

  const run = await ctx.db.get(approval.runId)
  if (!run) throw new Error("Approval not found")

  const chat = await ctx.db.get(run.chatId)
  if (!chat || chat.userId !== user._id) throw new Error("Approval not found")
  if (!(await isChatActive(ctx, chat))) throw new Error("Approval not found")

  return { user, chat, run, approval }
}

export async function requireOwnedProject(
  ctx: ConvexCtx,
  projectId: Id<"projects">
): Promise<{ user: Doc<"users">; project: Doc<"projects"> }> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Not authenticated")

  const user = await getUserByWorkosSubject(ctx, identity.subject)
  const project = await ctx.db.get(projectId)
  if (!project) throw new Error("Project not found")

  if (!user || project.userId !== user._id) {
    throw new Error("Not authorized")
  }
  if (project.deletingAt !== undefined) throw new Error("Project not found")

  return { user, project }
}

export async function requireOwnedMcpServer(
  ctx: ConvexCtx,
  serverId: Id<"mcpServers">
): Promise<{ user: Doc<"users">; server: Doc<"mcpServers"> }> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Not authenticated")

  const user = await getUserByWorkosSubject(ctx, identity.subject)
  const server = await ctx.db.get(serverId)
  if (!server) throw new Error("MCP server not found")

  if (!user || server.userId !== user._id) {
    throw new Error("Not authorized")
  }

  return { user, server }
}
