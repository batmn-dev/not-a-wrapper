import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import {
  authenticatedMutation,
  maybeAuthQuery,
  ownedMcpServerMutation,
} from "./lib/authedFunctions"

export const listByServer = maybeAuthQuery({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, { serverId }) => {
    const user = ctx.user
    if (!user) return []

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

export const upsertApproval = ownedMcpServerMutation({
  args: {
    toolName: v.string(),
    approved: v.boolean(),
  },
  handler: async (ctx, { toolName, approved }) => {
    const userId = ctx.user._id
    const serverId = ctx.server._id

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
 * Server-level trust auto-approves discovered tools; users can disable them
 * individually afterward.
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
      const existing = await ctx.db
        .query("mcpToolApprovals")
        .withIndex("by_user_server_tool", (q) =>
          q
            .eq("userId", userId)
            .eq("serverId", serverId)
            .eq("toolName", toolName)
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
 * Approval ownership is row-scoped, so this uses an inline owner check instead
 * of the server-scoped builder.
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
