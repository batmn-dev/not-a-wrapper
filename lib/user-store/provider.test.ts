/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { UserProfile } from "@/lib/user/types"
import { mergeUserProfileWithConvexFields } from "./merge-user-profile"
import { UserProvider, useUser } from "./provider"

const providerMocks = vi.hoisted(() => ({
  authLoading: true,
  convexAuthenticated: true,
  convexUser: null as Record<string, unknown> | null | undefined,
  workosUser: null as Record<string, unknown> | null,
  mutation: vi.fn(),
}))

vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  useAuth: () => ({
    loading: providerMocks.authLoading,
    user: providerMocks.workosUser,
  }),
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: providerMocks.convexAuthenticated,
  }),
  useMutation: () => providerMocks.mutation,
  useQuery: () => providerMocks.convexUser,
}))

const baseUser: UserProfile = {
  id: "user-1",
  email: "user@example.com",
  display_name: "User",
  profile_image: null,
  anonymous: false,
  premium: null,
  message_count: null,
  daily_message_count: null,
  daily_reset: null,
  daily_pro_message_count: null,
  daily_pro_reset: null,
  last_active_at: null,
  created_at: null,
  favorite_models: null,
  system_prompt: null,
}

describe("mergeUserProfileWithConvexFields", () => {
  it("reflects Convex-managed premium and usage fields in user context", () => {
    expect(
      mergeUserProfileWithConvexFields(baseUser, {
        _creationTime: 100,
        displayName: "Convex User",
        anonymous: false,
        premium: true,
        messageCount: 12,
        dailyMessageCount: 3,
        dailyReset: 200,
        dailyProMessageCount: 2,
        dailyProReset: 300,
        lastActiveAt: 400,
        favoriteModels: ["openai/gpt-5"],
        systemPrompt: "Be concise",
      })
    ).toMatchObject({
      display_name: "Convex User",
      premium: true,
      message_count: 12,
      daily_message_count: 3,
      daily_reset: "200",
      daily_pro_message_count: 2,
      daily_pro_reset: "300",
      last_active_at: "400",
      created_at: "100",
      favorite_models: ["openai/gpt-5"],
      system_prompt: "Be concise",
    })
  })

  it("preserves existing profile fields when optional Convex fields are absent", () => {
    const existingUser: UserProfile = {
      ...baseUser,
      display_name: "Existing User",
      anonymous: true,
      premium: true,
      message_count: 8,
      daily_message_count: 4,
      daily_reset: "200",
      daily_pro_message_count: 2,
      daily_pro_reset: "300",
      last_active_at: "400",
      created_at: "50",
      favorite_models: ["anthropic/claude-sonnet-4"],
      system_prompt: "Keep answers terse",
    }

    expect(
      mergeUserProfileWithConvexFields(existingUser, {
        _creationTime: 100,
      })
    ).toMatchObject({
      display_name: "Existing User",
      anonymous: true,
      premium: true,
      message_count: 8,
      daily_message_count: 4,
      daily_reset: "200",
      daily_pro_message_count: 2,
      daily_pro_reset: "300",
      last_active_at: "400",
      created_at: "100",
      favorite_models: ["anthropic/claude-sonnet-4"],
      system_prompt: "Keep answers terse",
    })
  })
})

function UserSnapshot() {
  const { user } = useUser()

  return React.createElement("div", {
    "data-created-at": user?.created_at ?? "",
    "data-display-name": user?.display_name ?? "",
    "data-premium": String(user?.premium ?? ""),
    "data-system-prompt": user?.system_prompt ?? "",
  })
}

describe("UserProvider", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    providerMocks.authLoading = true
    providerMocks.convexAuthenticated = true
    providerMocks.convexUser = {
      _creationTime: 100,
      displayName: "Convex User",
      premium: true,
      systemPrompt: "Be concise",
    }
    providerMocks.workosUser = null
    providerMocks.mutation.mockReset()
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => {
        mountedRoot.unmount()
      })
    }

    container?.remove()
    container = null
    root = null
    vi.clearAllMocks()
  })

  function renderProvider() {
    if (!container) {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
    }

    act(() => {
      root?.render(
        React.createElement(
          UserProvider,
          {
            initialUser: null,
          },
          React.createElement(UserSnapshot)
        )
      )
    })
  }

  it("applies Convex-managed fields after WorkOS hydrates later", () => {
    renderProvider()

    providerMocks.authLoading = false
    providerMocks.workosUser = {
      id: "user-1",
      email: "user@example.com",
      firstName: "WorkOS",
      lastName: "User",
      profilePictureUrl: null,
      updatedAt: "2026-06-07T00:00:00.000Z",
    }

    renderProvider()

    const snapshot = container?.querySelector("div")

    expect(snapshot?.getAttribute("data-display-name")).toBe("Convex User")
    expect(snapshot?.getAttribute("data-premium")).toBe("true")
    expect(snapshot?.getAttribute("data-system-prompt")).toBe("Be concise")
    expect(snapshot?.getAttribute("data-created-at")).toBe("100")
  })
})
