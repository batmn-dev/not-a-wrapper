import { paginationOptsValidator, type PaginationOptions } from "convex/server"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { createChatOwnedDeletion } from "./domain/chat_owned_deletion"
import { collectLinkedChats } from "./domain/chat_project_link"
import { createMessageBranchWriter } from "./domain/message_branch_writes"
import {
  patchChatActivity,
  recordKnownProjectActivity,
} from "./domain/project_activity"
import { bindStagedAttachmentsToChat } from "./files"
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
 * The current user's pinned chats over the composite sidebar index — a small,
 * live read rendered as its own sidebar section alongside the paginated
 * recency window (ADR-0005). Project membership is retained so the sidebar can
 * derive either grouping mode from the same authoritative source.
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
    .withIndex("by_user_pinned_updated", (q) =>
      q.eq("userId", user._id).eq("pinned", true)
    )
    .order("desc")
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
 * The bounded sidebar recency window: all of the current user's non-pinned
 * chats newest-first. Project membership stays in the result so "In one list"
 * can interleave every chat and "By project" can derive project previews from
 * the same window. Pinned chats are read separately
 * (`getPinnedForCurrentUser`). See docs/adr/0005-bounded-chat-list-window.md.
 */
export const getRecentWindowForCurrentUser = maybeAuthQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) =>
    getRecentWindowForCurrentUserHandler(ctx, paginationOpts),
})

export async function getRecentWindowForCurrentUserHandler(
  ctx: MaybeUserChatQueryCtx,
  paginationOpts: PaginationOptions
) {
  const user = ctx.user
  if (!user) {
    return { page: [], isDone: true, continueCursor: "" }
  }

  return await ctx.db
    .query("chats")
    .withIndex("by_user_pinned_updated", (q) =>
      q.eq("userId", user._id).eq("pinned", false)
    )
    .order("desc")
    .paginate(paginationOpts)
}

/**
 * All chats in a project the caller owns, newest activity first, over the
 * `by_project` index. Lets a project view show its full chat history rather than
 * only those chats that happen to be in the bounded sidebar window — see
 * docs/adr/0005-bounded-chat-list-window.md. Ownership is enforced by
 * the ownedProjectQuery builder (ctx.project); the link accessor re-checks
 * each chat so a corrupted cross-owner link can never ship another user's chat.
 */
export const getProjectChatsForCurrentUser = ownedProjectQuery({
  args: {},
  handler: async (ctx) => {
    const chats = await collectLinkedChats(ctx, ctx.project)

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
  "liveRunFreshUntil",
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

type NewChatArgs = {
  title?: string
  model?: string
  systemPrompt?: string
  projectId?: Id<"projects">
}

/**
 * The one place a new chat row is authorized and constructed: project
 * ownership check, then the insert with the row's defaults. Shared by `create`
 * and `createWithFirstTurn` so a future chat field or default cannot silently
 * diverge between the compatibility path and the first-turn path.
 */
async function insertChatForUser(
  ctx: MutationCtx,
  user: Doc<"users">,
  args: NewChatArgs,
  now: number
): Promise<{ chatId: Id<"chats">; project: Doc<"projects"> | undefined }> {
  const project = args.projectId
    ? (await requireOwnedProject(ctx, args.projectId)).project
    : undefined

  const chatId = await ctx.db.insert("chats", {
    userId: user._id,
    title: args.title ?? "New chat",
    model: args.model,
    systemPrompt: args.systemPrompt,
    projectId: args.projectId,
    public: false,
    pinned: false,
    updatedAt: now,
  })
  return { chatId, project }
}

/**
 * Create a new chat.
 *
 * NOT the first-turn path: the app's first turn creates its chat through
 * `createWithFirstTurn` below. Kept for API compatibility (clients running
 * pre-atomic bundles during a deploy still call it) — which is also why "no
 * chat without its first message" is an invariant of the first-turn path, not
 * of the schema.
 */
export const create = authenticatedMutation({
  args: {
    title: v.optional(v.string()),
    model: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const { chatId, project } = await insertChatForUser(ctx, ctx.user, args, now)
    await recordKnownProjectActivity(ctx, project, now)
    return chatId
  },
})

type CreateWithFirstTurnArgs = NewChatArgs & {
  message: { clientMessageId: string; text: string }
  attachmentIds: Id<"chatAttachments">[]
}

/**
 * Atomic first-turn creation: create the chat (optionally inside an owned
 * project), bind the complete staged-attachment set, and persist the initial
 * user message — one Convex transaction. Any failure (attachment validation,
 * project ownership) rolls the chat row back too, so THIS path can never
 * strand a chat without its first user message (a path invariant, not a
 * schema one, while the compatibility `create` above remains callable). The
 * generation run still starts via
 * POST /api/chat afterwards: prepareGeneration's idempotent writeUserMessage
 * finds this row by clientMessageId, adopts the run's provenance stamp, and
 * selects it instead of inserting a duplicate.
 *
 * The message row is written through the Message branch writer with no
 * provenance stamp — no generation request exists yet (see
 * message_branch_writes.ts WriteUserMessageInput).
 */
export async function createChatWithFirstTurnForUser(
  ctx: MutationCtx,
  user: Doc<"users">,
  args: CreateWithFirstTurnArgs
) {
  const now = Date.now()
  const { chatId, project } = await insertChatForUser(ctx, user, args, now)

  const attachments = await bindStagedAttachmentsToChat(
    ctx,
    { userId: user._id, chatId },
    args.attachmentIds
  )

  // The same parts shape the client dispatches (convertAttachmentsToFiles),
  // built server-side from the just-validated bindings so the persisted parts
  // never depend on client-supplied URLs.
  const parts = [
    { type: "text" as const, text: args.message.text },
    ...attachments.map((attachment) => ({
      type: "file" as const,
      filename: attachment.name,
      mediaType: attachment.contentType,
      url: attachment.url,
      attachmentId: attachment.attachmentId,
    })),
  ]

  const userMessage = await createMessageBranchWriter(ctx, {
    chatId,
    now,
  }).writeUserMessage({
    clientMessageId: args.message.clientMessageId,
    userId: user._id,
    content: args.message.text,
    parts,
  })

  await recordKnownProjectActivity(ctx, project, now)

  return { chatId, userMessageId: userMessage._id, attachments }
}

export const createWithFirstTurn = authenticatedMutation({
  args: {
    title: v.optional(v.string()),
    model: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    message: v.object({
      clientMessageId: v.string(),
      text: v.string(),
    }),
    attachmentIds: v.array(v.id("chatAttachments")),
  },
  handler: async (ctx, args) =>
    createChatWithFirstTurnForUser(ctx, ctx.user, args),
})

/**
 * Update chat title
 */
export const updateTitle = ownedChatMutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    await patchChatActivity(ctx, ctx.chat, { title }, Date.now())
  },
})

/**
 * Update chat model
 */
export const updateModel = ownedChatMutation({
  args: { model: v.string() },
  handler: async (ctx, { model }) => {
    await patchChatActivity(ctx, ctx.chat, { model }, Date.now())
  },
})

/**
 * Toggle chat pin status
 */
export const togglePin = ownedChatMutation({
  args: { pinned: v.boolean() },
  handler: async (ctx, { pinned }) => {
    const now = Date.now()
    await patchChatActivity(
      ctx,
      ctx.chat,
      { pinned, pinnedAt: pinned ? now : undefined },
      now
    )
  },
})

/**
 * Make a chat public (shareable via link)
 */
export const makePublic = ownedChatMutation({
  args: {},
  handler: async (ctx) => {
    await patchChatActivity(ctx, ctx.chat, { public: true }, Date.now())
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
 * Stamp `user`'s read cursor on a chat they own; no-op for a missing or
 * not-owned chat. The testable core of markChatRead (owner no-op is review #4's
 * requirement: opening a public chat you don't own must not throw).
 */
export async function markChatReadForOwner(
  ctx: Pick<MutationCtx, "db">,
  user: Doc<"users">,
  chatId: Id<"chats">,
  readThroughAt: number
): Promise<void> {
  const chat = await ctx.db.get(chatId)
  if (!chat || chat.userId !== user._id) return // public / not-owned → no-op
  if (typeof chat.lastRunEndedAt !== "number") return

  const lastReadAt = chat.lastReadAt ?? 0
  const safeReadThroughAt = Math.min(readThroughAt, chat.lastRunEndedAt)
  if (safeReadThroughAt <= lastReadAt) return

  await ctx.db.patch(chatId, { lastReadAt: safeReadThroughAt })
}

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
  args: { chatId: v.id("chats"), readThroughAt: v.number() },
  handler: async (ctx, { chatId, readThroughAt }) =>
    markChatReadForOwner(ctx, ctx.user, chatId, readThroughAt),
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

/** Delete a Chat and its complete durable graph. */
export const remove = ownedChatMutation({
  args: {},
  handler: async (ctx) => {
    await createChatOwnedDeletion(ctx).deleteChat(ctx.chat)
  },
})
