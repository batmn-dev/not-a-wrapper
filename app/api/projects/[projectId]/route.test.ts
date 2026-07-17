import { api } from "@/convex/_generated/api"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PUT } from "./route"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  convex: {
    mutation: vi.fn(),
    query: vi.fn(),
  },
  session: {
    userId: "user-1",
  },
}))

vi.mock("@/app/api/_lib/authenticated-route", () => ({
  authenticatedRoute: vi.fn(
    (
      handler: (
        request: Request,
        ctx: {
          session: { userId: string }
          convex: typeof mocks.convex
        },
        ...rest: unknown[]
      ) => Response | Promise<Response>
    ) =>
      (request: Request, ...rest: unknown[]) =>
        handler(
          request,
          { session: mocks.session, convex: mocks.convex },
          ...rest
        )
  ),
}))

function makeRequest(body: BodyInit): Request {
  return new Request("http://test.local/api/projects/project-123456", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  })
}

function routeArg() {
  return {
    params: Promise.resolve({ projectId: "project-123456" }),
  }
}

describe("PUT /api/projects/[projectId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.convex.mutation.mockResolvedValue(undefined)
  })

  it("returns 400 for malformed JSON without updating the project", async () => {
    const response = await PUT(makeRequest("{"), routeArg())

    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON body",
    })
    expect(response.status).toBe(400)
    expect(mocks.convex.mutation).not.toHaveBeenCalled()
  })

  it("returns 400 for a non-string project name", async () => {
    const response = await PUT(
      makeRequest(JSON.stringify({ name: 42 })),
      routeArg()
    )

    await expect(response.json()).resolves.toEqual({
      error: "Project name is required",
    })
    expect(response.status).toBe(400)
    expect(mocks.convex.mutation).not.toHaveBeenCalled()
  })

  it("trims and updates a valid project name", async () => {
    const response = await PUT(
      makeRequest(JSON.stringify({ name: "  Renamed  " })),
      routeArg()
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: "project-123456",
      name: "Renamed",
      user_id: "user-1",
    })
    expect(mocks.convex.mutation).toHaveBeenCalledWith(
      api.projects.updateName,
      {
        projectId: "project-123456",
        name: "Renamed",
      }
    )
  })
})
