import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  generateCsrfToken,
} from "@/lib/csrf"
import type { User } from "@workos-inc/node"
import { RequestCookiesAdapter } from "next/dist/server/web/spec-extension/adapters/request-cookies"
import { RequestCookies } from "next/dist/server/web/spec-extension/cookies"
import { cookies } from "next/headers"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { authenticatedRoute } from "./authenticated-route"
import { createAuthenticatedConvexClient } from "./convex"

vi.mock("server-only", () => ({}))

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}))

vi.mock("@/lib/auth/workos", () => ({
  getAuthenticatedWorkosSession: vi.fn(),
}))

vi.mock("./convex", () => ({
  createAuthenticatedConvexClient: vi.fn(() => ({
    mutation: vi.fn(),
  })),
  jsonError: (error: string, status: number) =>
    Response.json({ error }, { status }),
  unauthorizedError: () =>
    Response.json({ error: "Unauthorized" }, { status: 401 }),
}))

const mockWorkosUser: User = {
  object: "user",
  id: "user_123",
  email: "user@example.test",
  emailVerified: true,
  profilePictureUrl: null,
  name: "Test User",
  firstName: "Test",
  lastName: "User",
  lastSignInAt: null,
  locale: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  externalId: null,
  metadata: {},
}

const mockSession = {
  accessToken: "test-access-token",
  user: mockWorkosUser,
  userId: "user_123",
}

function mockCookieValue(value: string | undefined) {
  const headers = new Headers()
  if (value) {
    headers.set("cookie", `${CSRF_COOKIE_NAME}=${value}`)
  }

  vi.mocked(cookies).mockResolvedValue(
    RequestCookiesAdapter.seal(new RequestCookies(headers))
  )
}

describe("authenticatedRoute", () => {
  beforeEach(() => {
    process.env.CSRF_SECRET = "test-csrf-secret-value"
    vi.clearAllMocks()
  })

  it("returns 401 for unauthenticated unsafe requests before checking CSRF", async () => {
    vi.mocked(getAuthenticatedWorkosSession).mockResolvedValue(null)
    mockCookieValue(undefined)

    const handler = vi.fn(() => Response.json({ ok: true }))
    const route = authenticatedRoute(handler)

    const response = await route(
      new Request("https://example.test/api", {
        method: "POST",
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" })
    expect(cookies).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
    expect(createAuthenticatedConvexClient).not.toHaveBeenCalled()
  })

  it("enforces CSRF for authenticated unsafe requests before creating Convex client", async () => {
    vi.mocked(getAuthenticatedWorkosSession).mockResolvedValue(mockSession)
    mockCookieValue(undefined)

    const handler = vi.fn(() => Response.json({ ok: true }))
    const route = authenticatedRoute(handler)

    const response = await route(
      new Request("https://example.test/api", {
        method: "POST",
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid or missing CSRF token",
    })
    expect(cookies).toHaveBeenCalledTimes(1)
    expect(handler).not.toHaveBeenCalled()
    expect(createAuthenticatedConvexClient).not.toHaveBeenCalled()
  })

  it("passes the resolved session and Convex client to authenticated CSRF-valid requests", async () => {
    vi.mocked(getAuthenticatedWorkosSession).mockResolvedValue(mockSession)
    const csrfToken = generateCsrfToken()
    mockCookieValue(csrfToken)

    const handler = vi.fn(() => Response.json({ ok: true }))
    const route = authenticatedRoute(handler)

    const response = await route(
      new Request("https://example.test/api", {
        method: "POST",
        headers: { [CSRF_HEADER_NAME]: csrfToken },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(createAuthenticatedConvexClient).toHaveBeenCalledWith(
      "test-access-token"
    )
    expect(handler).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        convex: expect.any(Object),
        session: mockSession,
      })
    )
  })
})
