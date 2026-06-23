import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type ConvexCtx = QueryCtx | MutationCtx

export type AuthenticatedChatOwner = {
  user: Doc<"users">
  chat: Doc<"chats">
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
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Not authenticated")

  const user = await getUserByWorkosSubject(ctx, identity.subject)
  const chat = await ctx.db.get(chatId)
  if (!chat) throw new Error("Chat not found")

  if (!user || chat.userId !== user._id) {
    throw new Error("Not authorized")
  }

  return { user, chat }
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
