/**
 * Authenticated handler builders — the seam that makes auth structural.
 *
 * Before this module, ~33 handlers called `ctx.auth.getUserIdentity()` inline
 * and re-derived the identity→user→ownership sequence by hand; the `auth.ts`
 * helpers existed but were a library you had to remember to call, so the seam
 * was routinely bypassed and the error contract had already drifted. These
 * builders move auth in front of the handler body: a handler defined with
 * `ownedChatMutation` cannot run without an owner-verified `ctx.chat`.
 *
 * Built on convex-helpers `customQuery`/`customMutation`, reusing the `auth.ts`
 * helpers as the injection bodies, so the resolved `user` (and `chat`/`project`/
 * `server`) land on `ctx` with full end-to-end typing. Each owned-resource
 * builder declares the resource id arg itself and passes it through, so handlers
 * keep using `args.<id>` and simply drop their own ownership check.
 *
 * Deliberately out of scope: `internalQuery`/`internalMutation` (no client
 * identity), `httpAction` (the chat-route token path), pure-public reads with no
 * user concept, and the self-identity-match handlers in `users.ts` (a different
 * predicate). See ADR-0003.
 */

import {
  customCtx,
  customCtxAndArgs,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions"
import { v } from "convex/values"
import { mutation, query } from "../_generated/server"
import {
  getAuthorizedChatForRead,
  getCurrentUser,
  getOptionalAuth,
  requireCurrentUser,
  requireIdentity,
  requireOwnedChat,
  requireOwnedMcpServer,
  requireOwnedProject,
} from "./auth"

/**
 * A query whose caller must be authenticated. Injects `ctx.user`; throws
 * "Not authenticated" / "User not found" before the handler runs.
 */
export const authenticatedQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ user: await requireCurrentUser(ctx) }))
)

/** A mutation whose caller must be authenticated. Injects `ctx.user`. */
export const authenticatedMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ user: await requireCurrentUser(ctx) }))
)

/**
 * A query that requires a signed-in identity but not a resolved user row.
 * Injects `ctx.identity` — for self-identity-match handlers that compare
 * `identity.subject` to a client argument.
 */
export const identityQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ identity: await requireIdentity(ctx) }))
)

/**
 * A mutation that requires a signed-in identity but not a resolved user row.
 * Injects `ctx.identity` — for self-identity-match handlers and the create-user
 * bootstrap path where the user row may not exist yet.
 */
export const identityMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ identity: await requireIdentity(ctx) }))
)

/**
 * A query that resolves the caller if present but never throws. Injects
 * `ctx.user: Doc<"users"> | null` — for authenticated reads that degrade to an
 * empty/null result for signed-out callers.
 */
export const maybeAuthQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ user: await getCurrentUser(ctx) }))
)

/**
 * A mutation that resolves the caller if present but never throws. Injects
 * `ctx.user: Doc<"users"> | null` — for optional-auth / anonymous write paths
 * (usage, rate limits) that key off an anonymous id when signed out.
 */
export const maybeAuthMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ user: await getCurrentUser(ctx) }))
)

/**
 * A query for optional-auth / anonymous read paths. Injects both
 * `ctx.identity` (raw, nullable) and `ctx.user` (nullable), so the handler can
 * distinguish a guest from an unsynced user. Never throws.
 */
export const optionalAuthQuery = customQuery(
  query,
  customCtx(async (ctx) => await getOptionalAuth(ctx))
)

/**
 * A mutation for optional-auth / anonymous write paths (usage counters, rate
 * limits). Injects `ctx.identity` and `ctx.user`, both nullable. Never throws on
 * a missing caller.
 */
export const optionalAuthMutation = customMutation(
  mutation,
  customCtx(async (ctx) => await getOptionalAuth(ctx))
)

/**
 * A read of a chat the caller may view: the owner, or anyone when the chat is
 * public (share links). Injects `ctx.chat: Doc<"chats"> | null` (null when not
 * authorized) and `ctx.user: Doc<"users"> | null`. Consumes a `chatId` arg and
 * passes it through.
 */
export const readableChatQuery = customQuery(
  query,
  customCtxAndArgs({
    args: { chatId: v.id("chats") },
    input: async (ctx, { chatId }) => {
      const chat = await getAuthorizedChatForRead(ctx, chatId)
      const user = await getCurrentUser(ctx)
      return { ctx: { chat, user }, args: { chatId } }
    },
  })
)

/**
 * A read restricted to the chat's owner (no public exception) — throws
 * "Not authenticated" / "Chat not found" / "Not authorized". Injects
 * owner-verified `ctx.chat` and `ctx.user`. Consumes a `chatId` arg and passes
 * it through. Use `readableChatQuery` instead when public chats should be
 * viewable.
 */
export const ownedChatQuery = customQuery(
  query,
  customCtxAndArgs({
    args: { chatId: v.id("chats") },
    input: async (ctx, { chatId }) => {
      const { user, chat } = await requireOwnedChat(ctx, chatId)
      return { ctx: { user, chat }, args: { chatId } }
    },
  })
)

/**
 * A mutation on a chat the caller owns. Injects owner-verified `ctx.chat` and
 * `ctx.user`; throws "Not authenticated" / "Chat not found" / "Not authorized".
 * Consumes a `chatId` arg and passes it through.
 */
export const ownedChatMutation = customMutation(
  mutation,
  customCtxAndArgs({
    args: { chatId: v.id("chats") },
    input: async (ctx, { chatId }) => {
      const { user, chat } = await requireOwnedChat(ctx, chatId)
      return { ctx: { user, chat }, args: { chatId } }
    },
  })
)

/**
 * A mutation on a project the caller owns. Injects owner-verified `ctx.project`
 * and `ctx.user`. Consumes a `projectId` arg and passes it through.
 */
export const ownedProjectMutation = customMutation(
  mutation,
  customCtxAndArgs({
    args: { projectId: v.id("projects") },
    input: async (ctx, { projectId }) => {
      const { user, project } = await requireOwnedProject(ctx, projectId)
      return { ctx: { user, project }, args: { projectId } }
    },
  })
)

/**
 * A query on a project the caller owns. Injects owner-verified `ctx.project` and
 * `ctx.user`. Consumes a `projectId` arg and passes it through.
 */
export const ownedProjectQuery = customQuery(
  query,
  customCtxAndArgs({
    args: { projectId: v.id("projects") },
    input: async (ctx, { projectId }) => {
      const { user, project } = await requireOwnedProject(ctx, projectId)
      return { ctx: { user, project }, args: { projectId } }
    },
  })
)

/**
 * A mutation on an MCP server the caller owns. Injects owner-verified
 * `ctx.server` and `ctx.user`; throws "Not authenticated" / "Server not found" /
 * "Not authorized". Consumes a `serverId` arg and passes it through.
 */
export const ownedMcpServerMutation = customMutation(
  mutation,
  customCtxAndArgs({
    args: { serverId: v.id("mcpServers") },
    input: async (ctx, { serverId }) => {
      const { user, server } = await requireOwnedMcpServer(ctx, serverId)
      return { ctx: { user, server }, args: { serverId } }
    },
  })
)

/**
 * A query on an MCP server the caller owns. Injects owner-verified `ctx.server`
 * and `ctx.user`. Consumes a `serverId` arg and passes it through.
 */
export const ownedMcpServerQuery = customQuery(
  query,
  customCtxAndArgs({
    args: { serverId: v.id("mcpServers") },
    input: async (ctx, { serverId }) => {
      const { user, server } = await requireOwnedMcpServer(ctx, serverId)
      return { ctx: { user, server }, args: { serverId } }
    },
  })
)
