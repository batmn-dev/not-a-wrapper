import { authenticatedRoute } from "@/app/api/_lib/authenticated-route"
import { internalServerError, jsonError } from "@/app/api/_lib/convex"
import { api } from "@/convex/_generated/api"
import { encryptSecret } from "@/lib/encryption"
import { NextResponse } from "next/server"

/**
 * User API Keys Management
 *
 * Handles encryption of API keys and delegates storage to Convex. Auth + CSRF
 * are enforced by the `authenticatedRoute` seam.
 */

export const POST = authenticatedRoute(async (request, { session, convex }) => {
  try {
    const { provider, apiKey } = await request.json()

    // Keys pasted from dashboards routinely carry stray whitespace or a
    // trailing newline; stored verbatim they decrypt back into a value the
    // provider rejects as "Invalid API key" with no visible cause. Normalize
    // before encryption so the stored key is exactly the credential.
    const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : ""
    if (!provider || typeof provider !== "string" || !normalizedApiKey) {
      return jsonError("Provider and API key are required", 400)
    }

    // Bind the ciphertext to its owner + provider (AAD). A row spliced under a
    // different user or provider fails authentication at decrypt time.
    const { encrypted, iv } = encryptSecret(normalizedApiKey, {
      kind: "userKey",
      ownerId: session.userId,
      provider,
    })

    const existingKey = await convex.query(api.userKeys.getByProvider, {
      provider,
    })
    const isNewKey = !existingKey

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
})

export const DELETE = authenticatedRoute(async (request, { convex }) => {
  try {
    const { provider } = await request.json()

    if (!provider || typeof provider !== "string") {
      return jsonError("Provider is required", 400)
    }

    await convex.mutation(api.userKeys.remove, { provider })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error in DELETE /api/user-keys:", error)
    return internalServerError()
  }
})
