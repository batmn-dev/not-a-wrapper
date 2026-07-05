import {
  createAuthenticatedConvexClient,
  internalServerError,
  jsonError,
  unauthorizedError,
} from "@/app/api/_lib/convex"
import { api } from "@/convex/_generated/api"
import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { encryptKey } from "@/lib/encryption"
import { NextResponse } from "next/server"

/**
 * User API Keys Management
 *
 * Handles encryption/decryption of API keys and delegates storage to Convex.
 */

export async function POST(request: Request) {
  try {
    const { provider, apiKey } = await request.json()

    // Keys pasted from dashboards routinely carry stray whitespace or a
    // trailing newline; stored verbatim they decrypt back into a value the
    // provider rejects as "Invalid API key" with no visible cause. Normalize
    // before encryption so the stored key is exactly the credential.
    const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : ""
    if (!provider || !normalizedApiKey) {
      return jsonError("Provider and API key are required", 400)
    }

    const authSession = await getAuthenticatedWorkosSession()
    if (!authSession) {
      return unauthorizedError()
    }

    // Encrypt the key for storage
    const { encrypted, iv } = encryptKey(normalizedApiKey)

    // Get Convex client and set auth
    const convex = createAuthenticatedConvexClient(authSession.accessToken)

    // Check if key already exists for this provider
    const existingKey = await convex.query(api.userKeys.getByProvider, {
      provider,
    })
    const isNewKey = !existingKey

    // Store the encrypted key in Convex
    await convex.mutation(api.userKeys.upsert, {
      provider,
      encryptedKey: encrypted,
      iv,
    })

    return NextResponse.json({
      success: true,
      isNewKey,
      message: `API key ${isNewKey ? "saved" : "updated"} successfully.`,
    })
  } catch (error) {
    console.error("Error in POST /api/user-keys:", error)
    return internalServerError()
  }
}

export async function DELETE(request: Request) {
  try {
    const { provider } = await request.json()

    if (!provider) {
      return jsonError("Provider is required", 400)
    }

    const authSession = await getAuthenticatedWorkosSession()
    if (!authSession) {
      return unauthorizedError()
    }

    // Call Convex mutation to delete the key
    const convex = createAuthenticatedConvexClient(authSession.accessToken)

    await convex.mutation(api.userKeys.remove, { provider })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error in DELETE /api/user-keys:", error)
    return internalServerError()
  }
}
