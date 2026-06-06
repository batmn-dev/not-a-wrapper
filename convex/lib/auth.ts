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
  const chat = await ctx.db.get(chatId)
  if (!chat) throw new Error("Chat not found")

  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Not authenticated")

  const user = await getUserByWorkosSubject(ctx, identity.subject)
  if (!user || chat.userId !== user._id) {
    throw new Error("Not authorized")
  }

  return { user, chat }
}

export async function requireOwnedProject(
  ctx: ConvexCtx,
  projectId: Id<"projects">
): Promise<{ user: Doc<"users">; project: Doc<"projects"> }> {
  const project = await ctx.db.get(projectId)
  if (!project) throw new Error("Project not found")

  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Not authenticated")

  const user = await getUserByWorkosSubject(ctx, identity.subject)
  if (!user || project.userId !== user._id) {
    throw new Error("Not authorized")
  }

  return { user, project }
}
