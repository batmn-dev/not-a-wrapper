import {
  createAuthenticatedConvexClient,
  internalServerError,
  jsonError,
  unauthorizedError,
} from "@/app/api/_lib/convex"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { NextRequest, NextResponse } from "next/server"

/**
 * Helper to safely convert string to Convex ID
 * Returns null if the string is not a valid Convex ID format
 */
function toConvexId(projectId: string): Id<"projects"> | null {
  // Convex IDs are base64-like strings, typically 32 chars
  // Basic validation to avoid throwing errors on invalid IDs
  if (!projectId || projectId.length < 10) return null
  try {
    return projectId as Id<"projects">
  } catch {
    return null
  }
}

/**
 * Single Project API
 * Fetches project from Convex with ownership verification
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const authSession = await getAuthenticatedWorkosSession()

    if (!authSession) {
      return unauthorizedError()
    }

    // Validate project ID format
    const convexId = toConvexId(projectId)
    if (!convexId) {
      return jsonError("Invalid project ID", 400)
    }

    // Fetch project from Convex with authenticated query
    // getById has built-in ownership checks - returns null if user doesn't own the project
    const convex = createAuthenticatedConvexClient(authSession.accessToken)

    const project = await convex.query(api.projects.getById, {
      projectId: convexId,
    })

    // getById returns null if: project doesn't exist OR user doesn't own it
    // We return 404 for both cases (security best practice - don't reveal existence)
    if (!project) {
      return jsonError("Project not found", 404)
    }

    // Return the actual project data
    return NextResponse.json({
      id: project._id,
      name: project.name,
      user_id: authSession.userId,
      created_at: new Date(project._creationTime).toISOString(),
    })
  } catch (err: unknown) {
    console.error("Error in project endpoint:", err)
    return internalServerError()
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const { name } = await request.json()

    if (!name?.trim()) {
      return jsonError("Project name is required", 400)
    }

    const authSession = await getAuthenticatedWorkosSession()

    if (!authSession) {
      return unauthorizedError()
    }

    // Validate project ID format
    const convexId = toConvexId(projectId)
    if (!convexId) {
      return jsonError("Invalid project ID", 400)
    }

    // Call Convex mutation with auth
    const convex = createAuthenticatedConvexClient(authSession.accessToken)

    await convex.mutation(api.projects.updateName, {
      projectId: convexId,
      name: name.trim(),
    })

    return NextResponse.json({
      id: projectId,
      name: name.trim(),
      user_id: authSession.userId,
      updated_at: new Date().toISOString(),
    })
  } catch (err: unknown) {
    console.error("Error updating project:", err)
    const message = (err as Error).message || "Internal server error"

    // Handle specific Convex errors
    if (
      message.includes("Not authorized") ||
      message.includes("Not authenticated")
    ) {
      return jsonError("Not authorized", 403)
    }
    if (message.includes("not found")) {
      return jsonError("Project not found", 404)
    }

    return internalServerError()
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const authSession = await getAuthenticatedWorkosSession()

    if (!authSession) {
      return unauthorizedError()
    }

    // Validate project ID format
    const convexId = toConvexId(projectId)
    if (!convexId) {
      return jsonError("Invalid project ID", 400)
    }

    // Call Convex mutation with auth
    const convex = createAuthenticatedConvexClient(authSession.accessToken)

    await convex.mutation(api.projects.remove, {
      projectId: convexId,
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error("Error deleting project:", err)
    const message = (err as Error).message || "Internal server error"

    // Handle specific Convex errors
    if (
      message.includes("Not authorized") ||
      message.includes("Not authenticated")
    ) {
      return jsonError("Not authorized", 403)
    }
    if (message.includes("not found")) {
      return jsonError("Project not found", 404)
    }

    return internalServerError()
  }
}
