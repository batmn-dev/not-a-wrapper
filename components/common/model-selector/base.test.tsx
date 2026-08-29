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
let dropdownAnchor: React.RefObject<Element | null> | undefined
let dropdownModal: boolean | undefined

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
      shortName: "5.4",
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
      shortName: "4.1",
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
      shortName: "5.5",
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
      shortName: "K2.6",
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
      shortName: "5.2",
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
      shortName: "K3",
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
    modal,
    onOpenChange,
    onOpenChangeComplete,
  }: {
    children: React.ReactNode
    modal?: boolean
    onOpenChange?: (open: boolean) => void
    onOpenChangeComplete?: (open: boolean) => void
  }) => {
    dropdownModal = modal
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
    anchor,
    children,
    className,
    geometry,
  }: {
    anchor?: React.RefObject<Element | null>
    children: React.ReactNode
    className?: string
    geometry?: "menu" | "custom"
  }) => {
    dropdownAnchor = anchor
    return (
      <div
        data-testid="model-menu"
        data-geometry={geometry}
        className={className}
      >
        {children}
      </div>
    )
  },
  DropdownMenuItem: ({
    children,
    className,
    geometry,
    closeOnClick,
    "data-testid": dataTestId,
    "data-model-selector-row": dataModelSelectorRow,
    "aria-label": ariaLabel,
    onPointerDown,
    onClick,
  }: {
    children: React.ReactNode
    className?: string
    geometry?: "menu" | "custom"
    closeOnClick?: boolean
    "data-testid"?: string
    "data-model-selector-row"?: string
    "aria-label"?: string
    onPointerDown?: React.PointerEventHandler<HTMLDivElement>
    onClick?: React.MouseEventHandler<HTMLDivElement>
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
      onPointerDown={onPointerDown}
      onClick={(event) => {
        Object.assign(event, { preventBaseUIHandler: () => undefined })
        onClick?.(event)
      }}
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
    dropdownAnchor = undefined
    dropdownModal = undefined
  })

  function renderSelector({
    isUserAuthenticated,
    onSelect = vi.fn(),
    onOpenChange,
    onSelectionCommitted,
    disabled = false,
    selectedModelId = "gpt-5-mini",
    variant = "default",
  }: {
    isUserAuthenticated: boolean
    onSelect?: (modelId: string) => void
    onOpenChange?: (open: boolean) => void
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
            onOpenChange={onOpenChange}
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

  it("reveals legacy models for one provider", () => {
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

  it("preserves scroll before legacy rows can paint", () => {
    renderSelector({ isUserAuthenticated: true })
    const scrollSurface = document.body.querySelector<HTMLElement>(
      "[data-scrollable-surface]"
    )
    const legacyDisclosure = getLegacyDisclosure("Anthropic") as HTMLElement
    const searchInput = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="Search models..."]'
    )

    expect(scrollSurface).not.toBeNull()
    expect(legacyDisclosure).not.toBeNull()
    expect(searchInput).not.toBeNull()

    scrollSurface!.scrollTop = 137
    searchInput!.focus()
    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    })

    expect(legacyDisclosure.dispatchEvent(pointerDown)).toBe(false)
    expect(document.activeElement).toBe(searchInput)

    const frameCallbacks: FrameRequestCallback[] = []
    const originalRequestAnimationFrame = window.requestAnimationFrame
    window.requestAnimationFrame = vi.fn((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    legacyDisclosure.focus()
    const focusSearch = searchInput!.focus.bind(searchInput)
    vi.spyOn(searchInput!, "focus").mockImplementation((options) => {
      focusSearch(options)
      scrollSurface!.scrollTop = 999
    })

    try {
      act(() => {
        legacyDisclosure.click()
      })

      expect(document.activeElement).toBe(searchInput)
      expect(document.body.textContent).toContain("Claude Sonnet 4.5")
      expect(frameCallbacks).toHaveLength(1)

      act(() => {
        frameCallbacks[0]?.(0)
      })

      expect(scrollSurface!.scrollTop).toBe(137)
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
    }
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
    const pinAction = selectedOption.querySelector<HTMLButtonElement>(
      '[aria-label="Pin GPT-5 Mini"]'
    )

    expect(pinAction).not.toBeNull()

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
    const mobileOption = getModelOption("GPT-5 Mini")
    expect(
      mobileOption.querySelector('[data-slot="selected-model-check"]')
    ).not.toBeNull()
    const secondMobileOption = getModelOption("GLM-5.2")
    expect(
      secondMobileOption.querySelector('[data-slot="selected-model-check"]')
    ).toBeNull()
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

  it.each([
    ["openrouter:moonshotai/kimi-k3", "K3", "Kimi K3"],
    ["openrouter:z-ai/glm-5.2", "5.2", "GLM-5.2"],
  ])(
    "uses the catalog short name only in the composer trigger for %s",
    (modelId, shortName, fullName) => {
      renderSelector({
        isUserAuthenticated: true,
        selectedModelId: modelId,
        variant: "composer",
      })

      const trigger = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="model-trigger"]'
      )
      const option = getModelOption(fullName)

      expect(trigger?.textContent).toBe(shortName)
      expect(trigger?.getAttribute("aria-label")).toBe(
        `Select model, current model ${fullName}`
      )
      expect(option.textContent).toBe(fullName)
    }
  )

  it("omits the Gemini prefix beside its composer logo", () => {
    const geminiModel: LogicalModelView = {
      id: "openrouter:google/gemini-3.7-flash",
      name: "Gemini 3.7 Flash",
      shortName: "3.7 Flash",
      provider: "OpenRouter",
      providerId: "openrouter",
      catalogStatus: "visible",
      classification: "current",
      idKind: "wrapped",
      baseProviderId: "google",
      icon: "gemini",
      accessible: true,
      routes: [
        {
          id: "openrouter:google/gemini-3.7-flash",
          providerId: "openrouter",
        },
      ],
    }
    const models = modelSelectorMocks.models as LogicalModelView[]
    models.push(geminiModel)

    try {
      renderSelector({
        isUserAuthenticated: true,
        selectedModelId: geminiModel.id,
        variant: "composer",
      })

      const trigger = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="model-trigger"]'
      )
      const option = getModelOption("Gemini 3.7 Flash")

      expect(trigger?.textContent).toBe("3.7 Flash")
      expect(trigger?.getAttribute("aria-label")).toBe(
        "Select model, current model Gemini 3.7 Flash"
      )
      expect(option.textContent).toBe("Gemini 3.7 Flash")
    } finally {
      models.pop()
    }
  })

  it("shows the selected model icon and anchors the desktop menu outside the trigger", () => {
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
    expect(trigger?.hasAttribute("data-composer-control")).toBe(true)
    const pressSurface = document.body.querySelector(
      '[data-slot="model-selector-visual-surface"]'
    )
    expect(pressSurface?.contains(trigger ?? null)).toBe(true)
    expect(dropdownAnchor?.current).toBe(
      document.body.querySelector('[data-slot="model-selector-desktop-anchor"]')
    )
    expect(dropdownAnchor?.current?.contains(pressSurface ?? null)).toBe(true)
    expect(dropdownAnchor?.current).not.toBe(trigger)
    expect(dropdownModal).toBe(false)
  })

  it("opens the composer menu as soon as the button is pressed", () => {
    const onOpenChange = vi.fn()
    renderSelector({
      isUserAuthenticated: false,
      selectedModelId: "gpt-5-mini",
      variant: "composer",
      onOpenChange,
    })

    act(() => {
      changeDropdownOpen?.(true)
    })
    expect(onOpenChange).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(true)
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
