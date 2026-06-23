import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import {
  authenticatedMutation,
  maybeAuthQuery,
  ownedMcpServerMutation,
} from "./lib/authedFunctions"

// Mirror of lib/config.ts MAX_MCP_SERVERS_PER_USER — keep in sync
const MAX_MCP_SERVERS_PER_USER = 10

// =============================================================================
// SSRF Validation
// =============================================================================

// These helpers mirror lib/mcp/url-validation.ts — keep both in sync.
// Convex runtime cannot import from lib/, so the logic is duplicated here.

/** Check whether an IPv4 address falls in a private/reserved range. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) {
    return false
  }
  const [a, b] = parts
  return (
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 — CGNAT (RFC 6598)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) || // 169.254.0.0/16
    a === 0 // 0.0.0.0/8
  )
}

/**
 * Check whether an IPv6 address falls in a private/reserved range.
 * Covers: loopback (::1), unspecified (::), IPv4-mapped (::ffff:*),
 * link-local (fe80::/10), unique local (fc00::/7).
 *
 * @param rawIpv6 - The raw IPv6 address WITHOUT surrounding brackets
 */
function isPrivateIPv6(rawIpv6: string): boolean {
  const addr = rawIpv6.toLowerCase().replace(/%.*$/, "")

  if (addr === "::1") return true
  if (addr === "::") return true

  if (addr.startsWith("::ffff:")) {
    const suffix = addr.slice(7)
    if (suffix.includes(".")) return isPrivateIPv4(suffix)

    const hexParts = suffix.split(":")
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16)
      const lo = parseInt(hexParts[1], 16)
      if (!isNaN(hi) && !isNaN(lo)) {
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
        return isPrivateIPv4(ipv4)
      }
    }
  }

  const firstGroup = addr.split(":")[0]
  if (!firstGroup) return false

  if (/^fe[89ab][0-9a-f]$/.test(firstGroup)) return true
  if (/^f[cd][0-9a-f]{2}$/.test(firstGroup)) return true

  return false
}

/**
 * Validate a URL against SSRF rules.
 * Checks hostname patterns only — no DNS resolution in Convex runtime.
 * Defense-in-depth: the API route also validates before connecting.
 *
 * Mirrors lib/mcp/url-validation.ts validateServerUrl — keep in sync.
 *
 * Rejects: private IPs (10.x, 172.16-31.x, 192.168.x, 169.254.x, 127.x),
 * localhost, 0.0.0.0, .local hostnames, and private/reserved IPv6 addresses
 * (::1, ::, fe80::/10, fc00::/7, ::ffff:private-ip).
 */
function validateServerUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return "Invalid URL format"
  }

  const hostname = parsed.hostname.toLowerCase()

  // Block localhost and special hostnames
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local")
  ) {
    return "Localhost and local network URLs are not allowed"
  }

  // Block private/reserved IPv6 addresses (URL parser wraps IPv6 in brackets)
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const ipv6 = hostname.slice(1, -1)
    if (isPrivateIPv6(ipv6)) {
      return "Private IPv6 addresses are not allowed"
    }
  }

  // Block private IPv4 ranges
  if (isPrivateIPv4(hostname)) {
    return "Private IP addresses are not allowed"
  }

  // Must be http or https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only HTTP and HTTPS URLs are supported"
  }

  return null // valid
}

// =============================================================================
// Queries
// =============================================================================

/**
 * List all MCP servers for the authenticated user.
 */
export const list = maybeAuthQuery({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return []

    return await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
  },
})

/**
 * Get a single MCP server by ID. Returns it only when the caller owns it;
 * otherwise null.
 */
export const get = maybeAuthQuery({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, { serverId }) => {
    if (!ctx.user) return null

    const server = await ctx.db.get(serverId)
    if (!server || server.userId !== ctx.user._id) return null

    return server
  },
})

// =============================================================================
// Mutations
// =============================================================================

/**
 * Create a new MCP server configuration.
 *
 * - Validates URL against SSRF rules
 * - Enforces MAX_MCP_SERVERS_PER_USER limit
 * - Stores pre-encrypted auth values (caller encrypts via lib/encryption.ts)
 */
export const create = authenticatedMutation({
  args: {
    name: v.string(),
    url: v.string(),
    transport: v.union(v.literal("http"), v.literal("sse")),
    authType: v.optional(
      v.union(v.literal("none"), v.literal("bearer"), v.literal("header"))
    ),
    encryptedAuthValue: v.optional(v.string()),
    authIv: v.optional(v.string()),
    headerName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = ctx.user

    // SSRF validation
    const urlError = validateServerUrl(args.url)
    if (urlError) throw new Error(urlError)

    // Server limit enforcement
    const existingServers = await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    if (existingServers.length >= MAX_MCP_SERVERS_PER_USER) {
      throw new Error(
        `Maximum of ${MAX_MCP_SERVERS_PER_USER} MCP servers allowed`
      )
    }

    // Validate auth fields consistency
    if (
      (args.authType === "bearer" || args.authType === "header") &&
      (!args.encryptedAuthValue || !args.authIv)
    ) {
      throw new Error(
        "Encrypted auth value and IV are required for bearer/header auth"
      )
    }

    if (args.authType === "header" && !args.headerName) {
      throw new Error("Header name is required for header auth type")
    }

    return await ctx.db.insert("mcpServers", {
      userId: user._id,
      name: args.name,
      url: args.url,
      transport: args.transport,
      enabled: true,
      authType: args.authType,
      encryptedAuthValue: args.encryptedAuthValue,
      authIv: args.authIv,
      headerName: args.headerName,
      createdAt: Date.now(),
    })
  },
})

/**
 * Update an existing MCP server configuration.
 *
 * - Verifies ownership
 * - Re-validates URL if changed
 * - Accepts partial updates (only provided fields are changed)
 */
export const update = ownedMcpServerMutation({
  args: {
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    transport: v.optional(v.union(v.literal("http"), v.literal("sse"))),
    authType: v.optional(
      v.union(v.literal("none"), v.literal("bearer"), v.literal("header"))
    ),
    encryptedAuthValue: v.optional(v.string()),
    authIv: v.optional(v.string()),
    headerName: v.optional(v.string()),
  },
  handler: async (ctx, updates) => {
    const server = ctx.server
    const serverId = server._id

    // SSRF validation if URL is being changed
    if (updates.url) {
      const urlError = validateServerUrl(updates.url)
      if (urlError) throw new Error(urlError)
    }

    // Validate auth fields consistency for the final state
    const finalAuthType = updates.authType ?? server.authType
    if (finalAuthType === "bearer" || finalAuthType === "header") {
      const finalEncrypted =
        updates.encryptedAuthValue ?? server.encryptedAuthValue
      const finalIv = updates.authIv ?? server.authIv
      if (!finalEncrypted || !finalIv) {
        throw new Error(
          "Encrypted auth value and IV are required for bearer/header auth"
        )
      }
    }

    if (finalAuthType === "header") {
      const finalHeaderName = updates.headerName ?? server.headerName
      if (!finalHeaderName) {
        throw new Error("Header name is required for header auth type")
      }
    }

    // Build patch object with only provided fields
    const patch: Record<string, unknown> = {}
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.url !== undefined) patch.url = updates.url
    if (updates.transport !== undefined) patch.transport = updates.transport
    if (updates.authType !== undefined) patch.authType = updates.authType
    if (updates.encryptedAuthValue !== undefined)
      patch.encryptedAuthValue = updates.encryptedAuthValue
    if (updates.authIv !== undefined) patch.authIv = updates.authIv
    if (updates.headerName !== undefined) patch.headerName = updates.headerName

    // Clear auth fields when switching to "none"
    if (updates.authType === "none") {
      patch.encryptedAuthValue = undefined
      patch.authIv = undefined
      patch.headerName = undefined
    }

    await ctx.db.patch(serverId, patch)
  },
})

/**
 * Delete an MCP server and cascade delete its tool approvals.
 * Tool call logs are preserved as audit trail (serverId becomes a dangling ref).
 */
export const remove = ownedMcpServerMutation({
  args: {},
  handler: async (ctx) => {
    const serverId = ctx.server._id

    // Cascade delete: remove all tool approvals for this server
    const approvals = await ctx.db
      .query("mcpToolApprovals")
      .withIndex("by_server", (q) => q.eq("serverId", serverId))
      .collect()

    for (const approval of approvals) {
      await ctx.db.delete(approval._id)
    }

    // Delete the server
    await ctx.db.delete(serverId)
  },
})

/**
 * Quick enable/disable toggle for an MCP server.
 */
export const toggleEnabled = ownedMcpServerMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.db.patch(ctx.server._id, { enabled: !ctx.server.enabled })
  },
})

/**
 * Update connection status (lastConnectedAt, lastError).
 * Called from the API route after attempting to connect to a server.
 */
export const updateConnectionStatus = ownedMcpServerMutation({
  args: {
    lastConnectedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, { lastConnectedAt, lastError }) => {
    const patch: Record<string, unknown> = {}
    if (lastConnectedAt !== undefined) patch.lastConnectedAt = lastConnectedAt
    if (lastError !== undefined) patch.lastError = lastError

    // Clear error on successful connection
    if (lastConnectedAt && !lastError) {
      patch.lastError = undefined
    }

    await ctx.db.patch(ctx.server._id, patch)
  },
})

// =============================================================================
// Internal Mutations (for server-side use from Convex actions/scheduled jobs)
// =============================================================================

/**
 * Internal: update connection status without auth check.
 * For use from Convex actions that have already verified the user.
 */
export const internalUpdateConnectionStatus = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
    lastConnectedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, { serverId, lastConnectedAt, lastError }) => {
    const server = await ctx.db.get(serverId)
    if (!server) return

    const patch: Record<string, unknown> = {}
    if (lastConnectedAt !== undefined) patch.lastConnectedAt = lastConnectedAt
    if (lastError !== undefined) patch.lastError = lastError

    if (lastConnectedAt && !lastError) {
      patch.lastError = undefined
    }

    await ctx.db.patch(serverId, patch)
  },
})
