/** @vitest-environment jsdom */

import { readFileSync } from "node:fs"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { userProfileFixture } from "./fixtures/user-profile.fixture"
import { UserProfile } from "./user-profile"

const profileMocks = vi.hoisted(() => ({
  generateProfileImageUploadUrl: vi.fn(async () => "https://upload.test"),
  isLoading: false,
  saveProfileImage: vi.fn(async () => "https://images.test/avatar.png"),
  uploadBinaryWithProgress: vi.fn(async () => "storage-profile-image"),
  updateUser: vi.fn(async () => {}),
  user: null as typeof userProfileFixture | null,
  validateFile: vi.fn(async () => ({ isValid: true })),
}))

vi.mock("@/convex/_generated/api", () => ({
  api: {
    users: {
      generateProfileImageUploadUrl: "generateProfileImageUploadUrl",
      saveProfileImage: "saveProfileImage",
    },
  },
}))

vi.mock("convex/react", () => ({
  useMutation: (reference: string) =>
    reference === "generateProfileImageUploadUrl"
      ? profileMocks.generateProfileImageUploadUrl
      : profileMocks.saveProfileImage,
}))

vi.mock("@/lib/file-handling", () => ({
  uploadBinaryWithProgress: profileMocks.uploadBinaryWithProgress,
}))

vi.mock("@/lib/file/validation", () => ({
  validateFile: profileMocks.validateFile,
}))

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
    expect(profileMocks.generateProfileImageUploadUrl).toHaveBeenCalledWith({})
    expect(profileMocks.uploadBinaryWithProgress).toHaveBeenCalledWith(
      "https://upload.test",
      file
    )
    expect(profileMocks.saveProfileImage).toHaveBeenCalledWith({
      storageId: "storage-profile-image",
      fileType: "image/png",
    })
    expect(profileMocks.updateUser).toHaveBeenCalledWith({
      profile_image: "https://images.test/avatar.png",
    })
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

  it("uses responsive semantic-token classes without hardcoded colors", () => {
    const implementation = ["settings-row.tsx", "user-profile.tsx"]
      .map((fileName) =>
        readFileSync(new URL(fileName, import.meta.url), "utf8")
      )
      .join("\n")

    expect(implementation).toContain("border-border")
    expect(implementation).toContain("bg-popover")
    expect(implementation).toContain("bg-row-hover")
    expect(implementation).not.toContain("bg-interactive-hover")
    expect(implementation).not.toContain("bg-input-bg")
    expect(implementation).toContain("border-input-border")
    expect(implementation).toContain("hover:border-foreground")
    expect(implementation).toContain("sm:field-sizing-content")
    expect(implementation).toContain("sm:min-w-56")
    expect(implementation).toContain("sm:pr-2.5")
    expect(implementation).not.toContain("sm:min-w-40")
    expect(implementation).toContain("transition-none")
    expect(implementation).not.toContain("transition-colors")
    expect(implementation).not.toContain("transition-opacity")
    expect(implementation).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(implementation).not.toMatch(/\b(?:rgb|hsl|oklch|oklab)a?\(/i)
  })
})
