import { ConvexHttpClient } from "convex/browser"
import { api } from "@/convex/_generated/api"
import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { encryptKey } from "@/lib/encryption"
import { NextResponse } from "next/server"

/**
 * User API Keys Management
 * 
 * Handles encryption/decryption of API keys and delegates storage to Convex.
 */

// Lazy initialization to avoid build-time errors when env vars aren't set
function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set")
  }
  return new ConvexHttpClient(url)
}

export async function POST(request: Request) {
  try {
    const { provider, apiKey } = await request.json()

    if (!provider || !apiKey) {
      return NextResponse.json(
        { error: "Provider and API key are required" },
        { status: 400 }
      )
    }

    const authSession = await getAuthenticatedWorkosSession()
    if (!authSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Encrypt the key for storage
    const { encrypted, iv } = encryptKey(apiKey)

    // Get Convex client and set auth
    const convex = getConvexClient()
    convex.setAuth(authSession.accessToken)

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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { provider } = await request.json()

    if (!provider) {
      return NextResponse.json(
        { error: "Provider is required" },
        { status: 400 }
      )
    }

    const authSession = await getAuthenticatedWorkosSession()
    if (!authSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Call Convex mutation to delete the key
    const convex = getConvexClient()
    convex.setAuth(authSession.accessToken)

    await convex.mutation(api.userKeys.remove, { provider })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error in DELETE /api/user-keys:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
