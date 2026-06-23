import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import {
  authenticatedMutation,
  maybeAuthQuery,
  ownedMcpServerMutation,
} from "./lib/authedFunctions"

// =============================================================================
// Queries
// =============================================================================

/**
 * List all tool approvals for a specific MCP server the caller owns. Returns []
 * when unauthenticated or the server is not owned.
 */
export const listByServer = maybeAuthQuery({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, { serverId }) => {
    const user = ctx.user
    if (!user) return []

    // Verify server ownership
    const server = await ctx.db.get(serverId)
    if (!server || server.userId !== user._id) return []

    return await ctx.db
      .query("mcpToolApprovals")
      .withIndex("by_user_server", (q) =>
        q.eq("userId", user._id).eq("serverId", serverId)
      )
      .collect()
  },
})

/**
 * List all tool approvals across all servers for the authenticated user.
 */
export const listByUser = maybeAuthQuery({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return []

    return await ctx.db
      .query("mcpToolApprovals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
  },
})

// =============================================================================
// Mutations
// =============================================================================

/**
 * Upsert a tool approval. Uses by_user_server_tool index to avoid duplicates.
 * If an approval for this tool already exists, updates it. Otherwise creates a new one.
 */
export const upsertApproval = ownedMcpServerMutation({
  args: {
    toolName: v.string(),
    approved: v.boolean(),
  },
  handler: async (ctx, { toolName, approved }) => {
    const userId = ctx.user._id
    const serverId = ctx.server._id

    // Check for existing approval
    const existing = await ctx.db
      .query("mcpToolApprovals")
      .withIndex("by_user_server_tool", (q) =>
        q.eq("userId", userId).eq("serverId", serverId).eq("toolName", toolName)
      )
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, {
        approved,
        approvedAt: approved ? Date.now() : existing.approvedAt,
      })
      return existing._id
    }

    return await ctx.db.insert("mcpToolApprovals", {
      userId,
      serverId,
      toolName,
      approved,
      approvedAt: approved ? Date.now() : undefined,
    })
  },
})

/**
 * Auto-approve all discovered tools for a server.
 *
 * v1 trust model: when a user adds an MCP server, ALL discovered tools are
 * auto-approved. The trust boundary is server-level — the user chose to add
 * the URL. Users can individually disable tools after discovery.
 */
export const bulkApprove = ownedMcpServerMutation({
  args: {
    toolNames: v.array(v.string()),
  },
  handler: async (ctx, { toolNames }) => {
    const userId = ctx.user._id
    const serverId = ctx.server._id
    const now = Date.now()

    for (const toolName of toolNames) {
      // Check if approval already exists (avoid duplicates)
      const existing = await ctx.db
        .query("mcpToolApprovals")
        .withIndex("by_user_server_tool", (q) =>
          q.eq("userId", userId).eq("serverId", serverId).eq("toolName", toolName)
        )
        .unique()

      if (!existing) {
        await ctx.db.insert("mcpToolApprovals", {
          userId,
          serverId,
          toolName,
          approved: true,
          approvedAt: now,
        })
      }
    }
  },
})

/**
 * Toggle individual tool approved status. Approval ownership is a per-row check
 * on the approval, so this stays an authenticatedMutation with an inline owner
 * check rather than a server-scoped builder.
 */
export const toggleApproval = authenticatedMutation({
  args: { approvalId: v.id("mcpToolApprovals") },
  handler: async (ctx, { approvalId }) => {
    const approval = await ctx.db.get(approvalId)
    if (!approval || approval.userId !== ctx.user._id) {
      throw new Error("Approval not found")
    }

    const newApproved = !approval.approved
    await ctx.db.patch(approvalId, {
      approved: newApproved,
      approvedAt: newApproved ? Date.now() : approval.approvedAt,
    })
  },
})

// =============================================================================
// Internal Mutations
// =============================================================================

/**
 * Remove all approvals for a server. Called during server deletion cleanup
 * or from scheduled cleanup jobs.
 */
export const removeByServer = internalMutation({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, { serverId }) => {
    const approvals = await ctx.db
      .query("mcpToolApprovals")
      .withIndex("by_server", (q) => q.eq("serverId", serverId))
      .collect()

    for (const approval of approvals) {
      await ctx.db.delete(approval._id)
    }
  },
})
