import "server-only"
import { api } from "@/convex/_generated/api"
import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  validateCsrfDoubleSubmit,
} from "@/lib/csrf"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import {
  createAuthenticatedConvexClient,
  jsonError,
  unauthorizedError,
} from "./convex"

/**
 * The authenticated-route seam for Next.js API handlers — the HTTP-layer
 * counterpart to ADR-0003's Convex `authenticatedMutation` builders.
 *
 * Before this, every mutation route re-derived the same prologue by hand
 * (`getAuthenticatedWorkosSession()` → 401, then build a Convex client) and
 * *none* validated CSRF, so the token the client faithfully attached was never
 * checked. A route wrapped here cannot run its body without a verified session,
 * and — for unsafe methods — cannot run without a valid CSRF double-submit. CSRF
 * is checked after auth so anonymous unsafe requests still receive the normal
 * 401 response. The check moves in front of the handler instead of being a helper
 * each route has to remember to call. See ADR-0010.
 */

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

type AuthedSession = NonNullable<
  Awaited<ReturnType<typeof getAuthenticatedWorkosSession>>
>

export type AuthedRouteContext = {
  session: AuthedSession
  /** A Convex client already bound to the caller's WorkOS access token. */
  convex: ReturnType<typeof createAuthenticatedConvexClient>
}

/**
 * Declarative per-identity rate limit for a route. `bucket` names the limit so
 * separate routes don't share a counter. Enforced after auth (so the actor is
 * the resolved user) and before the handler body.
 */
export type RouteRateLimit = { bucket: string; limit: number; windowMs: number }

/**
 * Validate the CSRF double-submit for a state-changing request. Returns a 403
 * response on failure, or `null` when the request may proceed.
 */
export async function assertCsrf(req: Request): Promise<NextResponse | null> {
  const header = req.headers.get(CSRF_HEADER_NAME)
  const cookie = (await cookies()).get(CSRF_COOKIE_NAME)?.value
  if (!validateCsrfDoubleSubmit(header, cookie)) {
    return jsonError("Invalid or missing CSRF token", 403)
  }
  return null
}

/**
 * Wrap a route handler so it runs only for an authenticated caller, with CSRF
 * enforced on unsafe methods. The handler receives the resolved session and a
 * pre-authenticated Convex client. Extra Next.js route args (e.g. the
 * `{ params }` object for dynamic segments) are passed through unchanged.
 *
 * @param opts.csrf - Set `false` only for a route that is genuinely exempt
 *   (none today); defaults to enforcing CSRF on POST/PUT/PATCH/DELETE.
 * @param opts.rateLimit - Optional per-identity throttle enforced after auth.
 */
export function authenticatedRoute<Rest extends unknown[]>(
  handler: (
    req: Request,
    ctx: AuthedRouteContext,
    ...rest: Rest
  ) => Promise<Response> | Response,
  opts: { csrf?: boolean; rateLimit?: RouteRateLimit } = {}
): (req: Request, ...rest: Rest) => Promise<Response> {
  const enforceCsrf = opts.csrf ?? true

  return async (req: Request, ...rest: Rest): Promise<Response> => {
    const session = await getAuthenticatedWorkosSession()
    if (!session) return unauthorizedError()

    if (enforceCsrf && UNSAFE_METHODS.has(req.method.toUpperCase())) {
      const csrfError = await assertCsrf(req)
      if (csrfError) return csrfError
    }

    const convex = createAuthenticatedConvexClient(session.accessToken)

    if (opts.rateLimit) {
      const rateLimitError = await enforceRateLimit(convex, opts.rateLimit)
      if (rateLimitError) return rateLimitError
    }

    return handler(req, { session, convex }, ...rest)
  }
}

/**
 * Consume one unit against a per-identity limit. Returns a 429 with a
 * `Retry-After` header when the caller is over the ceiling, otherwise `null`.
 */
async function enforceRateLimit(
  convex: ReturnType<typeof createAuthenticatedConvexClient>,
  { bucket, limit, windowMs }: RouteRateLimit
): Promise<NextResponse | null> {
  const result = await convex.mutation(api.rateLimits.consume, {
    bucket,
    limit,
    windowMs,
  })
  if (result.allowed) return null

  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000))
  return NextResponse.json(
    { error: "Rate limit exceeded", code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  )
}
