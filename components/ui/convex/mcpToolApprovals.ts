import { v } from "convex/values"
import { mutation, query, internalMutation } from "./_generated/server"

// =============================================================================
// Queries
// =============================================================================

/**
 * List all tool approvals for a specific MCP server.
 * Verifies the user owns the server.
 */
export const listByServer = query({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, { serverId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

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
export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

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
export const upsertApproval = mutation({
  args: {
    serverId: v.id("mcpServers"),
    toolName: v.string(),
    approved: v.boolean(),
  },
  handler: async (ctx, { serverId, toolName, approved }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) throw new Error("User not found")

    // Verify server ownership
    const server = await ctx.db.get(serverId)
    if (!server || server.userId !== user._id) {
      throw new Error("Server not found")
    }

    // Check for existing approval
    const existing = await ctx.db
      .query("mcpToolApprovals")
      .withIndex("by_user_server_tool", (q) =>
        q
          .eq("userId", user._id)
          .eq("serverId", serverId)
          .eq("toolName", toolName)
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
      userId: user._id,
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
export const bulkApprove = mutation({
  args: {
    serverId: v.id("mcpServers"),
    toolNames: v.array(v.string()),
  },
  handler: async (ctx, { serverId, toolNames }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) throw new Error("User not found")

    // Verify server ownership
    const server = await ctx.db.get(serverId)
    if (!server || server.userId !== user._id) {
      throw new Error("Server not found")
    }

    const now = Date.now()

    for (const toolName of toolNames) {
      // Check if approval already exists (avoid duplicates)
      const existing = await ctx.db
        .query("mcpToolApprovals")
        .withIndex("by_user_server_tool", (q) =>
          q
            .eq("userId", user._id)
            .eq("serverId", serverId)
            .eq("toolName", toolName)
        )
        .unique()

      if (!existing) {
        await ctx.db.insert("mcpToolApprovals", {
          userId: user._id,
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
 * Toggle individual tool approved status.
 */
export const toggleApproval = mutation({
  args: { approvalId: v.id("mcpToolApprovals") },
  handler: async (ctx, { approvalId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) throw new Error("User not found")

    const approval = await ctx.db.get(approvalId)
    if (!approval || approval.userId !== user._id) {
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
