/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

type CapturedAuth = {
  fetchAccessToken: (args?: {
    forceRefreshToken?: boolean
  }) => Promise<string | null>
  isAuthenticated: boolean
  isLoading: boolean
}

const providerMocks = vi.hoisted(() => ({
  capturedAuth: null as CapturedAuth | null,
  getAccessToken: vi.fn(),
  refresh: vi.fn(),
  accessTokenLoading: false,
  authLoading: false,
  user: { id: "user_123" } as { id: string } | null,
}))

vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  useAccessToken: () => ({
    getAccessToken: providerMocks.getAccessToken,
    loading: providerMocks.accessTokenLoading,
    refresh: providerMocks.refresh,
  }),
  useAuth: () => ({
    loading: providerMocks.authLoading,
    user: providerMocks.user,
  }),
}))

vi.mock("convex/react", async () => {
  const ReactModule = await import("react")

  return {
    ConvexProviderWithAuth: ({
      children,
      useAuth,
    }: {
      children: React.ReactNode
      useAuth: () => CapturedAuth
    }) => {
      providerMocks.capturedAuth = useAuth()
      return ReactModule.createElement(ReactModule.Fragment, null, children)
    },
    ConvexReactClient: class MockConvexReactClient {
      url: string

      constructor(url: string) {
        this.url = url
      }
    },
  }
})

process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:3210"

async function renderProvider() {
  const { ConvexClientProvider } = await import("./convex-client-provider")
  const container = document.createElement("div")
  document.body.appendChild(container)

  const root = createRoot(container)
  await act(async () => {
    root.render(
      <ConvexClientProvider>
        <span>Child</span>
      </ConvexClientProvider>
    )
  })

  if (!providerMocks.capturedAuth) {
    throw new Error("Convex auth hook was not captured")
  }

  return {
    auth: providerMocks.capturedAuth,
    cleanup: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe("ConvexClientProvider", () => {
  let cleanup: (() => void) | undefined

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    providerMocks.capturedAuth = null
    providerMocks.getAccessToken.mockReset()
    providerMocks.refresh.mockReset()
    providerMocks.accessTokenLoading = false
    providerMocks.authLoading = false
    providerMocks.user = { id: "user_123" }
  })

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    vi.restoreAllMocks()
  })

  it("returns null without a client console error when AuthKit refresh fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    providerMocks.refresh.mockRejectedValueOnce(
      new Error("Failed to refresh access token")
    )
    const rendered = await renderProvider()
    cleanup = rendered.cleanup

    await expect(
      rendered.auth.fetchAccessToken({ forceRefreshToken: true })
    ).resolves.toBeNull()

    expect(providerMocks.refresh).toHaveBeenCalledTimes(1)
    expect(providerMocks.getAccessToken).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it("does not report Convex auth loading during an AuthKit token refresh", async () => {
    providerMocks.accessTokenLoading = true

    const rendered = await renderProvider()
    cleanup = rendered.cleanup

    expect(rendered.auth.isAuthenticated).toBe(true)
    expect(rendered.auth.isLoading).toBe(false)
  })

  it("still logs unexpected access-token failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const unexpectedError = new Error("Unexpected token store failure")
    providerMocks.getAccessToken.mockRejectedValueOnce(unexpectedError)
    const rendered = await renderProvider()
    cleanup = rendered.cleanup

    await expect(rendered.auth.fetchAccessToken()).resolves.toBeNull()

    expect(providerMocks.getAccessToken).toHaveBeenCalledTimes(1)
    expect(providerMocks.refresh).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      "[ConvexClientProvider] Failed to get access token:",
      unexpectedError
    )
  })
})
