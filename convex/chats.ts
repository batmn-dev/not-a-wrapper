import { paginationOptsValidator, type PaginationOptions } from "convex/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { internalMutation, query, type QueryCtx } from "./_generated/server"
import { requireOwnedProject } from "./lib/auth"
import {
  authenticatedMutation,
  maybeAuthQuery,
  ownedChatMutation,
  ownedProjectQuery,
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
 * The current user's pinned, non-project chats over the composite sidebar
 * index — a small, live read rendered as its own sidebar section alongside the
 * paginated recency window (ADR-0005). Kept separate so pinned chats stay
 * visible even when they fall outside the bounded window, while project chats
 * stay owned by the project view.
 */
type MaybeUserChatQueryCtx = Pick<QueryCtx, "db"> & {
  user: Doc<"users"> | null
}

export async function getPinnedForCurrentUserHandler(
  ctx: MaybeUserChatQueryCtx
) {
  const user = ctx.user
  if (!user) return []

  return await ctx.db
    .query("chats")
    .withIndex("by_user_pinned_project_updated", (q) =>
      q.eq("userId", user._id).eq("pinned", true).eq("projectId", undefined)
    )
    .collect()
}

export const getPinnedForCurrentUser = maybeAuthQuery({
  args: {},
  handler: async (ctx) => getPinnedForCurrentUserHandler(ctx),
})

/**
 * Recency-ordered paginated read of the current user's non-project chats over
 * the `by_user_project_updated` index, returning pinned + plain chats. Powers
 * the history drawer's browse-all mode, where project chats are hidden before
 * rendering. Filtering project chats at the index level keeps every page full
 * of rows the drawer can display; title search and project pages reach project
 * chats through their own reads. A signed-out caller gets an empty, done page.
 * See docs/adr/0005-bounded-chat-list-window.md.
 */
export async function listForCurrentUserPaginatedHandler(
  ctx: MaybeUserChatQueryCtx,
  paginationOpts: PaginationOptions
) {
  const user = ctx.user
  if (!user) {
    return { page: [], isDone: true, continueCursor: "" }
  }

  return await ctx.db
    .query("chats")
    .withIndex("by_user_project_updated", (q) =>
      q.eq("userId", user._id).eq("projectId", undefined)
    )
    .order("desc")
    .paginate(paginationOpts)
}

export const listForCurrentUserPaginated = maybeAuthQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) =>
    listForCurrentUserPaginatedHandler(ctx, paginationOpts),
})

/**
 * The bounded sidebar "Chats" window: the current user's non-pinned, non-project
 * chats newest-first. Pinned/project exclusion is done at the index level
 * (`by_user_pinned_project_updated`), not client-side, so each page is full of
 * chats the sidebar actually renders — pinned/project chats never consume a
 * window slot. Pinned chats are read separately (`getPinnedForCurrentUser`);
 * project chats live in the project view (`getProjectChatsForCurrentUser`). See
 * docs/adr/0005-bounded-chat-list-window.md.
 */
export const getRecentWindowForCurrentUser = maybeAuthQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const user = ctx.user
    if (!user) {
      return { page: [], isDone: true, continueCursor: "" }
    }

    return await ctx.db
      .query("chats")
      .withIndex("by_user_pinned_project_updated", (q) =>
        q.eq("userId", user._id).eq("pinned", false).eq("projectId", undefined)
      )
      .order("desc")
      .paginate(paginationOpts)
  },
})

/**
 * All chats in a project the caller owns, newest activity first, over the
 * `by_project` index. Lets a project view show its full chat history rather than
 * only those chats that happen to be in the bounded sidebar window — see
 * docs/adr/0005-bounded-chat-list-window.md. Ownership is enforced by
 * the ownedProjectQuery builder (ctx.project).
 */
export const getProjectChatsForCurrentUser = ownedProjectQuery({
  args: {},
  handler: async (ctx) => {
    const chats = await ctx.db
      .query("chats")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.project._id))
      .collect()

    return chats.sort(
      (a, b) =>
        (b.updatedAt ?? b._creationTime) - (a.updatedAt ?? a._creationTime)
    )
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
 * sidebar window — see docs/adr/0005-bounded-chat-list-window.md. Scope
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

// The sidebar status-projection fields (docs/design/sidebar-status-backend-wiring.md)
// are owner-only, but they ride the chat doc that public/shared reads return. Strip
// them from any read that can hand a chat to a non-owner, so a shared-chat viewer
// never receives the owner's read cursor or live/last-run state (nor reactive
// updates to it). Owner-scoped list queries only ever return the caller's own
// chats, so only the getById/getPublicById paths below need this.
const OWNER_ONLY_STATUS_FIELDS = [
  "liveRunStatus",
  "statusRunId",
  "lastRunEndedAt",
  "lastRunStatus",
  "lastReadAt",
] as const

function stripOwnerStatus(chat: Doc<"chats">): Doc<"chats"> {
  const stripped = { ...chat }
  for (const field of OWNER_ONLY_STATUS_FIELDS) {
    delete (stripped as Record<string, unknown>)[field]
  }
  return stripped
}

/**
 * Project a readable chat for return: the owner sees the full doc; a non-owner
 * (public/shared viewer) gets the owner-only status fields stripped. Pure — the
 * testable core of getById's owner-only strip.
 */
export function projectChatForReader(
  chat: Doc<"chats"> | null,
  user: Doc<"users"> | null
): Doc<"chats"> | null {
  if (!chat) return null
  const isOwner = user != null && chat.userId === user._id
  return isOwner ? chat : stripOwnerStatus(chat)
}

/**
 * Get a single chat by ID. Returns the chat if it is public (no auth required)
 * or the authenticated caller owns it; otherwise null. Owner-only status
 * projection fields are stripped for non-owners (shared-chat viewers).
 */
export const getById = readableChatQuery({
  args: {},
  handler: async (ctx) => projectChatForReader(ctx.chat, ctx.user),
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

    // Pure-public read (no owner concept) — always strip owner-only fields.
    return stripOwnerStatus(chat)
  },
})

/**
 * Stamp the caller's read cursor on a chat they own, clearing its derived
 * unread/error indicator (lastReadAt >= lastRunEndedAt → idle).
 *
 * Deliberately NOT ownedChatMutation: opening a *public* chat you don't own has
 * a valid Convex id, and ownedChatMutation would THROW. Unread/error only exist
 * for chats you own, so a non-owned (or missing) chat is a silent no-op. Guests
 * / local-/optimistic ids never reach here — the client gates on isConvexId and
 * this is an authenticatedMutation.
 */
export const markChatRead = authenticatedMutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const chat = await ctx.db.get(chatId)
    if (!chat || chat.userId !== ctx.user._id) return // public / not-owned → no-op
    await ctx.db.patch(chatId, { lastReadAt: Date.now() })
  },
})

/**
 * Defensive backfill for the `updatedAt` optional→required narrowing
 * (docs/adr/0005-bounded-chat-list-window.md). Sets
 * `updatedAt = _creationTime` for any chat missing it, so recency indexes have
 * no null keys. Idempotent.
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
