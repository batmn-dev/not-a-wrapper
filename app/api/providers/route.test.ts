import { describe, expect, it, vi } from "vitest"
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
  jsonError: (error: string, status: number) =>
    Response.json({ error }, { status }),
  internalServerError: () =>
    Response.json({ error: "Internal server error" }, { status: 500 }),
}))

describe("/api/providers route", () => {
  it("returns 400 for malformed JSON", async () => {
    const response = await POST(
      new Request("http://test.local/api/providers", {
        method: "POST",
        body: "{",
      })
    )

    await expect(response.json()).resolves.toEqual({
      error: "Request body is not valid JSON",
    })
    expect(response.status).toBe(400)
  })

  it.each([
    ["missing provider", {}],
    ["empty provider", { provider: "" }],
    ["non-string provider", { provider: 123 }],
    ["non-object body", null],
  ])("returns 400 for %s", async (_case, body) => {
    const response = await POST(
      new Request("http://test.local/api/providers", {
        method: "POST",
        body: JSON.stringify(body),
      })
    )

    await expect(response.json()).resolves.toEqual({
      error: "Provider is required",
    })
    expect(response.status).toBe(400)
  })
})
