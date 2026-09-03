/** @vitest-environment jsdom */

import type { UserProfile } from "@/lib/user/types"
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
import { mergeUserProfileWithConvexFields } from "./merge-user-profile"
import { UserProvider, useUser } from "./provider"

const providerMocks = vi.hoisted(() => ({
  authLoading: true,
  convexAuthenticated: true,
  convexUser: null as Record<string, unknown> | null | undefined,
  workosUser: null as Record<string, unknown> | null,
  mutation: vi.fn(),
}))

const pendingProfileImageUrl = "https://images.test/new-avatar.png"
const secondPendingProfileImageUrl =
  "https://images.test/second-user-avatar.png"
let capturedUpdateUser:
  ((updates: Partial<UserProfile>) => Promise<void>) | null = null

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
}))
vi.mock("convex-helpers/react/cache", () => ({
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
      last_active_at: "400",
      created_at: "100",
      favorite_models: ["anthropic/claude-sonnet-4"],
      system_prompt: "Keep answers terse",
    })
  })
})

function UserSnapshot() {
  const { user, updateUser } = useUser()

  return React.createElement(
    "div",
    {
      "data-created-at": user?.created_at ?? "",
      "data-display-name": user?.display_name ?? "",
      "data-favorite-models": user?.favorite_models?.join(",") ?? "loading",
      "data-profile-image": user?.profile_image ?? "",
      "data-premium": String(user?.premium ?? ""),
      "data-system-prompt": user?.system_prompt ?? "",
    },
    React.createElement("button", {
      "data-update-profile-image": "",
      onClick: () => void updateUser({ profile_image: pendingProfileImageUrl }),
    }),
    React.createElement("button", {
      "data-update-second-profile-image": "",
      onClick: () =>
        void updateUser({ profile_image: secondPendingProfileImageUrl }),
    }),
    React.createElement("button", {
      "data-capture-update-user": "",
      onClick: () => {
        capturedUpdateUser = updateUser
      },
    })
  )
}

describe("UserProvider", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
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
    capturedUpdateUser = null
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

  function setAuthenticatedProfileUser() {
    providerMocks.authLoading = false
    providerMocks.workosUser = {
      id: "user-1",
      email: "user@example.com",
      firstName: "WorkOS",
      lastName: "User",
      profilePictureUrl: "https://workos.test/avatar.png",
      updatedAt: "2026-06-07T00:00:00.000Z",
    }
    providerMocks.convexUser = {
      _creationTime: 100,
      workosUserId: "user-1",
      profileImage: "https://workos.test/avatar.png",
      lastActiveAt: 100,
    }
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
    expect(snapshot?.getAttribute("data-favorite-models")).toBe("")
    expect(snapshot?.getAttribute("data-premium")).toBe("true")
    expect(snapshot?.getAttribute("data-system-prompt")).toBe("Be concise")
    expect(snapshot?.getAttribute("data-created-at")).toBe("100")
  })

  it("keeps a local profile image until Convex confirms it", async () => {
    setAuthenticatedProfileUser()
    renderProvider()

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>("[data-update-profile-image]")
        ?.click()
    })

    providerMocks.convexUser = {
      ...providerMocks.convexUser,
      lastActiveAt: 200,
    }
    renderProvider()

    let snapshot = container?.querySelector("div")
    expect(snapshot?.getAttribute("data-profile-image")).toBe(
      pendingProfileImageUrl
    )

    providerMocks.convexUser = {
      ...providerMocks.convexUser,
      profileImageOverride: pendingProfileImageUrl,
    }
    renderProvider()

    providerMocks.convexUser = {
      ...providerMocks.convexUser,
      profileImageOverride: undefined,
    }
    renderProvider()

    snapshot = container?.querySelector("div")
    expect(snapshot?.getAttribute("data-profile-image")).toBe(
      "https://workos.test/avatar.png"
    )
  })

  it("does not retain a pending image when Convex already confirmed it", async () => {
    setAuthenticatedProfileUser()
    renderProvider()

    providerMocks.convexUser = {
      ...providerMocks.convexUser,
      profileImageOverride: pendingProfileImageUrl,
    }
    renderProvider()

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>("[data-update-profile-image]")
        ?.click()
    })

    providerMocks.convexUser = {
      ...providerMocks.convexUser,
      profileImageOverride: undefined,
    }
    renderProvider()

    const snapshot = container?.querySelector("div")
    expect(snapshot?.getAttribute("data-profile-image")).toBe(
      "https://workos.test/avatar.png"
    )
  })

  it("does not apply one user's pending profile image to another user", async () => {
    setAuthenticatedProfileUser()
    renderProvider()

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>("[data-update-profile-image]")
        ?.click()
    })

    providerMocks.workosUser = {
      id: "user-2",
      email: "other@example.com",
      firstName: "Other",
      lastName: "User",
      profilePictureUrl: "https://workos.test/other-avatar.png",
      updatedAt: "2026-06-07T00:00:00.000Z",
    }
    providerMocks.convexUser = {
      _creationTime: 200,
      workosUserId: "user-2",
      profileImage: "https://workos.test/other-avatar.png",
      lastActiveAt: 200,
    }
    renderProvider()

    const snapshot = container?.querySelector("div")
    expect(snapshot?.getAttribute("data-profile-image")).toBe(
      "https://workos.test/other-avatar.png"
    )
  })

  it("isolates a profile image callback that resumes after an account switch", async () => {
    setAuthenticatedProfileUser()
    renderProvider()

    container
      ?.querySelector<HTMLButtonElement>("[data-capture-update-user]")
      ?.click()

    providerMocks.workosUser = {
      id: "user-2",
      email: "other@example.com",
      firstName: "Other",
      lastName: "User",
      profilePictureUrl: "https://workos.test/other-avatar.png",
      updatedAt: "2026-06-07T00:00:00.000Z",
    }
    providerMocks.convexUser = {
      _creationTime: 200,
      workosUserId: "user-2",
      profileImage: "https://workos.test/other-avatar.png",
      lastActiveAt: 200,
    }
    renderProvider()

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>("[data-update-second-profile-image]")
        ?.click()
    })

    await act(async () => {
      await capturedUpdateUser?.({ profile_image: pendingProfileImageUrl })
    })

    providerMocks.convexUser = {
      ...providerMocks.convexUser,
      lastActiveAt: 300,
    }
    renderProvider()

    const snapshot = container?.querySelector("div")
    expect(snapshot?.getAttribute("data-profile-image")).toBe(
      secondPendingProfileImageUrl
    )
  })
})
