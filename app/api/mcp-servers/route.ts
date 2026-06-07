import {
  createAuthenticatedConvexClient,
  internalServerError,
  jsonError,
  unauthorizedError,
} from "@/app/api/_lib/convex"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { encryptKey } from "@/lib/encryption"
import { NextResponse } from "next/server"

/**
 * MCP Server Management API
 *
 * Handles create/update of MCP server configurations.
 * Encrypts auth values server-side before storing in Convex.
 * Follows the same pattern as /api/user-keys/route.ts.
 */

/**
 * POST /api/mcp-servers — Create a new MCP server
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, url, transport, authType, authValue, headerName } = body as {
      name?: string
      url?: string
      transport?: string
      authType?: string
      authValue?: string
      headerName?: string
    }

    if (!name?.trim() || !url?.trim()) {
      return jsonError("Name and URL are required", 400)
    }

    const authSession = await getAuthenticatedWorkosSession()
    if (!authSession) {
      return unauthorizedError()
    }

    // Encrypt auth value if provided
    let encryptedAuthValue: string | undefined
    let authIv: string | undefined

    if (authValue && (authType === "bearer" || authType === "header")) {
      const encrypted = encryptKey(authValue)
      encryptedAuthValue = encrypted.encrypted
      authIv = encrypted.iv
    }

    const convex = createAuthenticatedConvexClient(authSession.accessToken)

    const serverId = await convex.mutation(api.mcpServers.create, {
      name: name.trim(),
      url: url.trim(),
      transport: (transport === "sse" ? "sse" : "http") as "http" | "sse",
      authType: (authType === "bearer"
        ? "bearer"
        : authType === "header"
          ? "header"
          : "none") as "none" | "bearer" | "header",
      encryptedAuthValue,
      authIv,
      headerName: authType === "header" ? headerName : undefined,
    })

    return NextResponse.json({ success: true, serverId })
  } catch (error) {
    console.error("Error in POST /api/mcp-servers:", error)
    return internalServerError()
  }
}

/**
 * PATCH /api/mcp-servers — Update an existing MCP server
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { serverId, name, url, transport, authType, authValue, headerName } =
      body as {
        serverId?: string
        name?: string
        url?: string
        transport?: string
        authType?: string
        authValue?: string
        headerName?: string
      }

    if (!serverId) {
      return jsonError("Server ID is required", 400)
    }

    const authSession = await getAuthenticatedWorkosSession()
    if (!authSession) {
      return unauthorizedError()
    }

    const convex = createAuthenticatedConvexClient(authSession.accessToken)

    // Build typed update object — only include fields that were provided
    const updates: {
      name?: string
      url?: string
      transport?: "http" | "sse"
      authType?: "none" | "bearer" | "header"
      encryptedAuthValue?: string
      authIv?: string
      headerName?: string
    } = {}

    if (name !== undefined) {
      const trimmed = name.trim()
      if (!trimmed) {
        return jsonError("Name cannot be empty", 400)
      }
      updates.name = trimmed
    }
    if (url !== undefined) {
      const trimmed = url.trim()
      if (!trimmed) {
        return jsonError("URL cannot be empty", 400)
      }
      updates.url = trimmed
    }
    if (transport !== undefined)
      updates.transport = transport === "sse" ? "sse" : "http"
    if (authType !== undefined) {
      updates.authType =
        authType === "bearer"
          ? "bearer"
          : authType === "header"
            ? "header"
            : "none"
    }

    // Encrypt new auth value if provided
    if (authValue && (authType === "bearer" || authType === "header")) {
      const encrypted = encryptKey(authValue)
      updates.encryptedAuthValue = encrypted.encrypted
      updates.authIv = encrypted.iv
    }

    if (authType === "header" && headerName !== undefined) {
      updates.headerName = headerName
    }

    await convex.mutation(api.mcpServers.update, {
      serverId: serverId as Id<"mcpServers">,
      ...updates,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error in PATCH /api/mcp-servers:", error)
    return internalServerError()
  }
}
