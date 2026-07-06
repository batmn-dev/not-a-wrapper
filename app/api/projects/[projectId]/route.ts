import { authenticatedRoute } from "@/app/api/_lib/authenticated-route"
import { internalServerError, jsonError } from "@/app/api/_lib/convex"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { NextResponse } from "next/server"

type ProjectRouteArg = { params: Promise<{ projectId: string }> }

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

export const GET = authenticatedRoute(
  async (_request, { session, convex }, { params }: ProjectRouteArg) => {
    try {
      const { projectId } = await params

      // Validate project ID format
      const convexId = toConvexId(projectId)
      if (!convexId) {
        return jsonError("Invalid project ID", 400)
      }

      // getById has built-in ownership checks — returns null if the caller
      // doesn't own the project.
      const project = await convex.query(api.projects.getById, {
        projectId: convexId,
      })

      // getById returns null if: project doesn't exist OR user doesn't own it
      // We return 404 for both cases (don't reveal existence)
      if (!project) {
        return jsonError("Project not found", 404)
      }

      return NextResponse.json({
        id: project._id,
        name: project.name,
        user_id: session.userId,
        created_at: new Date(project._creationTime).toISOString(),
      })
    } catch (err: unknown) {
      console.error("Error in project endpoint:", err)
      return internalServerError()
    }
  }
)

export const PUT = authenticatedRoute(
  async (request, { session, convex }, { params }: ProjectRouteArg) => {
    let name: string | undefined
    try {
      const body: unknown = await request.json()
      const candidate =
        body && typeof body === "object"
          ? (body as { name?: unknown }).name
          : undefined
      name = typeof candidate === "string" ? candidate : undefined
    } catch {
      return jsonError("Invalid JSON body", 400)
    }

    try {
      const { projectId } = await params

      if (!name?.trim()) {
        return jsonError("Project name is required", 400)
      }

      // Validate project ID format
      const convexId = toConvexId(projectId)
      if (!convexId) {
        return jsonError("Invalid project ID", 400)
      }

      await convex.mutation(api.projects.updateName, {
        projectId: convexId,
        name: name.trim(),
      })

      return NextResponse.json({
        id: projectId,
        name: name.trim(),
        user_id: session.userId,
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
)

export const DELETE = authenticatedRoute(
  async (_request, { convex }, { params }: ProjectRouteArg) => {
    try {
      const { projectId } = await params

      // Validate project ID format
      const convexId = toConvexId(projectId)
      if (!convexId) {
        return jsonError("Invalid project ID", 400)
      }

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
)
