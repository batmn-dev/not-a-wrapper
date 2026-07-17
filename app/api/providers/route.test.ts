import { afterEach, describe, expect, it, vi } from "vitest"
import { POST } from "./route"

vi.mock("@/app/api/_lib/authenticated-route", () => ({
  authenticatedRoute:
    <Rest extends unknown[]>(
      handler: (
        request: Request,
        context: unknown,
        ...rest: Rest
      ) => Response | Promise<Response>
    ) =>
    (request: Request, ...rest: Rest) =>
      handler(request, {}, ...rest),
}))

vi.mock("@/app/api/_lib/convex", () => ({
  internalServerError: () =>
    Response.json({ error: "Internal server error" }, { status: 500 }),
  jsonError: (error: string, status: number) =>
    Response.json({ error }, { status }),
}))

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}))

const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

function makeRequest(body: string): Request {
  return new Request("http://test.local/api/providers", {
    method: "POST",
    body,
  })
}

describe("/api/providers route", () => {
  afterEach(() => {
    consoleErrorSpy.mockClear()
    vi.unstubAllEnvs()
  })

  it("returns 400 for malformed JSON", async () => {
    const response = await POST(makeRequest("{"))

    await expect(response.json()).resolves.toEqual({
      error: "Request body is not valid JSON",
    })
    expect(response.status).toBe(400)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it.each([
    ["missing provider", {}],
    ["non-object body", null],
  ])("returns 400 for %s", async (_case, body) => {
    const response = await POST(makeRequest(JSON.stringify(body)))

    await expect(response.json()).resolves.toEqual({
      error: "Provider is required",
    })
    expect(response.status).toBe(400)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it("keeps returning provider key status for valid provider requests", async () => {
    vi.stubEnv("OPENAI_API_KEY", "platform-key")

    const response = await POST(
      makeRequest(JSON.stringify({ provider: "openai" }))
    )

    await expect(response.json()).resolves.toEqual({
      hasEnvKey: true,
      hasUserKey: false,
      provider: "openai",
    })
    expect(response.status).toBe(200)
  })
})
