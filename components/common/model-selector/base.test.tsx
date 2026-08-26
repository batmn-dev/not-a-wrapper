/** @vitest-environment jsdom */

import type { LogicalModelView } from "@/lib/models/catalog"
import { JSDOM } from "jsdom"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"

const { breakpointMocks, useKeyShortcutMock } = vi.hoisted(() => ({
  breakpointMocks: { isMobile: false },
  useKeyShortcutMock: vi.fn(),
}))

vi.mock("server-only", () => ({}))

let ModelSelector: typeof import("./base").ModelSelector
let testDom: JSDOM | null = null
let changeDropdownOpen: ((open: boolean) => void) | undefined
let completeDropdownOpenChange: ((open: boolean) => void) | undefined

function installDomIfNeeded() {
  if (typeof document !== "undefined") return

  testDom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  })

  Object.defineProperties(globalThis, {
    window: { value: testDom.window, configurable: true },
    document: { value: testDom.window.document, configurable: true },
    navigator: { value: testDom.window.navigator, configurable: true },
    HTMLElement: { value: testDom.window.HTMLElement, configurable: true },
    HTMLInputElement: {
      value: testDom.window.HTMLInputElement,
      configurable: true,
    },
    Event: { value: testDom.window.Event, configurable: true },
    MouseEvent: { value: testDom.window.MouseEvent, configurable: true },
  })
}

const modelSelectorMocks = {
  isModelHidden: vi.fn(
    (modelId: string) => modelId === "claude-haiku-4-5-20251001"
  ),
  models: [
    {
      id: "gpt-5.4",
      name: "GPT-5.4",
      provider: "OpenAI",
      providerId: "openai",
      catalogStatus: "visible",
      classification: "current",
      idKind: "stable",
      baseProviderId: "openai",
      accessible: false,
      routes: [
        { id: "gpt-5.4", providerId: "openai" },
        { id: "openrouter:openai/gpt-5.4", providerId: "openrouter" },
      ],
    },
    {
      id: "gpt-5-mini",
      name: "GPT-5 Mini",
      shortName: "5 Mini",
      provider: "OpenAI",
      providerId: "openai",
      catalogStatus: "visible",
      classification: "current",
      idKind: "stable",
      baseProviderId: "openai",
      accessible: true,
      routes: [{ id: "gpt-5-mini", providerId: "openai" }],
    },
    {
      id: "gpt-4.1",
      name: "GPT-4.1",
      provider: "OpenAI",
      providerId: "openai",
      catalogStatus: "visible",
      classification: "legacy",
      classificationReason: "superseded",
      idKind: "stable",
      baseProviderId: "openai",
      accessible: true,
      routes: [{ id: "gpt-4.1", providerId: "openai" }],
    },
    {
      id: "gpt-5.5",
      name: "GPT-5.5",
      provider: "OpenAI",
      providerId: "openai",
      catalogStatus: "visible",
      classification: "legacy",
      classificationReason: "not_recommended",
      idKind: "stable",
      baseProviderId: "openai",
      accessible: true,
      routes: [{ id: "gpt-5.5", providerId: "openai" }],
    },
    {
      id: "openrouter:moonshotai/kimi-k2.6",
      name: "Kimi K2.6",
      provider: "OpenRouter",
      providerId: "openrouter",
      catalogStatus: "visible",
      classification: "legacy",
      idKind: "wrapped",
      baseProviderId: "moonshotai",
      icon: "moonshotai",
      accessible: true,
      routes: [
        {
          id: "openrouter:moonshotai/kimi-k2.6",
          providerId: "openrouter",
        },
      ],
    },
    {
      id: "openrouter:z-ai/glm-5.2",
      name: "GLM-5.2",
      provider: "OpenRouter",
      providerId: "openrouter",
      catalogStatus: "visible",
      classification: "current",
      idKind: "wrapped",
      baseProviderId: "z-ai",
      icon: "openrouter",
      accessible: true,
      routes: [
        {
          id: "openrouter:z-ai/glm-5.2",
          providerId: "openrouter",
        },
      ],
    },
    {
      id: "openrouter:moonshotai/kimi-k3",
      name: "Kimi K3",
      provider: "OpenRouter",
      providerId: "openrouter",
      catalogStatus: "visible",
      classification: "current",
      idKind: "wrapped",
      baseProviderId: "moonshotai",
      icon: "moonshotai",
      accessible: true,
      routes: [
        {
          id: "openrouter:moonshotai/kimi-k3",
          providerId: "openrouter",
        },
      ],
    },
    {
      id: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      shortName: "Haiku 4.5",
      provider: "Anthropic",
      providerId: "anthropic",
      catalogStatus: "visible",
      classification: "current",
      snapshotDate: "2025-10-01",
      idKind: "snapshot",
      baseProviderId: "anthropic",
      icon: "claude",
      accessible: false,
      routes: [
        {
          id: "claude-haiku-4-5-20251001",
          providerId: "anthropic",
        },
      ],
    },
    {
      id: "claude-sonnet-5",
      name: "Claude Sonnet 5",
      shortName: "Sonnet 5",
      provider: "Anthropic",
      providerId: "anthropic",
      catalogStatus: "visible",
      classification: "current",
      idKind: "stable",
      baseProviderId: "anthropic",
      icon: "claude",
      accessible: true,
      routes: [
        { id: "claude-sonnet-5", providerId: "anthropic" },
        {
          id: "openrouter:anthropic/claude-sonnet-5",
          providerId: "openrouter",
        },
      ],
    },
    {
      id: "claude-sonnet-4-5-20250929",
      name: "Claude Sonnet 4.5",
      shortName: "Sonnet 4.5",
      provider: "Anthropic",
      providerId: "anthropic",
      catalogStatus: "visible",
      classification: "legacy",
      classificationReason: "superseded",
      snapshotDate: "2025-09-29",
      idKind: "snapshot",
      baseProviderId: "anthropic",
      icon: "claude",
      accessible: true,
      routes: [
        {
          id: "claude-sonnet-4-5-20250929",
          providerId: "anthropic",
        },
      ],
    },
  ] satisfies LogicalModelView[],
}

const defaultFavoriteModels = ["gpt-5.4", "openrouter:moonshotai/kimi-k2.6"]
const favoriteModelMocks = {
  favoriteModels: [...defaultFavoriteModels],
  updateFavoriteModels: vi.fn(),
}

vi.mock("@/hooks/use-breakpoint", () => ({
  useBreakpoint: () => breakpointMocks.isMobile,
}))

vi.mock("@/app/hooks/use-key-shortcut", () => ({
  useKeyShortcut: useKeyShortcutMock,
}))

vi.mock("@/lib/model-store/provider", () => ({
  useModel: () => ({
    models: modelSelectorMocks.models,
    isLoading: false,
    favoriteModels: ["gpt-5.4", "openrouter:moonshotai/kimi-k2.6"],
  }),
}))

vi.mock("@/app/components/layout/settings/models/use-favorite-models", () => ({
  useFavoriteModels: () => favoriteModelMocks,
}))

vi.mock("@/lib/user-preference-store/provider", () => ({
  useUserPreferences: () => ({
    isModelHidden: modelSelectorMocks.isModelHidden,
  }),
}))

vi.mock("./pro-dialog", () => ({
  ProModelDialog: () => <div data-testid="pro-model-dialog" />,
}))

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({
    children,
    onOpenChange,
    onOpenChangeComplete,
  }: {
    children: React.ReactNode
    onOpenChange?: (open: boolean) => void
    onOpenChangeComplete?: (open: boolean) => void
  }) => {
    changeDropdownOpen = onOpenChange
    completeDropdownOpenChange = onOpenChangeComplete
    return <div>{children}</div>
  },
  DropdownMenuTrigger: ({
    render,
    ...props
  }: {
    render: React.ReactElement<Record<string, unknown>>
  } & Record<string, unknown>) =>
    React.cloneElement(render, { ...props, "data-testid": "model-trigger" }),
  DropdownMenuContent: ({
    children,
    className,
    geometry,
  }: {
    children: React.ReactNode
    className?: string
    geometry?: "menu" | "custom"
  }) => (
    <div
      data-testid="model-menu"
      data-geometry={geometry}
      className={className}
    >
      {children}
    </div>
  ),
  DropdownMenuItem: ({
    children,
    className,
    geometry,
    closeOnClick,
    "data-testid": dataTestId,
    "data-model-selector-row": dataModelSelectorRow,
    "aria-label": ariaLabel,
    onClick,
  }: {
    children: React.ReactNode
    className?: string
    geometry?: "menu" | "custom"
    closeOnClick?: boolean
    "data-testid"?: string
    "data-model-selector-row"?: string
    "aria-label"?: string
    onClick?: () => void
  }) => (
    <div
      data-testid={dataTestId ?? "model-option"}
      data-model-selector-row={dataModelSelectorRow}
      data-close-on-click={closeOnClick}
      data-geometry={geometry}
      className={className}
      role="menuitem"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </div>
  ),
}))

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DrawerContent: ({
    children,
    className,
    handleClassName,
    handleHitAreaClassName,
  }: {
    children: React.ReactNode
    className?: string
    handleClassName?: string
    handleHitAreaClassName?: string
  }) => (
    <div data-testid="model-drawer" className={className}>
      <div
        data-testid="model-drawer-handle-hit-area"
        className={handleHitAreaClassName}
      >
        <div data-testid="model-drawer-handle" className={handleClassName} />
      </div>
      {children}
    </div>
  ),
  DrawerTitle: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => (
    <h2 data-testid="model-drawer-title" className={className}>
      {children}
    </h2>
  ),
  DrawerTrigger: ({
    render,
  }: {
    render: React.ReactElement<Record<string, unknown>>
  }) => React.cloneElement(render, { "data-testid": "drawer-trigger" }),
}))

describe("ModelSelector", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(async () => {
    installDomIfNeeded()

    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    ;({ ModelSelector } = await import("./base"))
  })

  afterAll(() => {
    testDom?.window.close()
    testDom = null
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => {
        mountedRoot.unmount()
      })
    }
    container?.remove()
    document.body.innerHTML = ""
    container = null
    root = null
    modelSelectorMocks.isModelHidden.mockClear()
    favoriteModelMocks.favoriteModels = [...defaultFavoriteModels]
    favoriteModelMocks.updateFavoriteModels.mockClear()
    breakpointMocks.isMobile = false
    useKeyShortcutMock.mockClear()
    changeDropdownOpen = undefined
    completeDropdownOpenChange = undefined
  })

  function renderSelector({
    isUserAuthenticated,
    onSelect = vi.fn(),
    onSelectionCommitted,
    disabled = false,
    selectedModelId = "gpt-5-mini",
    variant = "default",
  }: {
    isUserAuthenticated: boolean
    onSelect?: (modelId: string) => void
    onSelectionCommitted?: () => void
    disabled?: boolean
    selectedModelId?: string
    variant?: "default" | "composer"
  }) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    function TestSelector() {
      const [isAuthPromptOpen, setIsAuthPromptOpen] = React.useState(false)

      return (
        <>
          <ModelSelector
            selectedModelId={selectedModelId}
            setSelectedModelId={onSelect}
            isUserAuthenticated={isUserAuthenticated}
            onLockedGuestModelSelect={() => setIsAuthPromptOpen(true)}
            onSelectionCommitted={onSelectionCommitted}
            disabled={disabled}
            variant={variant}
          />
          {isAuthPromptOpen ? (
            <div role="dialog">Log in to unlock models</div>
          ) : null}
        </>
      )
    }

    act(() => {
      root?.render(<TestSelector />)
    })

    return onSelect
  }

  it("supports the Control-Shift-M model shortcut", () => {
    renderSelector({ isUserAuthenticated: false })

    const matchesShortcut = useKeyShortcutMock.mock.calls.at(-1)?.[0] as
      ((event: KeyboardEvent) => boolean) | undefined

    expect(matchesShortcut).toBeTypeOf("function")
    expect(
      matchesShortcut?.({
        key: "m",
        ctrlKey: true,
        shiftKey: true,
      } as KeyboardEvent)
    ).toBe(true)
    expect(
      matchesShortcut?.({
        key: "m",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
      } as KeyboardEvent)
    ).toBe(false)
  })

  it("disables the composer tooltip while the model popover is open", () => {
    renderSelector({ isUserAuthenticated: false, variant: "composer" })

    const toggleModelPopover = useKeyShortcutMock.mock.calls.at(-1)?.[1] as
      (() => void) | undefined
    const tooltipTrigger = document.body.querySelector<HTMLElement>(
      '[data-slot="tooltip-trigger"]'
    )

    expect(tooltipTrigger?.hasAttribute("data-trigger-disabled")).toBe(false)

    act(() => {
      toggleModelPopover?.()
    })

    expect(tooltipTrigger?.hasAttribute("data-trigger-disabled")).toBe(true)
  })

  function getModelOption(name: string) {
    const option = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[data-testid="model-option"]'
      )
    ).find((button) => button.textContent?.includes(name))

    if (!option) {
      throw new Error(`Could not find model option ${name}`)
    }

    return option
  }

  function getModelOptionNames() {
    return Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-slot="model-name"]')
    ).map((name) => name.textContent?.trim())
  }

  function getLegacyDisclosure(providerName: string) {
    return document.body.querySelector(
      `[aria-label="Show legacy models for ${providerName}"]`
    )
  }

  function searchModels(query: string) {
    const input = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="Search models..."]'
    )
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set

    if (!input || !setValue) {
      throw new Error("Could not find model search input")
    }

    act(() => {
      setValue.call(input, query)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  it("uses the shared provider order", () => {
    renderSelector({ isUserAuthenticated: true })

    expect(getModelOptionNames()).toEqual([
      "GPT-5.4",
      "Claude Sonnet 5",
      "GPT-5 Mini",
      "GLM-5.2",
      "Kimi K3",
    ])
  })

  it("keeps only the selected legacy composer model visible", () => {
    renderSelector({
      isUserAuthenticated: true,
      selectedModelId: "gpt-5.5",
      variant: "composer",
    })

    const selectedOption = getModelOption("GPT-5.5")

    expect(selectedOption.className).toContain("bg-interactive-selected")
    expect(
      selectedOption.querySelector('[data-slot="selected-model-check"]')
    ).not.toBeNull()
    expect(document.body.textContent).not.toContain("GPT-4.1")
    expect(
      document.body.querySelector(
        '[aria-label="Show legacy models for OpenAI"]'
      )
    ).not.toBeNull()
  })

  it("reveals legacy models for one provider with its logo", () => {
    renderSelector({ isUserAuthenticated: true })

    expect(document.body.textContent).not.toContain("GPT-4.1")
    expect(document.body.textContent).not.toContain("Claude Sonnet 4.5")
    expect(document.body.textContent).not.toContain("September 2025")

    const revealOptions = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[data-testid="show-legacy-models"]'
      )
    )
    const anthropicOption = revealOptions.find(
      (option) =>
        option.getAttribute("aria-label") === "Show legacy models for Anthropic"
    )

    expect(revealOptions).toHaveLength(3)
    expect(anthropicOption?.textContent?.trim()).toBe("Show legacy models...")
    expect(anthropicOption?.getAttribute("aria-label")).toBe(
      "Show legacy models for Anthropic"
    )
    expect(anthropicOption?.dataset.closeOnClick).toBe("false")
    expect(
      anthropicOption
        ?.querySelector('[data-slot="show-legacy-models-icon"] svg')
        ?.getAttribute("class")
    ).toContain("text-claude-logo")
    expect(anthropicOption?.className).toContain("group/show-legacy")
    expect(
      anthropicOption?.querySelector('[data-slot="show-legacy-models-label"]')
        ?.className
    ).toContain("opacity-40 group-hover/show-legacy:opacity-100")

    act(() => {
      anthropicOption?.click()
    })

    expect(document.body.textContent).toContain("Claude Sonnet 4.5")
    expect(
      getModelOption("Claude Sonnet 4.5").querySelector(
        '[data-slot="model-snapshot-date"]'
      )?.textContent
    ).toBe("September 2025")
    expect(document.body.textContent).not.toContain("GPT-4.1")
    expect(
      document.body.querySelector(
        '[aria-label="Show legacy models for Anthropic"]'
      )
    ).toBeNull()
    expect(
      document.body.querySelector(
        '[aria-label="Show legacy models for OpenAI"]'
      )
    ).not.toBeNull()

    act(() => {
      changeDropdownOpen?.(false)
    })

    expect(document.body.textContent).not.toContain("Claude Sonnet 4.5")
    expect(document.body.textContent).not.toContain("September 2025")
    expect(
      document.body.querySelector(
        '[aria-label="Show legacy models for Anthropic"]'
      )
    ).not.toBeNull()
  })

  it.each([
    ["desktop", false],
    ["mobile", true],
  ] as const)(
    "shows a matching legacy model directly during %s search",
    (_surface, isMobile) => {
      breakpointMocks.isMobile = isMobile
      renderSelector({ isUserAuthenticated: true })

      expect(document.body.textContent).not.toContain("GPT-4.1")
      expect(getLegacyDisclosure("OpenAI")).not.toBeNull()

      searchModels("GPT-4.1")

      expect(getModelOptionNames()).toEqual(["GPT-4.1"])
      expect(getLegacyDisclosure("OpenAI")).toBeNull()

      searchModels("")

      expect(document.body.textContent).not.toContain("GPT-4.1")
      expect(getLegacyDisclosure("OpenAI")).not.toBeNull()
    }
  )

  it("replaces a provider disclosure in place without reordering current models", () => {
    renderSelector({ isUserAuthenticated: true })

    const currentNamesBefore = getModelOptionNames()
    const rowsBefore = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[data-testid="model-option"], [data-testid="show-legacy-models"]'
      )
    )
    const moonshotOption = rowsBefore.find(
      (row) =>
        row.getAttribute("aria-label") === "Show legacy models for Moonshot AI"
    )
    const disclosureIndex = moonshotOption
      ? rowsBefore.indexOf(moonshotOption)
      : -1

    expect(disclosureIndex).toBeGreaterThan(-1)

    act(() => {
      moonshotOption?.click()
    })

    const currentNamesAfter = getModelOptionNames().filter(
      (name) => name !== "Kimi K2.6"
    )
    const rowsAfter = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[data-testid="model-option"], [data-testid="show-legacy-models"]'
      )
    )

    expect(currentNamesAfter).toEqual(currentNamesBefore)
    expect(rowsAfter[disclosureIndex]?.textContent).toContain("Kimi K2.6")
  })

  it("uses a lock icon instead of the locked badge for signed-out users", () => {
    renderSelector({ isUserAuthenticated: false })

    expect(document.body.textContent).toContain("GPT-5 Mini")
    expect(document.body.textContent).toContain("GPT-5.4")
    expect(document.body.textContent).toContain("Claude Haiku 4.5")
    expect(document.body.textContent).not.toContain("October 2025")
    expect(document.body.textContent).not.toContain("Locked")
    const lockedIcons = document.body.querySelectorAll(
      '[data-slot="locked-model-icon"]'
    )
    expect(lockedIcons.length).toBeGreaterThan(0)
    expect(lockedIcons[0]?.getAttribute("aria-label")).toBe("Locked")
    expect(document.body.querySelector('[aria-label^="Pin "]')).toBeNull()
  })

  it("swaps resting check and lock states for pin actions without selecting", () => {
    const onSelect = renderSelector({ isUserAuthenticated: true })
    const selectedOption = getModelOption("GPT-5 Mini")
    const selectedCheck = selectedOption.querySelector<HTMLElement>(
      '[data-slot="selected-model-check"]'
    )
    const rightSlot = selectedOption.querySelector<HTMLElement>(
      '[data-slot="model-option-right-slot"]'
    )
    const pinAction = selectedOption.querySelector<HTMLButtonElement>(
      '[aria-label="Pin GPT-5 Mini"]'
    )

    expect(selectedCheck?.className).toContain(
      "group-hover/model-option:opacity-0"
    )
    expect(rightSlot?.className).toContain("size-[18px]")
    expect(selectedCheck?.style.getPropertyValue("--icon-slot-size")).toBe(
      "18px"
    )
    expect(selectedCheck?.style.getPropertyValue("--icon-glyph-size")).toBe(
      "18px"
    )
    expect(pinAction?.className).toContain(
      "group-hover/model-option:opacity-100"
    )
    expect(pinAction?.className).toContain("pointer-events-none")
    expect(pinAction?.className).toContain(
      "group-hover/model-option:pointer-events-auto"
    )

    act(() => {
      pinAction?.click()
    })

    expect(favoriteModelMocks.updateFavoriteModels).toHaveBeenCalledWith([
      "gpt-5.4",
      "openrouter:moonshotai/kimi-k2.6",
      "gpt-5-mini",
    ])
    expect(onSelect).not.toHaveBeenCalled()

    const lockedPinnedOption = getModelOption("GPT-5.4")
    expect(
      lockedPinnedOption.querySelector('[data-slot="locked-model-icon"]')
    ).not.toBeNull()
    expect(
      lockedPinnedOption.querySelector('[aria-label="Unpin GPT-5.4"]')
    ).not.toBeNull()
    const lockedIcon = lockedPinnedOption.querySelector<HTMLElement>(
      '[data-slot="locked-model-icon"]'
    )
    expect(lockedIcon?.style.getPropertyValue("--icon-slot-size")).toBe("18px")
    expect(lockedIcon?.style.getPropertyValue("--icon-glyph-size")).toBe("18px")
  })

  it("preserves the model list scroll position when pinning reorders a row", () => {
    renderSelector({ isUserAuthenticated: true })
    const scrollSurface = document.body.querySelector<HTMLElement>(
      "[data-scrollable-surface]"
    )
    const pinAction = getModelOption(
      "GPT-5 Mini"
    ).querySelector<HTMLButtonElement>('[aria-label="Pin GPT-5 Mini"]')

    expect(scrollSurface).not.toBeNull()
    expect(pinAction).not.toBeNull()

    scrollSurface!.scrollTop = 137
    pinAction!.focus()
    favoriteModelMocks.updateFavoriteModels.mockImplementationOnce(() => {
      scrollSurface!.scrollTop = 999
    })
    vi.useFakeTimers()

    try {
      act(() => {
        pinAction!.click()
      })

      expect(document.activeElement).not.toBe(pinAction)
      expect(scrollSurface!.scrollTop).toBe(999)

      act(() => {
        vi.runAllTimers()
      })

      expect(scrollSurface!.scrollTop).toBe(137)
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps a visible row anchored when the first pin adds section labels", () => {
    favoriteModelMocks.favoriteModels = []
    renderSelector({ isUserAuthenticated: true })
    const scrollSurface = document.body.querySelector<HTMLElement>(
      "[data-scrollable-surface]"
    )
    const anchorRow = getModelOption("GPT-5.4")
    const pinAction = getModelOption(
      "GPT-5 Mini"
    ).querySelector<HTMLButtonElement>('[aria-label="Pin GPT-5 Mini"]')
    let anchorTop = 48

    expect(scrollSurface).not.toBeNull()
    expect(pinAction).not.toBeNull()

    vi.spyOn(scrollSurface!, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
    } as DOMRect)
    vi.spyOn(anchorRow, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          top: anchorTop,
          bottom: anchorTop + 40,
        }) as DOMRect
    )
    scrollSurface!.scrollTop = 137
    favoriteModelMocks.updateFavoriteModels.mockImplementationOnce(() => {
      anchorTop = 96
      // Base UI may scroll while its menu items regroup.
      scrollSurface!.scrollTop = 999
    })
    vi.useFakeTimers()

    try {
      act(() => {
        pinAction!.click()
        vi.runAllTimers()
      })

      expect(scrollSurface!.scrollTop).toBe(1047)
    } finally {
      vi.useRealTimers()
    }
  })

  it("owns its composite menu inset and row geometry", () => {
    renderSelector({ isUserAuthenticated: false })

    const menu = document.body.querySelector<HTMLElement>(
      '[data-testid="model-menu"]'
    )
    const option = getModelOption("GPT-5 Mini")

    expect(menu?.dataset.geometry).toBe("custom")
    expect(menu?.className).toContain("bg-floating-surface")
    expect(menu?.className).toContain("p-1.5")
    expect(menu?.className).toContain("relative")
    expect(menu?.className).toContain("rounded-3xl")
    expect(menu?.className).toContain(
      "[--model-selector-list-max-height:19rem]"
    )
    const searchOverlay = document.body.querySelector<HTMLElement>(
      '[data-slot="model-selector-desktop-search"]'
    )
    expect(searchOverlay?.className).toContain("absolute")
    expect(searchOverlay?.className).toContain("from-floating-surface/80")
    expect(searchOverlay?.className).toContain("to-floating-surface/0")
    const searchInput = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="Search models..."]'
    )
    expect(searchInput?.className).toContain("backdrop-blur-md")
    expect(searchInput?.className).toContain("rounded-full")
    expect(option.dataset.geometry).toBe("custom")
    expect(option.className).toContain("h-10")
    expect(option.className).toContain("rounded-xl")
    expect(option.className).not.toContain("mx-2.5")
    expect(
      document.body.querySelector('[data-slot="model-section"]')
    ).toBeNull()
    expect(
      option.querySelector<HTMLElement>('[data-slot="model-name"]')?.className
    ).toContain("text-base")
    expect(
      option.querySelector('[data-slot="selected-model-check"]')
    ).not.toBeNull()
    const scrollSurface = document.body.querySelector<HTMLElement>(
      "[data-scrollable-surface]"
    )
    expect(scrollSurface?.className).toContain(
      "pt-(--model-selector-fixed-height)"
    )
    expect(scrollSurface?.className).toContain(
      "scroll-pt-[calc(var(--model-selector-fixed-height)+0.5rem)]"
    )
    expect(scrollSurface?.className).toContain("[scrollbar-width:none]")
    expect(scrollSurface?.className).toContain("[&::-webkit-scrollbar]:hidden")
    expect(scrollSurface?.className).not.toContain("scrollbar-gutter")
    expect(scrollSurface?.className).not.toContain("pr-1")
    expect(scrollSurface?.className).not.toContain("pb-1")
  })

  it("selects the anonymous model but opens auth for locked guest models", () => {
    const onSelect = renderSelector({ isUserAuthenticated: false })

    act(() => {
      getModelOption("GPT-5 Mini").click()
    })

    expect(onSelect).toHaveBeenCalledWith("gpt-5-mini")

    act(() => {
      getModelOption("GPT-5.4").click()
    })

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("Log in to unlock models")
    expect(
      document.body.querySelector('[data-testid="pro-model-dialog"]')
    ).toBeNull()
  })

  it("notifies the owner only after a desktop selection finishes closing", () => {
    const onSelectionCommitted = vi.fn()
    const onSelect = renderSelector({
      isUserAuthenticated: false,
      onSelectionCommitted,
    })

    act(() => {
      completeDropdownOpenChange?.(false)
    })
    expect(onSelectionCommitted).not.toHaveBeenCalled()

    act(() => {
      getModelOption("GPT-5 Mini").click()
    })
    expect(onSelect).toHaveBeenCalledWith("gpt-5-mini")
    expect(onSelectionCommitted).not.toHaveBeenCalled()

    act(() => {
      completeDropdownOpenChange?.(false)
    })
    expect(onSelectionCommitted).toHaveBeenCalledTimes(1)

    act(() => {
      completeDropdownOpenChange?.(false)
    })
    expect(onSelectionCommitted).toHaveBeenCalledTimes(1)
  })

  it("uses the same model list and selection rules in the mobile drawer", () => {
    breakpointMocks.isMobile = true
    const onSelect = renderSelector({
      isUserAuthenticated: true,
      variant: "composer",
    })

    expect(document.body.textContent).toContain("GPT-5 Mini")
    expect(document.body.textContent).toContain("GLM-5.2")
    expect(
      document.body.querySelector('[data-testid="drawer-trigger"]')
    ).toBeTruthy()
    expect(
      document.body.querySelector<HTMLElement>('[data-testid="model-drawer"]')
        ?.className
    ).toContain("bg-floating-surface")
    expect(
      document.body.querySelector<HTMLElement>('[data-testid="model-drawer"]')
        ?.className
    ).toContain("dark:bg-floating-surface/80")
    expect(
      document.body.querySelector<HTMLElement>('[data-testid="model-drawer"]')
        ?.className
    ).toContain("dark:backdrop-blur-[10px]")
    expect(
      document.body.querySelector<HTMLElement>('[data-testid="model-drawer"]')
        ?.className
    ).toContain("data-[vaul-drawer-direction=bottom]:rounded-t-[2rem]")
    expect(
      document.body.querySelector<HTMLElement>(
        '[data-testid="model-drawer-title"]'
      )?.className
    ).toContain("sr-only")
    expect(
      document.body.querySelector<HTMLElement>(
        '[data-testid="model-drawer-handle"]'
      )?.className
    ).toBe(
      "bg-muted-foreground/60 absolute top-2 left-1/2 z-20 mt-0 h-1 w-11 -translate-x-1/2"
    )
    expect(
      document.body.querySelector<HTMLElement>(
        '[data-testid="model-drawer-handle-hit-area"]'
      )?.className
    ).toBe("pointer-events-auto absolute inset-x-0 top-0 z-20 h-5 touch-none")
    expect(
      document.body.querySelector<HTMLElement>(
        '[data-slot="model-selector-mobile-search"]'
      )?.className
    ).toContain("absolute")
    expect(
      document.body.querySelector<HTMLElement>(
        '[data-slot="model-selector-mobile-search"]'
      )?.className
    ).toContain("from-floating-surface/80")
    expect(
      document.body.querySelector<HTMLElement>(
        '[data-slot="model-selector-mobile-search"]'
      )?.className
    ).toContain("to-floating-surface/0")
    expect(
      document.body.querySelector<HTMLElement>(
        '[data-slot="model-selector-mobile-scroll"]'
      )?.className
    ).toContain("pt-(--model-selector-mobile-header-height)")
    expect(
      document.body.querySelector<HTMLInputElement>(
        'input[placeholder="Search models..."]'
      )?.className
    ).toContain("rounded-full")
    expect(
      document.body.querySelector<HTMLInputElement>(
        'input[placeholder="Search models..."]'
      )?.className
    ).toContain("h-12")
    expect(
      document.body.querySelector<HTMLElement>(
        '[data-slot="model-selector-search-icon"]'
      )?.className
    ).toContain("z-10")
    const mobileOption = getModelOption("GPT-5 Mini")
    expect(mobileOption.className).toContain("h-14")
    expect(mobileOption.className).toContain("px-4")
    const mobileModelIcon = mobileOption.querySelector<HTMLElement>(
      '[data-slot="model-option-icon"]'
    )
    expect(mobileModelIcon?.style.getPropertyValue("--icon-slot-size")).toBe(
      "24px"
    )
    expect(mobileModelIcon?.style.getPropertyValue("--icon-glyph-size")).toBe(
      "24px"
    )
    expect(
      mobileOption.querySelector<HTMLElement>('[data-slot="model-name"]')
        ?.className
    ).toContain("text-base")
    expect(
      mobileOption.querySelector('[data-slot="selected-model-check"]')
    ).not.toBeNull()
    const secondMobileOption = getModelOption("GLM-5.2")
    expect(
      secondMobileOption.querySelector('[data-slot="selected-model-check"]')
    ).toBeNull()
    expect(secondMobileOption.className).toContain(
      "before:bg-floating-menu-divider/60"
    )
    expect(secondMobileOption.className).toContain("before:inset-x-0")
    const sections = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-slot="model-section"]')
    )
    expect(sections).toHaveLength(2)
    expect(
      sections.map((section) =>
        section
          .querySelector('[data-slot="model-section-label"]')
          ?.textContent?.trim()
      )
    ).toEqual(["Pinned", "All models"])
    const allModelsSection = sections.find(
      (section) => section.getAttribute("aria-label") === "All models"
    )
    expect(allModelsSection?.textContent).toContain("GPT-5 Mini")
    for (const section of sections) {
      const label = section.querySelector('[data-slot="model-section-label"]')
      const container = section.querySelector<HTMLElement>(
        '[data-slot="model-section-container"]'
      )

      expect(container?.contains(label)).toBe(false)
      expect(label?.className).toContain("text-sm")
      expect(container?.className).toContain("bg-muted/50")
      expect(container?.className).toContain("dark:bg-muted/80")
      expect(container?.className).toContain("rounded-3xl")
      expect(
        container
          ?.querySelector<HTMLElement>('[data-testid="model-option"]')
          ?.className.includes("before:bg-floating-menu-divider/60")
      ).toBe(false)
    }

    act(() => {
      mobileOption.click()
    })

    expect(onSelect).toHaveBeenCalledWith("gpt-5-mini")
  })

  it("normalizes a legacy routed selection to one logical row with no route suffix", () => {
    // The old wrapped GPT-5.4 id is a ROUTE of the direct logical model now
    // (ADR-0020): the trigger shows the logical identity, the catalog renders
    // ONE GPT-5.4 row, and no row carries an OpenRouter route label.
    renderSelector({
      isUserAuthenticated: false,
      selectedModelId: "openrouter:openai/gpt-5.4",
    })

    const trigger = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="model-trigger"]'
    )

    expect(trigger?.textContent).toContain("GPT-5.4")
    expect(trigger?.textContent).not.toContain("OpenRouter")
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Select model, current model GPT-5.4"
    )

    const options = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[data-testid="model-option"]'
      )
    )
    expect(
      options.filter((option) => option.textContent?.includes("GPT-5.4"))
    ).toHaveLength(1)
    expect(
      options.some((option) => option.textContent?.includes("OpenRouter"))
    ).toBe(false)
    // The normalized selection highlights the logical row.
    expect(
      options
        .find((option) => option.textContent?.includes("GPT-5.4"))
        ?.className.includes("bg-interactive-selected")
    ).toBe(true)
  })

  it("keeps multi-route Claude provider labels off ordinary selector rows", () => {
    renderSelector({
      isUserAuthenticated: true,
      selectedModelId: "claude-sonnet-5",
    })

    const trigger = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="model-trigger"]'
    )
    const sonnetOption = getModelOption("Claude Sonnet 5")

    expect(trigger?.textContent).toBe("Claude Sonnet 5")
    expect(sonnetOption.textContent).toBe("Claude Sonnet 5")
  })

  it("uses compact composer text while rows and accessibility stay full", () => {
    renderSelector({
      isUserAuthenticated: false,
      selectedModelId: "gpt-5-mini",
      variant: "composer",
    })

    const trigger = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="model-trigger"]'
    )
    const option = getModelOption("GPT-5 Mini")

    expect(trigger?.textContent).toBe("5 Mini")
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Select model, current model GPT-5 Mini"
    )
    expect(option.textContent).toBe("GPT-5 Mini")
  })

  it("shows the selected model icon instead of a chevron in the composer", () => {
    renderSelector({
      isUserAuthenticated: false,
      selectedModelId: "openrouter:openai/gpt-5.4",
      variant: "composer",
    })

    const trigger = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="model-trigger"]'
    )

    expect(
      trigger?.querySelector('[data-slot="selected-model-icon"]')
    ).not.toBeNull()
    expect(trigger?.querySelectorAll('[data-slot="icon"]')).toHaveLength(0)
    expect(trigger?.firstElementChild?.getAttribute("data-slot")).toBe(
      "selected-model-icon"
    )
    expect(trigger?.firstElementChild?.className).toContain("text-foreground")
    expect(trigger?.firstElementChild?.className).toContain("opacity-100")
    expect(trigger?.hasAttribute("data-composer-control")).toBe(true)
    expect(trigger?.className).toContain("composer-btn")
    expect(trigger?.className).not.toContain("hover:bg-interactive-hover")
    expect(trigger?.className).not.toContain("active:bg-interactive-pressed")
    expect(trigger?.className).toContain("active:scale-[0.96]")
    expect(trigger?.className).toContain("can-hover:relative")
    expect(trigger?.className).toContain("can-hover:after:absolute")
    expect(trigger?.className).toContain("can-hover:after:-inset-x-1")
    expect(trigger?.className).toContain("overflow-visible")
    expect(trigger?.className).toContain("gap-1.5")
    expect(trigger?.className).toContain("ps-3.5")
    expect(trigger?.className).toContain("pe-3")
    expect(trigger?.className).toContain("text-base")
    expect(trigger?.className).toContain("leading-[26px]")
    expect(trigger?.className).not.toContain("overflow-hidden")

    const selectedModelIcon = trigger?.querySelector<HTMLElement>(
      '[data-slot="selected-model-icon"]'
    )
    expect(selectedModelIcon?.style.getPropertyValue("--icon-slot-size")).toBe(
      "16px"
    )
    expect(selectedModelIcon?.style.getPropertyValue("--icon-glyph-size")).toBe(
      "16px"
    )
    expect(trigger?.lastElementChild?.className).toContain("text-foreground")
  })

  it("keeps the hover bridge scoped to the composer trigger", () => {
    renderSelector({
      isUserAuthenticated: false,
      selectedModelId: "gpt-5-mini",
    })

    const trigger = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="model-trigger"]'
    )

    expect(trigger?.className).toContain("overflow-hidden")
    expect(trigger?.className).not.toContain("can-hover:after:-inset-x-1")
  })

  it("disables the trigger and ignores option clicks when disabled", () => {
    const onSelect = renderSelector({
      isUserAuthenticated: false,
      disabled: true,
    })

    expect(
      document.body.querySelector<HTMLButtonElement>(
        '[data-testid="model-trigger"]'
      )?.disabled
    ).toBe(true)

    act(() => {
      getModelOption("GPT-5 Mini").click()
    })

    expect(onSelect).not.toHaveBeenCalled()
  })
})
