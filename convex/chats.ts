import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { internalMutation, query } from "./_generated/server"
import { requireOwnedProject } from "./lib/auth"
import {
  authenticatedMutation,
  maybeAuthQuery,
  ownedChatMutation,
  readableChatQuery,
} from "./lib/authedFunctions"

// Upper bound on title-search results. The history search UI renders a flat
// list, so a bounded read is plenty and keeps the search subscription cheap.
const CHAT_SEARCH_RESULT_LIMIT = 50

/**
 * Get all chats for the current user
 */
export const getForCurrentUser = maybeAuthQuery({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return []

    const chats = await ctx.db
      .query("chats")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    // Sort: pinned first (by pinnedAt desc), then by updatedAt/createdAt desc
    return chats.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      if (a.pinned && b.pinned) {
        return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
      }
      const aTime = a.updatedAt ?? a._creationTime
      const bTime = b.updatedAt ?? b._creationTime
      return bTime - aTime
    })
  },
})

/**
 * Recency-ordered paginated read of the current user's chats over the
 * `by_user_updated` index. Powers the history drawer's browse-all mode and (with
 * the pinned split) the bounded sidebar window — see
 * docs/sidebar-chat-list-streaming-plan.md commits 4 and 8. Returns all the
 * caller's chats (pinned/project filtering is a client-side view concern,
 * `buildChatHistoryView`); a signed-out caller gets an empty, done page.
 */
export const listForCurrentUserPaginated = maybeAuthQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const user = ctx.user
    if (!user) {
      return { page: [], isDone: true, continueCursor: "" }
    }

    return await ctx.db
      .query("chats")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate(paginationOpts)
  },
})

/**
 * Title-only full-history search for the current user. Returns chats whose
 * title matches `term`, scoped to the caller via the search index's `userId`
 * filter field (so the search never ships another user's chats). A blank/empty
 * term returns [] without touching the table. Bounded to
 * CHAT_SEARCH_RESULT_LIMIT.
 *
 * This is the read that lets history search reach chats outside the bounded
 * sidebar window — see docs/sidebar-chat-list-streaming-plan.md commit 3. Scope
 * is title-only by design; message-content search would be a separate index on
 * `messages` and is out of scope.
 */
export const searchByTitle = maybeAuthQuery({
  args: { term: v.string() },
  handler: async (ctx, { term }) => {
    const user = ctx.user
    if (!user) return []

    const trimmed = term.trim()
    if (trimmed.length === 0) return []

    return await ctx.db
      .query("chats")
      .withSearchIndex("by_title", (q) =>
        q.search("title", trimmed).eq("userId", user._id)
      )
      .take(CHAT_SEARCH_RESULT_LIMIT)
  },
})

/**
 * Get a single chat by ID. Returns the chat if it is public (no auth required)
 * or the authenticated caller owns it; otherwise null.
 */
export const getById = readableChatQuery({
  args: {},
  handler: async (ctx) => ctx.chat,
})

/**
 * Create a new chat
 */
export const create = authenticatedMutation({
  args: {
    title: v.optional(v.string()),
    model: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    if (args.projectId) {
      await requireOwnedProject(ctx, args.projectId)
    }

    return await ctx.db.insert("chats", {
      userId: ctx.user._id,
      title: args.title ?? "New chat",
      model: args.model,
      systemPrompt: args.systemPrompt,
      projectId: args.projectId,
      public: false,
      pinned: false,
      updatedAt: Date.now(),
    })
  },
})

/**
 * Update chat title
 */
export const updateTitle = ownedChatMutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    await ctx.db.patch(ctx.chat._id, { title, updatedAt: Date.now() })
  },
})

/**
 * Update chat model
 */
export const updateModel = ownedChatMutation({
  args: { model: v.string() },
  handler: async (ctx, { model }) => {
    await ctx.db.patch(ctx.chat._id, { model, updatedAt: Date.now() })
  },
})

/**
 * Toggle chat pin status
 */
export const togglePin = ownedChatMutation({
  args: { pinned: v.boolean() },
  handler: async (ctx, { pinned }) => {
    await ctx.db.patch(ctx.chat._id, {
      pinned,
      pinnedAt: pinned ? Date.now() : undefined,
      updatedAt: Date.now(),
    })
  },
})

/**
 * Make a chat public (shareable via link)
 */
export const makePublic = ownedChatMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.db.patch(ctx.chat._id, { public: true, updatedAt: Date.now() })
  },
})

/**
 * Get a public chat by ID (no authentication required). Pure-public read with
 * no user concept — deliberately outside the authenticated-handler seam.
 */
export const getPublicById = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const chat = await ctx.db.get(chatId)
    if (!chat) return null

    // Only return if chat is public
    if (!chat.public) return null

    return chat
  },
})

/**
 * Defensive backfill for the `updatedAt` optional→required narrowing
 * (docs/sidebar-chat-list-streaming-plan.md commit 5). Sets
 * `updatedAt = _creationTime` for any chat missing it, so the `by_user_updated`
 * index has no null keys. Idempotent.
 *
 * `chats.create` has always set `updatedAt`, so in practice no live row lacks it
 * and the required-schema push succeeds directly. This exists only as a fallback
 * if a deployment somehow holds legacy rows: run it (via
 * `scripts/backfill-chat-updated-at.mjs`) while `updatedAt` is still optional,
 * before pushing the required schema. The localized cast reads the possibly-
 * undefined runtime value the narrowed type otherwise hides.
 */
export const backfillUpdatedAt = internalMutation({
  args: {},
  handler: async (ctx) => {
    const chats = await ctx.db.query("chats").collect()
    let patched = 0
    for (const chat of chats) {
      const current = (chat as { updatedAt?: number }).updatedAt
      if (current === undefined) {
        await ctx.db.patch(chat._id, { updatedAt: chat._creationTime })
        patched++
      }
    }
    return { total: chats.length, patched }
  },
})

/**
 * Delete a chat and its messages
 */
export const remove = ownedChatMutation({
  args: {},
  handler: async (ctx) => {
    const chatId = ctx.chat._id
    // Delete all messages for this chat
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()

    for (const message of messages) {
      await ctx.db.delete(message._id)
    }

    // Delete all attachments for this chat
    const attachments = await ctx.db
      .query("chatAttachments")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()

    for (const attachment of attachments) {
      // Delete from storage if exists
      if (attachment.storageId) {
        await ctx.storage.delete(attachment.storageId)
      }
      await ctx.db.delete(attachment._id)
    }

    // Delete the chat
    await ctx.db.delete(chatId)
  },
})
