/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { SettingsContent } from "./settings-content"

const settingsContentMocks = vi.hoisted(() => ({
  isMobile: true,
}))

vi.mock("@/app/hooks/use-scroll-attributes", () => ({
  useScrollAttributes: vi.fn(),
}))

vi.mock("@/components/ui/icon", () => ({
  Icon: () => <span aria-hidden="true" />,
}))

vi.mock("@/hooks/use-breakpoint", () => ({
  useBreakpoint: () => settingsContentMocks.isMobile,
}))

vi.mock("./apikeys/byok-section", () => ({
  ByokSection: () => <div>API keys</div>,
}))

vi.mock("./appearance/interaction-preferences", () => ({
  InteractionPreferences: () => <div>Interaction preferences</div>,
}))

vi.mock("./appearance/layout-settings", () => ({
  LayoutSettings: () => <div>Layout settings</div>,
}))

vi.mock("./appearance/theme-selection", () => ({
  ThemeSelection: () => <div>Theme selection</div>,
}))

vi.mock("./connections/developer-tools", () => ({
  DeveloperTools: () => <div>Developer tools</div>,
}))

vi.mock("./connections/mcp-servers", () => ({
  McpServers: () => <div>MCP servers</div>,
}))

vi.mock("./general/account-management", () => ({
  SettingsSignOutButton: () => <button type="button">Sign out</button>,
}))

vi.mock("./general/user-profile", () => ({
  UserProfile: () => <div>User profile</div>,
}))

vi.mock("./models/models-settings", () => ({
  ModelsSettings: () => <div>Models settings</div>,
}))

vi.mock("./settings-page-header", () => ({
  SettingsCloseButton: () => <button type="button">Close</button>,
  SettingsPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

vi.mock("./tools/tool-keys", () => ({
  ToolKeys: () => <div>Tool keys</div>,
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("SettingsContent", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    settingsContentMocks.isMobile = true
  })

  it("keeps the sign-out action available on mobile", async () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<SettingsContent />)
    })

    const signOutButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button")
    ).find((button) => button.textContent === "Sign out")

    expect(signOutButton).toBeTruthy()
  })
})
