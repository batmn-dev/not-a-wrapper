import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { redirect } from "next/navigation"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Page from "./page"

vi.mock("@/lib/auth/workos", () => ({
  getAuthenticatedWorkosSession: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

const mockGetAuthenticatedWorkosSession = vi.mocked(
  getAuthenticatedWorkosSession
)
const mockRedirect = vi.mocked(redirect)

describe("/c/[chatId] page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders local chat routes without requiring WorkOS auth", async () => {
    // The segment renders null — the Chat surface lives in the persistent
    // (chat)/layout.tsx (adoption-loss fix). Not throwing IS the pass.
    await expect(
      Page({ params: Promise.resolve({ chatId: "local-123" }) })
    ).resolves.toBeNull()

    expect(mockGetAuthenticatedWorkosSession).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("keeps server chat routes auth-gated", async () => {
    mockGetAuthenticatedWorkosSession.mockResolvedValue(null)

    await expect(
      Page({ params: Promise.resolve({ chatId: "server-chat-id" }) })
    ).rejects.toThrow("redirect:/")

    expect(mockGetAuthenticatedWorkosSession).toHaveBeenCalledOnce()
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })
})
