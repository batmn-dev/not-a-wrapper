import { getWorkosSession } from "@/lib/auth/workos"
import { Provider } from "@/lib/user-keys"
import { NextRequest, NextResponse } from "next/server"

/**
 * Check if user has API key for a specific provider
 * Note: With Convex, this should be done client-side via userKeys queries
 */
export async function POST(request: NextRequest) {
  try {
    const { provider, userId } = await request.json()

    const { user: authUser } = await getWorkosSession()
    const authUserId = authUser?.id
    if (!authUserId || authUserId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // With Convex, key checking should be done client-side
    // Check if environment has a key for this provider
    const envKeyMap: Record<Provider, string | undefined> = {
      openai: process.env.OPENAI_API_KEY,
      mistral: process.env.MISTRAL_API_KEY,
      perplexity: process.env.PERPLEXITY_API_KEY,
      google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      xai: process.env.XAI_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    }

    const hasEnvKey = !!envKeyMap[provider as Provider]

    return NextResponse.json({
      hasUserKey: false, // User keys should be checked via Convex
      hasEnvKey,
      provider,
    })
  } catch (error) {
    console.error("Error checking provider keys:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
