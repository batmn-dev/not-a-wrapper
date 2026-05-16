import { ConvexHttpClient } from "convex/browser"
import { api } from "@/convex/_generated/api"
import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { NextRequest, NextResponse } from "next/server"
import { resolveModelIds } from "@/lib/models/model-id-migration"

/**
 * Favorite Models API
 * Fetches and updates favorite models via Convex
 */

function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set")
  }
  return new ConvexHttpClient(url)
}

export async function POST(request: NextRequest) {
  try {
    const authSession = await getAuthenticatedWorkosSession()

    if (!authSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Parse the request body
    const body = await request.json()
    const { favorite_models } = body

    // Validate the favorite_models array
    if (!Array.isArray(favorite_models)) {
      return NextResponse.json(
        { error: "favorite_models must be an array" },
        { status: 400 }
      )
    }

    // Validate that all items in the array are strings
    if (!favorite_models.every((model) => typeof model === "string")) {
      return NextResponse.json(
        { error: "All favorite_models must be strings" },
        { status: 400 }
      )
    }
    const normalizedFavoriteModels = resolveModelIds(favorite_models)

    // Update favorite models in Convex with authenticated client
    const convex = getConvexClient()
    convex.setAuth(authSession.accessToken)
    await convex.mutation(api.users.updateFavoriteModels, {
      favoriteModels: normalizedFavoriteModels,
    })

    return NextResponse.json({
      success: true,
      favorite_models: normalizedFavoriteModels,
    })
  } catch (error) {
    console.error("Error in favorite-models API:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const authSession = await getAuthenticatedWorkosSession()

    if (!authSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Fetch user's favorite models from Convex with authenticated client
    const convex = getConvexClient()
    convex.setAuth(authSession.accessToken)
    const user = await convex.query(api.users.getCurrent, {})
    const favoriteModels = user?.favoriteModels ?? []
    const normalizedFavoriteModels = resolveModelIds(favoriteModels)

    if (JSON.stringify(normalizedFavoriteModels) !== JSON.stringify(favoriteModels)) {
      await convex.mutation(api.users.updateFavoriteModels, {
        favoriteModels: normalizedFavoriteModels,
      })
    }

    return NextResponse.json({
      favorite_models: normalizedFavoriteModels,
    })
  } catch (error) {
    console.error("Error in favorite-models GET API:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
