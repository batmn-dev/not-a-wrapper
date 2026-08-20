import { authenticatedRoute } from "@/app/api/_lib/authenticated-route"
import { api } from "@/convex/_generated/api"
import { resolveModelSelections } from "@/lib/models/catalog"
import { NextResponse } from "next/server"

export const POST = authenticatedRoute(async (request, { convex }) => {
  try {
    const body = await request.json()
    const { favorite_models } = body

    if (!Array.isArray(favorite_models)) {
      return NextResponse.json(
        { error: "favorite_models must be an array" },
        { status: 400 }
      )
    }

    if (!favorite_models.every((model) => typeof model === "string")) {
      return NextResponse.json(
        { error: "All favorite_models must be strings" },
        { status: 400 }
      )
    }
    const normalizedFavoriteModels = resolveModelSelections(favorite_models)

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
    const normalizedFavoriteModels = resolveModelSelections(favoriteModels)

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
