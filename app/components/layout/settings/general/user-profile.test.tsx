/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { userProfileFixture } from "./fixtures/user-profile.fixture"
import { UserProfile } from "./user-profile"

const profileMocks = vi.hoisted(() => ({
  isLoading: false,
  uploadProfileImage: vi.fn(async () => "https://images.test/avatar.png"),
  updateUser: vi.fn(async () => {}),
  user: null as typeof userProfileFixture | null,
  validateFile: vi.fn(async () => ({ isValid: true })),
}))

vi.mock("@/lib/file/validation", () => ({
  validateFile: profileMocks.validateFile,
}))

vi.mock("@/lib/user/profile-image", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/user/profile-image")
  >("@/lib/user/profile-image")
  return {
    ProfileImageUploadError: actual.ProfileImageUploadError,
    uploadProfileImage: profileMocks.uploadProfileImage,
  }
})

vi.mock("@/lib/user-store/provider", () => ({
  useUser: () => profileMocks,
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("UserProfile", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    profileMocks.user = null
    profileMocks.isLoading = false
    vi.clearAllMocks()
  })

  function renderProfile() {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<UserProfile />))
  }

  it("renders the authenticated profile as settings rows", () => {
    profileMocks.user = userProfileFixture
    renderProfile()

    expect(container?.textContent).toContain("Profile picture")
    expect(container?.textContent).toContain("Email")
    expect(container?.textContent).toContain(userProfileFixture.email)
    expect(
      container?.querySelector<HTMLInputElement>("#settings-full-name")?.value
    ).toBe(userProfileFixture.display_name)
    expect(
      container?.querySelector("[data-slot=settings-field-group]")
    ).toBeInstanceOf(HTMLDivElement)
    expect(container?.querySelector("a")?.getAttribute("href")).toBe(
      `mailto:${userProfileFixture.email}`
    )
    expect(
      container?.querySelector<HTMLButtonElement>(
        'button[aria-label="Change profile picture"]'
      )
    ).toBeInstanceOf(HTMLButtonElement)
  })

  it("reflects profile name updates for the same authenticated user", async () => {
    profileMocks.user = userProfileFixture
    renderProfile()

    profileMocks.user = {
      ...userProfileFixture,
      display_name: "Avery Morgan",
    }
    act(() => root?.render(<UserProfile />))

    const input = container?.querySelector<HTMLInputElement>(
      "#settings-full-name"
    )
    expect(input?.value).toBe("Avery Morgan")

    await act(async () => {
      input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    })

    expect(profileMocks.updateUser).not.toHaveBeenCalled()
  })

  it("preserves an edited name draft across same-user profile updates", () => {
    profileMocks.user = userProfileFixture
    renderProfile()

    const input = container?.querySelector<HTMLInputElement>(
      "#settings-full-name"
    )
    act(() => {
      if (!input) throw new Error("Full name input missing")
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set
      valueSetter?.call(input, "Avery Draft")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    profileMocks.user = {
      ...userProfileFixture,
      display_name: "Avery Morgan",
    }
    act(() => root?.render(<UserProfile />))

    expect(input?.value).toBe("Avery Draft")
  })

  it("opens the profile-image picker from the complete row", () => {
    profileMocks.user = userProfileFixture
    renderProfile()

    const button = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Change profile picture"]'
    )
    const input = container?.querySelector<HTMLInputElement>(
      "#settings-profile-image"
    )
    const pickerClick = vi.spyOn(input as HTMLInputElement, "click")

    act(() => button?.click())

    expect(pickerClick).toHaveBeenCalledTimes(1)
    expect(button?.textContent).toContain("Profile picture")
    const hoverOverlay = button?.querySelector<HTMLElement>(
      ".group-hover\\/settings-field-surface\\:opacity-100"
    )
    expect(hoverOverlay).toBeInstanceOf(HTMLSpanElement)
    expect(hoverOverlay?.className).toContain("bg-popover")
    expect(
      button
        ?.querySelector<HTMLElement>("[data-slot=icon]")
        ?.style.getPropertyValue("--icon-slot-size")
    ).toBe("24px")
    expect(
      button
        ?.querySelector<HTMLElement>("[data-slot=icon]")
        ?.style.getPropertyValue("--icon-glyph-size")
    ).toBe("24px")
  })

  it("disables profile-image selection while the profile is loading", () => {
    profileMocks.user = userProfileFixture
    profileMocks.isLoading = true
    renderProfile()

    const button = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Change profile picture"]'
    )
    const input = container?.querySelector<HTMLInputElement>(
      "#settings-profile-image"
    )

    expect(button?.disabled).toBe(true)
    expect(button?.hasAttribute("data-disabled")).toBe(true)
    expect(input?.disabled).toBe(true)
  })

  it("uploads and persists a selected profile image", async () => {
    profileMocks.user = userProfileFixture
    renderProfile()

    const input = container?.querySelector<HTMLInputElement>(
      "#settings-profile-image"
    )
    const file = new File(["image"], "avatar.png", { type: "image/png" })
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    })

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(profileMocks.validateFile).toHaveBeenCalledWith(file)
    expect(profileMocks.uploadProfileImage).toHaveBeenCalledWith(file)
    expect(profileMocks.updateUser).toHaveBeenCalledWith({
      profile_image: "https://images.test/avatar.png",
    })
  })

  it("shows the upload's own message when it fails with a known reason", async () => {
    const { ProfileImageUploadError } = await import("@/lib/user/profile-image")
    profileMocks.user = userProfileFixture
    profileMocks.uploadProfileImage.mockRejectedValueOnce(
      new ProfileImageUploadError("Choose an image under 10MB.")
    )
    renderProfile()

    const input = container?.querySelector<HTMLInputElement>(
      "#settings-profile-image"
    )
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["image"], "avatar.png", { type: "image/png" })],
    })

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(
      container?.querySelector("#settings-profile-image-error")?.textContent
    ).toBe("Choose an image under 10MB.")
    expect(profileMocks.updateUser).not.toHaveBeenCalled()
  })

  it("focuses the full-name editor when its row is clicked", () => {
    profileMocks.user = userProfileFixture
    renderProfile()

    const input = container?.querySelector<HTMLInputElement>(
      "#settings-full-name"
    )
    const rowLabel = input?.closest("label")

    act(() => rowLabel?.click())

    expect(document.activeElement).toBe(input)
  })

  it("saves a trimmed full name when the field loses focus", async () => {
    profileMocks.user = userProfileFixture
    renderProfile()

    const input = container?.querySelector<HTMLInputElement>(
      "#settings-full-name"
    )

    await act(async () => {
      if (!input) throw new Error("Full name input missing")
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set
      valueSetter?.call(input, "  Avery Morgan  ")
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    })

    expect(profileMocks.updateUser).toHaveBeenCalledWith({
      display_name: "Avery Morgan",
    })
  })

  it("saves the full name on Enter", async () => {
    profileMocks.user = userProfileFixture
    renderProfile()

    const input = container?.querySelector<HTMLInputElement>(
      "#settings-full-name"
    )
    const form = input?.closest("form")

    await act(async () => {
      if (!input || !form) throw new Error("Full name editor missing")
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set
      valueSetter?.call(input, "Avery Morgan")
      input.dispatchEvent(new Event("input", { bubbles: true }))
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true })
      )
    })

    expect(profileMocks.updateUser).toHaveBeenCalledWith({
      display_name: "Avery Morgan",
    })
  })

  it("applies the responsive visual contract to the rendered name editor", () => {
    profileMocks.user = userProfileFixture
    renderProfile()

    const input = container?.querySelector<HTMLInputElement>(
      "#settings-full-name"
    )
    const surface = input?.closest<HTMLElement>(
      "[data-slot=settings-field-surface]"
    )

    expect(surface?.classList).toContain("focus-within:bg-row-hover")
    expect(surface?.classList).toContain("sm:pr-2.5")
    expect(input?.classList).toContain("border-input-border")
    expect(input?.classList).toContain("bg-popover")
    expect(input?.classList).toContain("hover:border-foreground")
    expect(input?.classList).toContain("sm:field-sizing-content")
    expect(input?.classList).toContain("sm:min-w-56")
    expect(input?.classList).toContain("transition-none")
  })
})
