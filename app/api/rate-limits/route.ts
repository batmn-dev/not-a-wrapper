import { internalServerError } from "@/app/api/_lib/convex"
import { getWorkosSession } from "@/lib/auth/workos"
import { getMessageUsage } from "./api"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const anonymousId = searchParams.get("userId") ?? undefined

  try {
    const authSession = await getWorkosSession()
    const isAuthenticated = !!authSession.user

    if (!isAuthenticated && !anonymousId) {
      return new Response(
        JSON.stringify({
          error: "Missing user identification",
          code: "MISSING_USER_ID",
          message:
            "Either authentication or anonymousId is required for usage tracking",
        }),
        { status: 400 }
      )
    }

    const convexToken = isAuthenticated ? authSession.accessToken : undefined

    const usage = await getMessageUsage(
      convexToken,
      anonymousId,
      isAuthenticated
    )

    return new Response(JSON.stringify(usage), { status: 200 })
  } catch (err: unknown) {
    console.error("Error in /api/rate-limits:", err)
    return internalServerError()
  }
}
