import "server-only"
import { ConvexHttpClient } from "convex/browser"
import { NextResponse } from "next/server"

export { getConvexSiteUrl } from "./convex-site-url"

export function createConvexHttpClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set")
  }

  return new ConvexHttpClient(url)
}

export function createAuthenticatedConvexClient(accessToken: string) {
  const convex = createConvexHttpClient()
  convex.setAuth(accessToken)
  return convex
}

export function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export function unauthorizedError() {
  return jsonError("Unauthorized", 401)
}

export function internalServerError() {
  return jsonError("Internal server error", 500)
}
