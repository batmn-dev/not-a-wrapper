import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type ConvexCtx = QueryCtx | MutationCtx

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
export async function requireIdentity(ctx: ConvexCtx) {
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

export async function getAuthorizedChatForRead(
  ctx: ConvexCtx,
  chatId: Id<"chats">
): Promise<Doc<"chats"> | null> {
  const chat = await ctx.db.get(chatId)
  if (!chat) return null
  if (chat.public) return chat

  const user = await getCurrentUser(ctx)
  if (!user || chat.userId !== user._id) return null

  return chat
}

export async function requireOwnedChat(
  ctx: ConvexCtx,
  chatId: Id<"chats">
): Promise<AuthenticatedChatOwner> {
  const user = await requireUserForOwnedResource(ctx)
  const chat = await ctx.db.get(chatId)
  if (!chat) throw new Error("Chat not found")

  if (chat.userId !== user._id) {
    throw new Error("Not authorized")
  }

  return { user, chat }
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

  return { user, chat, run }
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
