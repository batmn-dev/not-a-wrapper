import { authenticatedRoute } from "@/app/api/_lib/authenticated-route"
import { Provider } from "@/lib/user-keys"
import { NextResponse } from "next/server"

/**
 * Check whether the platform has an env key for a provider. Auth + CSRF via the
 * seam; identity is the session's, never a client-supplied `userId`.
 */
export const POST = authenticatedRoute(async (request) => {
  try {
    const { provider } = await request.json()

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
})
