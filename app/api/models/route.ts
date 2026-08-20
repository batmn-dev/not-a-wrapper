import { getAllModels, getVisibleLogicalModelViews } from "@/lib/models"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    // One entry per visible logical model (ADR-0020). `accessible` is only
    // the platform half; the client ORs in per-route key presence and the
    // chat route's resolver stays authoritative at admission.
    const models = getVisibleLogicalModelViews()

    return new Response(JSON.stringify({ models }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    })
  } catch (error) {
    console.error("Error fetching models:", error)
    return new Response(JSON.stringify({ error: "Failed to fetch models" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    })
  }
}

export async function POST() {
  try {
    const models = getVisibleLogicalModelViews()
    const allModels = await getAllModels()

    return NextResponse.json({
      message: "Models refreshed",
      models,
      timestamp: new Date().toISOString(),
      count: models.length,
      routableCount: allModels.length,
    })
  } catch (error) {
    console.error("Failed to refresh models:", error)
    return NextResponse.json(
      { error: "Failed to refresh models" },
      { status: 500 }
    )
  }
}
