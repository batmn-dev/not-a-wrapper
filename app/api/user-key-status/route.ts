import { getWorkosSession } from "@/lib/auth/workos"
import { PROVIDERS } from "@/lib/providers"
import { NextResponse } from "next/server"

const SUPPORTED_PROVIDERS = PROVIDERS.map((p) => p.id)

/**
 * @deprecated This endpoint is deprecated. Use Convex userKeys.getAll query instead.
 *
 * Previously returned status of which providers the user has API keys for.
 * Now returns all false since the client (ModelProvider) uses Convex directly
 * for reactive user key status via useQuery(api.userKeys.getAll).
 *
 * This endpoint is kept only for backward compatibility with any external
 * consumers that may still be calling it.
 */
export async function GET() {
  try {
    const { user } = await getWorkosSession()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // DEPRECATED: Client now uses Convex userKeys.getAll for reactive updates
    // Return all providers as false for backward compatibility
    const providerStatus = SUPPORTED_PROVIDERS.reduce(
      (acc, provider) => {
        acc[provider] = false
        return acc
      },
      {} as Record<string, boolean>
    )

    return NextResponse.json(providerStatus)
  } catch (err) {
    console.error("Key status error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
