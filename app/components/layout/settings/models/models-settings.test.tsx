/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const settingsMocks = vi.hoisted(() => ({
  isModelHidden: vi.fn(() => false),
  models: [
    {
      id: "claude-sonnet-5",
      name: "Claude Sonnet 5",
      shortName: "Sonnet 5",
      provider: "Anthropic",
      providerId: "anthropic" as const,
      catalogStatus: "visible" as const,
      idKind: "stable" as const,
      baseProviderId: "anthropic",
      icon: "claude",
      accessible: true,
      routes: [
        { id: "claude-sonnet-5", providerId: "anthropic" as const },
        {
          id: "openrouter:anthropic/claude-sonnet-5",
          providerId: "openrouter" as const,
        },
      ],
    },
    {
      id: "claude-fable-5",
      name: "Claude Fable 5",
      shortName: "Story compact",
      provider: "Anthropic",
      providerId: "anthropic" as const,
      catalogStatus: "visible" as const,
      idKind: "stable" as const,
      baseProviderId: "anthropic",
      icon: "claude",
      accessible: true,
      routes: [{ id: "claude-fable-5", providerId: "anthropic" as const }],
    },
  ],
}))

vi.mock("@/lib/model-store/provider", () => ({
  useModel: () => ({ models: settingsMocks.models }),
}))

vi.mock("@/lib/user-preference-store/provider", () => ({
  useUserPreferences: () => ({ isModelHidden: settingsMocks.isModelHidden }),
}))

vi.mock("./use-favorite-models", () => ({
  useFavoriteModels: () => ({
    favoriteModels: ["claude-sonnet-5"],
    updateFavoriteModels: vi.fn(),
    updateFavoriteModelsDebounced: vi.fn(),
  }),
}))

vi.mock("framer-motion", () => ({
  Reorder: {
    Group: ({
      children,
      className,
    }: {
      children: React.ReactNode
      className?: string
    }) => (
      <div data-testid="reorder-group" className={className}>
        {children}
      </div>
    ),
    Item: ({
      children,
      className,
    }: {
      children: React.ReactNode
      className?: string
    }) => (
      <div data-testid="reorder-item" className={className}>
        {children}
      </div>
    ),
  },
}))

let ModelsSettings: typeof import("./models-settings").ModelsSettings

describe("ModelsSettings", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(async () => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    ;({ ModelsSettings } = await import("./models-settings"))
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    settingsMocks.isModelHidden.mockClear()
  })

  function renderSettings() {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(<ModelsSettings />)
    })

    return container
  }

  it("uses model presentation icons while vendor headings keep group identity", () => {
    const rendered = renderSettings()

    const favoriteItem = rendered.querySelector('[data-testid="reorder-item"]')
    const anthropicHeading = Array.from(rendered.querySelectorAll("h4")).find(
      (heading) => heading.textContent === "Anthropic"
    )

    expect(favoriteItem?.textContent).toContain("Claude Sonnet 5")
    expect(favoriteItem?.querySelector("svg.text-claude-logo")).not.toBeNull()
    expect(anthropicHeading).toBeTruthy()
    expect(
      anthropicHeading?.parentElement?.querySelector("svg.text-claude-logo")
    ).toBeNull()
  })

  it("searches compact names while rendering the full settings label", () => {
    const rendered = renderSettings()
    const searchInput = rendered.querySelector<HTMLInputElement>(
      'input[placeholder="Search models..."]'
    )

    act(() => {
      if (!searchInput) throw new Error("Missing model search input")
      const setInputValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set
      if (!setInputValue) throw new Error("Missing native input value setter")
      setInputValue.call(searchInput, "Story compact")
      searchInput.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(rendered.textContent).toContain("Claude Fable 5")
    expect(rendered.textContent).not.toContain("Story compact")
  })
})
