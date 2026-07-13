import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "./route"

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock("server-only", () => ({}))

vi.mock("@/app/api/_lib/authenticated-route", () => ({
  authenticatedRoute:
    (handler: (...args: unknown[]) => Response | Promise<Response>) =>
    (request: Request, ...rest: unknown[]) =>
      handler(request, { convex: { query: mocks.query } }, ...rest),
}))

const params = (attachmentId = "attachment-1") => ({
  params: Promise.resolve({ attachmentId }),
})

describe("GET attachment preview", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("returns 404 when the authenticated Convex query cannot verify ownership", async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal("fetch", upstreamFetch)
    mocks.query.mockResolvedValueOnce(null)
    const response = await GET(
      new Request("http://localhost/api/files/attachment-1/preview"),
      params()
    )
    expect(response.status).toBe(404)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it("streams an owner-verified PDF inline and forwards byte ranges", async () => {
    mocks.query.mockResolvedValueOnce({
      url: "https://storage.example/report.pdf",
      fileName: "quarterly report.pdf",
      fileType: "application/pdf",
      fileSize: 4,
    })
    const upstreamFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toEqual({ Range: "bytes=0-1023" })
      return new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 206,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Range": "bytes 0-3/4",
          "Accept-Ranges": "bytes",
        },
      })
    })
    vi.stubGlobal("fetch", upstreamFetch)

    const response = await GET(
      new Request("http://localhost/api/files/attachment-1/preview", {
        headers: { Range: "bytes=0-1023" },
      }),
      params()
    )

    expect(response.status).toBe(206)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toContain(
      "quarterly%20report.pdf"
    )
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN")
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self'"
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([37, 80, 68, 70])
    )
  })
})
