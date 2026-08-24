/** @vitest-environment jsdom */

import type { ModelConfig } from "@/lib/models/types"
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
  isModelHidden: vi.fn((modelId: string) => modelId === "claude-opus-4-6"),
  models: [
    {
      id: "gpt-5.4",
      name: "GPT-5.4",
      provider: "OpenAI",
      providerId: "openai",
      catalogStatus: "visible",
      idKind: "stable",
      baseProviderId: "openai",
      accessible: false,
    },
    {
      id: "gpt-5-mini",
      name: "GPT-5 Mini",
      provider: "OpenAI",
      providerId: "openai",
      catalogStatus: "visible",
      idKind: "stable",
      baseProviderId: "openai",
      accessible: true,
    },
    {
      id: "openrouter:z-ai/glm-5.2",
      name: "GLM 5.2",
      provider: "OpenRouter",
      providerId: "openrouter",
      catalogStatus: "visible",
      idKind: "wrapped",
      baseProviderId: "z-ai",
      icon: "openrouter",
      accessible: true,
    },
    {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      provider: "Anthropic",
      providerId: "anthropic",
      catalogStatus: "visible",
      idKind: "stable",
      baseProviderId: "claude",
      accessible: false,
    },
  ] satisfies ModelConfig[],
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
    favoriteModels: ["gpt-5.4"],
  }),
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
    onOpenChangeComplete,
  }: {
    children: React.ReactNode
    onOpenChangeComplete?: (open: boolean) => void
  }) => {
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
    onClick,
  }: {
    children: React.ReactNode
    className?: string
    geometry?: "menu" | "custom"
    onClick?: () => void
  }) => (
    <button
      data-testid="model-option"
      data-geometry={geometry}
      className={className}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
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
    breakpointMocks.isMobile = false
    useKeyShortcutMock.mockClear()
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

  it("shows the visible catalog with locked badges for signed-out users", () => {
    renderSelector({ isUserAuthenticated: false })

    expect(document.body.textContent).toContain("GPT-5 Mini")
    expect(document.body.textContent).toContain("GPT-5.4")
    expect(document.body.textContent).toContain("Claude Opus 4.6")
    expect(document.body.textContent).toContain("Locked")
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
    expect(option.dataset.geometry).toBe("custom")
    expect(option.className).toContain("h-9")
    expect(option.className).toContain("rounded-lg")
    expect(option.className).not.toContain("mx-2.5")
    expect(
      document.body.querySelector('[data-slot="model-section"]')
    ).toBeNull()
    expect(
      option.querySelector<HTMLElement>('[data-slot="model-name"]')?.className
    ).toContain("text-sm")
    expect(
      option.querySelector('[data-slot="selected-model-check"]')
    ).not.toBeNull()
    expect(
      document.body.querySelector("[data-scrollable-surface]")
    ).not.toBeNull()
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
    const onSelect = renderSelector({ isUserAuthenticated: true })

    expect(document.body.textContent).toContain("GPT-5 Mini")
    expect(document.body.textContent).toContain("GLM 5.2")
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
    ).toBe(
      "pointer-events-auto absolute inset-x-0 top-0 z-20 h-5 touch-none"
    )
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
    expect(mobileOption.className).not.toContain(
      "before:bg-floating-menu-divider/60"
    )
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
    const secondMobileOption = getModelOption("GLM 5.2")
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
    ).toEqual(["Favorites", "All models"])
    for (const section of sections) {
      const label = section.querySelector('[data-slot="model-section-label"]')
      const container = section.querySelector<HTMLElement>(
        '[data-slot="model-section-container"]'
      )

      expect(container?.contains(label)).toBe(false)
      expect(label?.className).toContain("text-sm")
      expect(container?.className).toContain("bg-interactive-selected")
      expect(container?.className).toContain("rounded-3xl")
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
    expect(trigger?.className).toContain("px-3")
    expect(trigger?.className).not.toContain("overflow-hidden")
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

  it("ranks favorites first without hiding the rest of the catalog", () => {
    renderSelector({ isUserAuthenticated: true })

    const optionText = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[data-testid="model-option"]'
      )
    ).map((button) => button.textContent ?? "")

    // Favorite (gpt-5.4) leads; every non-hidden model stays reachable.
    expect(optionText[0]).toContain("GPT-5.4")
    expect(optionText.join(" ")).toContain("GPT-5 Mini")
    expect(optionText.join(" ")).toContain("GLM 5.2")
    // Explicit user-hidden models stay hidden.
    expect(optionText.join(" ")).not.toContain("Claude Opus 4.6")
    // Sections label the ranking.
    expect(document.body.textContent).toContain("Favorites")
    expect(document.body.textContent).toContain("All models")
  })
})
