import { afterEach, describe, expect, it, vi } from "vitest"
import { GET } from "./route"

function request(domain?: string): Request {
  const url = new URL("http://test.local/api/favicon")
  if (domain) url.searchParams.set("domain", domain)
  return new Request(url)
}

describe("/api/favicon route", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("forwards successful image responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("favicon", {
        headers: { "Content-Type": "image/png" },
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const response = await GET(request("example.com"))

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    await expect(response.text()).resolves.toBe("favicon")
  })

  it("turns an upstream missing image into an empty response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("generic fallback", {
          status: 404,
          headers: { "Content-Type": "image/png" },
        })
      )
    )

    const response = await GET(request("example.com"))

    expect(response.status).toBe(204)
    await expect(response.text()).resolves.toBe("")
  })

  it("bounds upstream requests and handles timeouts as unavailable", async () => {
    const timeoutSignal = new AbortController().signal
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal)
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("The operation timed out", "TimeoutError"))
    vi.stubGlobal("fetch", fetchMock)

    const response = await GET(request("example.com"))

    expect(timeoutSpy).toHaveBeenCalledWith(5_000)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ signal: timeoutSignal })
    )
    expect(response.status).toBe(204)
    await expect(response.text()).resolves.toBe("")
  })
})
