import { authenticatedRoute } from "@/app/api/_lib/authenticated-route"
import { api } from "@/convex/_generated/api"
import { resolveModelIds } from "@/lib/models/model-id-migration"
import { NextResponse } from "next/server"

/**
 * Favorite Models API
 * Fetches and updates favorite models via Convex. Auth + CSRF via the seam.
 */

export const POST = authenticatedRoute(async (request, { convex }) => {
  try {
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
})

export const GET = authenticatedRoute(async (_request, { convex }) => {
  try {
    const user = await convex.query(api.users.getCurrent, {})
    const favoriteModels = user?.favoriteModels ?? []
    const normalizedFavoriteModels = resolveModelIds(favoriteModels)

    if (
      JSON.stringify(normalizedFavoriteModels) !==
      JSON.stringify(favoriteModels)
    ) {
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
})
