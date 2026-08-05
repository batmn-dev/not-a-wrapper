import { afterEach, describe, expect, it, vi } from "vitest"
import { POST } from "./route"

const routeMocks = vi.hoisted(() => ({
  getConvexSiteUrl: vi.fn(() => "https://deployment.convex.site"),
}))

vi.mock("@/app/api/_lib/authenticated-route", () => ({
  authenticatedRoute:
    (
      handler: (
        request: Request,
        context: { session: { accessToken: string } }
      ) => Promise<Response> | Response
    ) =>
    (request: Request) =>
      handler(request, { session: { accessToken: "workos-access-token" } }),
}))

vi.mock("@/app/api/_lib/convex", () => ({
  getConvexSiteUrl: routeMocks.getConvexSiteUrl,
  internalServerError: () =>
    Response.json({ error: "Internal server error" }, { status: 500 }),
  jsonError: (error: string, status: number) =>
    Response.json({ error }, { status }),
}))

function imageRequest(headers: HeadersInit = {}) {
  return new Request("https://app.test/api/profile-image", {
    method: "POST",
    headers: { "Content-Type": "image/png", ...headers },
    body: new Blob(["image"], { type: "image/png" }),
  })
}

describe("POST /api/profile-image", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("forwards the authenticated image body to the Convex HTTP action", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      Response.json({
        profileImageUrl: "https://images.test/avatar.png",
      })
    )
    vi.stubGlobal("fetch", upstreamFetch)

    const response = await POST(imageRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      profileImageUrl: "https://images.test/avatar.png",
    })
    expect(upstreamFetch).toHaveBeenCalledWith(
      "https://deployment.convex.site/profile-image",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer workos-access-token",
          "Content-Type": "image/png",
        },
        body: expect.any(Blob),
      })
    )
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("rejects unsupported image types without calling Convex", async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal("fetch", upstreamFetch)

    const response = await POST(
      new Request("https://app.test/api/profile-image", {
        method: "POST",
        headers: { "Content-Type": "image/svg+xml" },
        body: new Blob(["image"], { type: "image/svg+xml" }),
      })
    )

    expect(response.status).toBe(415)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it("rejects oversized requests before buffering or forwarding them", async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal("fetch", upstreamFetch)

    const response = await POST(
      imageRequest({ "Content-Length": String(10 * 1024 * 1024 + 1) })
    )

    expect(response.status).toBe(413)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it("caps oversized bodies mid-stream even without a Content-Length", async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal("fetch", upstreamFetch)

    const response = await POST(
      new Request("https://app.test/api/profile-image", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], {
          type: "image/png",
        }),
      })
    )

    expect(response.status).toBe(413)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it("rejects empty bodies without forwarding them", async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal("fetch", upstreamFetch)

    const response = await POST(
      new Request("https://app.test/api/profile-image", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
      })
    )

    expect(response.status).toBe(400)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it("forwards Retry-After and Content-Type from the Convex response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: "Profile image upload rate limit exceeded" }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "42",
            },
          }
        )
      )
    )

    const response = await POST(imageRequest())

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("42")
    expect(response.headers.get("Content-Type")).toBe("application/json")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("keeps proxy failures generic", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {})

    const response = await POST(imageRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Profile image upload proxy failed",
      expect.any(Error)
    )
  })
})
