/** @vitest-environment jsdom */

import { FileUpload } from "@/components/ui/file-upload"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ButtonPlusMenu } from "./button-plus-menu"

const breakpointMocks = vi.hoisted(() => ({ isMobile: false }))

vi.mock("@/hooks/use-breakpoint", () => ({
  useBreakpoint: () => breakpointMocks.isMobile,
}))
vi.mock("./popover-content-auth", () => ({ PopoverContentAuth: () => null }))

describe("ButtonPlusMenu editor-owned interaction", () => {
  let container: HTMLDivElement
  let root: Root
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
    breakpointMocks.isMobile = false
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it("drives the + button through one editor-owned synthetic session", () => {
    const onOpenActionMenu = vi.fn()
    const onCloseActionQuery = vi.fn()
    const onToggleSearch = vi.fn()
    const renderMenu = (
      actionQuery: React.ComponentProps<typeof ButtonPlusMenu>["actionQuery"]
    ) => {
      act(() => {
        root.render(
          <FileUpload onFilesAdded={() => {}}>
            <form data-type="unified-composer">
              <div id="prompt-textarea" role="textbox" tabIndex={0} />
              <ButtonPlusMenu
                actionQuery={actionQuery}
                connectors={[]}
                enableSearch={false}
                isFileUploadAvailable
                isSearchDisabled={false}
                isUserAuthenticated
                onCloseActionQuery={onCloseActionQuery}
                onOpenActionMenu={onOpenActionMenu}
                onToggleSearch={onToggleSearch}
              />
              <div data-composer-overlay-host />
            </form>
          </FileUpload>
        )
      })
    }

    renderMenu(null)
    const editor = container.querySelector("#prompt-textarea") as HTMLElement
    const trigger = container.querySelector(
      '[aria-label="Add files and more"]'
    ) as HTMLButtonElement
    expect(trigger.parentElement?.getAttribute("data-slot")).toBe(
      "tooltip-trigger"
    )
    const tooltipShortcut = document.querySelector(
      '[data-slot="tooltip-shortcut"]'
    )
    expect(
      tooltipShortcut?.querySelector('[data-slot="tooltip-shortcut-keys"]')
        ?.textContent
    ).toBe("@")

    // Clicking + delegates to the editor's synthetic session — the menu
    // itself opens only once the session publishes an action query.
    act(() => {
      editor.focus()
      trigger.click()
    })
    expect(onOpenActionMenu).toHaveBeenCalledTimes(1)
    expect(trigger.getAttribute("aria-expanded")).toBe("false")

    renderMenu({
      from: 1,
      id: 3,
      isSynthetic: true,
      query: "",
      to: 1,
      trigger: "@",
    })
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(
      container.querySelector("[data-composer-overlay-host] [aria-busy=false]")
    ).not.toBeNull()
    expect(
      container.querySelector("[data-highlighted]")?.textContent
    ).toContain("Add photos & files")
    expect(
      container.querySelector("[data-composer-menu-hint]")?.textContent
    ).toContain("Type to search")
    const initialScrollCalls = scrollIntoView.mock.calls.length

    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowDown",
        })
      )
    })
    expect(
      container.querySelector("[data-highlighted]")?.textContent
    ).toContain("Web search")
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(initialScrollCalls)
    expect(document.activeElement).toBe(editor)

    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        })
      )
    })
    expect(onToggleSearch).toHaveBeenCalledWith(true)
    expect(document.activeElement).toBe(editor)

    // Escape on a synthetic session ends it in the editor instead of the
    // menu-side dismissal used for typed sessions.
    renderMenu({
      from: 1,
      id: 4,
      isSynthetic: true,
      query: "",
      to: 1,
      trigger: "@",
    })
    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        })
      )
    })
    // Both the capture-phase Escape handler and the Popover's own escape
    // close route through the same idempotent session close.
    expect(onCloseActionQuery).toHaveBeenCalled()
  })

  it("renders connector rows with skeleton loading and slash scoping", () => {
    const onActivateConnector = vi.fn(() => true)
    const renderMenu = (
      actionQuery: React.ComponentProps<typeof ButtonPlusMenu>["actionQuery"],
      connectors: React.ComponentProps<typeof ButtonPlusMenu>["connectors"]
    ) => {
      act(() => {
        root.render(
          <FileUpload onFilesAdded={() => {}}>
            <form data-type="unified-composer">
              <div id="prompt-textarea" role="textbox" tabIndex={0} />
              <ButtonPlusMenu
                actionQuery={actionQuery}
                connectors={connectors}
                enableSearch={false}
                isFileUploadAvailable
                isSearchDisabled={false}
                isUserAuthenticated
                onActivateConnector={onActivateConnector}
                onToggleSearch={() => {}}
              />
              <div data-composer-overlay-host />
            </form>
          </FileUpload>
        )
      })
    }

    const syntheticQuery = {
      from: 1,
      id: 1,
      isSynthetic: true,
      query: "",
      to: 1,
      trigger: "@",
    } as const

    // Loading: skeleton rows while the connector list resolves.
    renderMenu(syntheticQuery, undefined)
    expect(
      container.querySelector("[data-composer-menu-skeleton]")
    ).not.toBeNull()

    const github = {
      id: "srv1",
      name: "GitHub",
      description: "mcp.github.dev",
      enabled: false,
    }
    renderMenu(syntheticQuery, [github])
    expect(container.querySelector("[data-composer-menu-skeleton]")).toBeNull()
    expect(container.textContent).toContain("GitHub")
    expect(container.textContent).toContain("mcp.github.dev")

    // The connector query matches by name, and activation reports the
    // published query so the composer can consume the trigger text.
    const typedQuery = {
      from: 1,
      id: 2,
      isSynthetic: false,
      query: "gith",
      to: 6,
      trigger: "@",
    } as const
    renderMenu(typedQuery, [github])
    expect(container.textContent).not.toContain("Add photos & files")
    const editor = container.querySelector("#prompt-textarea") as HTMLElement
    act(() => {
      editor.focus()
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        })
      )
    })
    expect(onActivateConnector).toHaveBeenCalledWith("srv1", typedQuery)

    // "/" is the command menu: actions only, no connectors, no hint row.
    renderMenu(
      {
        from: 1,
        id: 3,
        isSynthetic: false,
        query: "",
        to: 2,
        trigger: "/",
      },
      [github]
    )
    expect(container.textContent).toContain("Add photos & files")
    expect(container.textContent).not.toContain("GitHub")
    expect(container.querySelector("[data-composer-menu-hint]")).toBeNull()
  })

  it("uses ChatGPT's touch menu semantics and compact geometry on mobile", () => {
    breakpointMocks.isMobile = true

    act(() => {
      root.render(
        <FileUpload onFilesAdded={() => {}}>
          <form data-type="unified-composer">
            <div id="prompt-textarea" role="textbox" tabIndex={0} />
            <ButtonPlusMenu
              enableSearch={false}
              isFileUploadAvailable
              isSearchDisabled={false}
              isUserAuthenticated
              onToggleSearch={() => {}}
            />
            <div data-composer-overlay-host />
          </form>
        </FileUpload>
      )
    })

    const trigger = container.querySelector(
      '[aria-label="Add files and more"]'
    ) as HTMLButtonElement

    act(() => {
      trigger.focus()
      trigger.click()
    })

    const menu = document.body.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-content"]'
    )
    const filesItem = menu?.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-item"]'
    )
    const webSearchItem = menu?.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-radio-item"]'
    )

    expect(menu?.getAttribute("role")).toBe("menu")
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(menu?.getAttribute("data-content-appearance")).toBe(
      "touch-optimized"
    )
    expect(menu?.className).toContain("w-[240px]")
    expect(menu?.className).toContain("rounded-[28px]")
    expect(filesItem?.getAttribute("role")).toBe("menuitem")
    expect(filesItem?.className).toContain("h-12")
    expect(filesItem?.textContent).toBe("Files")
    expect(menu?.textContent).not.toContain("Upload from computer")
    expect(webSearchItem?.getAttribute("role")).toBe("menuitemradio")
    expect(webSearchItem?.getAttribute("aria-checked")).toBe("false")

    let tabWasAllowed = true
    act(() => {
      filesItem?.focus()
      tabWasAllowed = filesItem?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Tab",
        })
      ) ?? true
    })

    expect(tabWasAllowed).toBe(false)
    expect(document.activeElement).toBe(filesItem)
    expect(menu?.hasAttribute("data-open")).toBe(true)
  })

  it("keeps @ discovery editor-owned across filtering, Escape, and Tab activation", () => {
    const onActivateActionQuery = vi.fn(() => true)
    const renderMenu = (
      actionQuery: React.ComponentProps<typeof ButtonPlusMenu>["actionQuery"]
    ) => {
      act(() => {
        root.render(
          <FileUpload onFilesAdded={() => {}}>
            <form data-type="unified-composer">
              <div id="prompt-textarea" role="textbox" tabIndex={0} />
              <ButtonPlusMenu
                actionQuery={actionQuery}
                connectors={[]}
                enableSearch={false}
                isFileUploadAvailable
                isSearchDisabled={false}
                isUserAuthenticated
                onActivateActionQuery={onActivateActionQuery}
                onToggleSearch={() => {}}
              />
              <div data-composer-overlay-host />
            </form>
          </FileUpload>
        )
      })
    }

    renderMenu(null)
    const editor = container.querySelector("#prompt-textarea") as HTMLElement
    act(() => editor.focus())

    renderMenu({
      from: 1,
      id: 7,
      isSynthetic: false,
      query: "",
      to: 2,
      trigger: "@",
    })
    const trigger = container.querySelector(
      '[aria-label="Add files and more"]'
    ) as HTMLButtonElement
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector("[data-highlighted]")?.textContent).toContain(
      "Add photos & files"
    )
    expect(container.textContent).toContain("Web search")
    expect(document.activeElement).toBe(editor)

    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        })
      )
    })
    expect(container.querySelector("[data-highlighted]")).toBeNull()

    renderMenu({
      from: 1,
      id: 7,
      isSynthetic: false,
      query: "w",
      to: 3,
      trigger: "@",
    })
    expect(container.querySelector("[data-highlighted]")).toBeNull()

    renderMenu(null)
    renderMenu({
      from: 1,
      id: 8,
      isSynthetic: false,
      query: "w",
      to: 3,
      trigger: "@",
    })
    expect(container.querySelector("[data-highlighted]")?.textContent).toContain(
      "Web search"
    )
    expect(container.textContent).not.toContain("Add photos & files")

    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Tab",
        })
      )
    })
    expect(onActivateActionQuery).toHaveBeenCalledWith("web-search", {
      from: 1,
      id: 8,
      isSynthetic: false,
      query: "w",
      to: 3,
      trigger: "@",
    })
    expect(container.querySelector("[data-highlighted]")).toBeNull()
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(editor)
  })
})
