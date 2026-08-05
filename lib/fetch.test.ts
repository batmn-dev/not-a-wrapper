/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchClient } from "./fetch"

describe("fetchClient", () => {
  afterEach(() => {
    document.cookie = "csrf_token=; Max-Age=0; path=/"
    vi.unstubAllGlobals()
  })

  it("preserves a caller-supplied content type while adding CSRF", async () => {
    document.cookie = "csrf_token=signed-token; path=/"
    const fetchMock = vi.fn().mockResolvedValue(new Response())
    vi.stubGlobal("fetch", fetchMock)
    const file = new File(["image"], "avatar.png", { type: "image/png" })

    await fetchClient("/api/profile-image", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: file,
    })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get("Content-Type")).toBe("image/png")
    expect(headers.get("x-csrf-token")).toBe("signed-token")
  })

  it("keeps JSON as the default content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response())
    vi.stubGlobal("fetch", fetchMock)

    await fetchClient("/api/example", { method: "POST", body: "{}" })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get("Content-Type")).toBe(
      "application/json"
    )
  })
})
