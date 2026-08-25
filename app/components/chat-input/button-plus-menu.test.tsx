/** @vitest-environment jsdom */

import { FileUpload } from "@/components/ui/file-upload"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ButtonPlusMenu } from "./button-plus-menu"

const breakpointMocks = vi.hoisted(() => ({ isMobile: false, isTouch: false }))

vi.mock("@/hooks/use-breakpoint", () => ({
  useBreakpoint: () => breakpointMocks.isMobile,
}))
vi.mock("@/hooks/use-mobile-device-os", () => ({
  useIsMobileDeviceOs: () => breakpointMocks.isTouch,
}))
vi.mock("./popover-content-auth", () => ({ PopoverContentAuth: () => null }))

describe("ButtonPlusMenu editor-owned interaction", () => {
  let container: HTMLDivElement
  let root: Root
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
    breakpointMocks.isMobile = false
    breakpointMocks.isTouch = false
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
                searchMode="optional"
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

  it("shows inherent search as selected and non-toggleable", () => {
    const onToggleSearch = vi.fn()
    act(() => {
      root.render(
        <FileUpload onFilesAdded={() => {}}>
          <form data-type="unified-composer">
            <div id="prompt-textarea" role="textbox" tabIndex={0} />
            <ButtonPlusMenu
              actionQuery={{
                from: 1,
                id: 1,
                isSynthetic: true,
                query: "web",
                to: 1,
                trigger: "@",
              }}
              connectors={[]}
              enableSearch
              isFileUploadAvailable
              searchMode="always-on"
              isUserAuthenticated
              onToggleSearch={onToggleSearch}
            />
            <div data-composer-overlay-host />
          </form>
        </FileUpload>
      )
    })

    const row = Array.from(
      container.querySelectorAll<HTMLElement>("[aria-disabled=true]")
    ).find((item) => item.textContent?.includes("Web search always on"))
    expect(row?.textContent).toContain("Find real-time news and info")
    expect(row?.getAttribute("aria-checked")).toBe("true")
    expect(row?.querySelector("[data-composer-action-check]")).not.toBeNull()
    act(() => row?.click())
    expect(onToggleSearch).not.toHaveBeenCalled()
  })

  it("anchors disabled-action tooltips to the primary text", () => {
    act(() => {
      root.render(
        <FileUpload onFilesAdded={() => {}}>
          <form data-type="unified-composer">
            <div id="prompt-textarea" role="textbox" tabIndex={0} />
            <ButtonPlusMenu
              actionQuery={{
                from: 1,
                id: 1,
                isSynthetic: true,
                query: "files",
                to: 1,
                trigger: "@",
              }}
              connectors={[]}
              enableSearch={false}
              isFileUploadAvailable={false}
              searchMode="optional"
              isUserAuthenticated
              onToggleSearch={() => {}}
            />
            <div data-composer-overlay-host />
          </form>
        </FileUpload>
      )
    })

    const row = container.querySelector<HTMLElement>(
      '[data-slot="tooltip-trigger"][aria-disabled="true"]'
    )
    const anchor = row?.querySelector<HTMLElement>(
      "[data-composer-action-tooltip-anchor]"
    )

    expect(row?.textContent).toContain("Upload from computer")
    expect(anchor?.textContent).toBe("Add photos & files")
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
                searchMode="optional"
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

    // Loading: ChatGPT's single shimmer row while connector suggestions resolve.
    renderMenu(syntheticQuery, undefined)
    const skeleton = container.querySelector(
      "[data-composer-menu-skeleton]"
    ) as HTMLElement
    expect(skeleton).not.toBeNull()
    expect(skeleton.getAttribute("aria-hidden")).toBe("true")
    expect(skeleton.getAttribute("role")).toBeNull()
    expect(skeleton.className).toContain("skeleton")
    expect(skeleton.querySelectorAll(".skeleton-child")).toHaveLength(2)
    expect(skeleton.querySelector(".animate-pulse")).toBeNull()
    expect(skeleton.closest('[aria-busy="true"]')).not.toBeNull()

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
              searchMode="optional"
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
    // The fine-pointer narrow-width popover is NOT the touch treatment —
    // data-content-appearance marks only the mobile-OS icon-chip variant.
    expect(menu?.getAttribute("data-content-appearance")).toBeNull()
    // ChatGPT's current mobile + menu: compact content-sized popover with
    // plain glyph rows — not the old dark icon-circle panel.
    expect(menu?.className).toContain("rounded-[20px]")
    expect(menu?.className).toContain("py-2.5")
    expect(menu?.className).not.toContain("w-[240px]")
    // Content-sized: the rows set the width (capped at max-w-xs); the shared
    // dropdown base's anchor-width sizing must NOT survive the merge, or the
    // popover collapses to the + button's min-w floor and truncates labels.
    expect(menu?.className).toContain("w-max")
    expect(menu?.className).not.toContain("w-(--anchor-width)")
    // Plain currentColor glyphs: no per-action icon tint on mobile rows.
    expect(
      menu?.querySelector('[class*="web-search-icon-foreground"]')
    ).toBeNull()
    // Surface and shadow come from the shared floating-surface tokens — no
    // raw hex values or inline shadows on the menu.
    expect(menu?.className).toContain("bg-floating-surface")
    expect(menu?.className).toContain("shadow-floating-surface")
    expect(menu?.className).not.toMatch(/#[0-9a-fA-F]{3,6}|rgba\(/)
    expect(filesItem?.getAttribute("role")).toBe("menuitem")
    expect(filesItem?.className).toContain("min-h-9")
    expect(filesItem?.className).toContain("rounded-[12px]")
    expect(filesItem?.textContent).toBe("Add photos & files")
    expect(filesItem?.querySelector('[class*="rounded-full"]')).toBeNull()
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

  it("renders ChatGPT's touch-optimized icon-chip popover on mobile-OS devices", () => {
    breakpointMocks.isMobile = true
    breakpointMocks.isTouch = true
    const onFilesAdded = vi.fn()

    act(() => {
      root.render(
        <FileUpload onFilesAdded={onFilesAdded}>
          <form data-type="unified-composer">
            <div id="prompt-textarea" role="textbox" tabIndex={0} />
            <ButtonPlusMenu
              enableSearch={false}
              isFileUploadAvailable
              searchMode="optional"
              isUserAuthenticated
              connectors={[
                {
                  id: "github",
                  name: "GitHub",
                  description: "github.com",
                  enabled: true,
                },
              ]}
              onToggleConnector={() => {}}
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
    // The touch treatment carries the appearance marker and ChatGPT's
    // decompiled container geometry: rounded-28 superellipse, min-w 240px,
    // item-height-capped, content-sized.
    expect(menu?.getAttribute("data-content-appearance")).toBe(
      "touch-optimized"
    )
    expect(menu?.className).toContain("rounded-[28px]")
    expect(menu?.className).toContain("min-w-60")
    expect(menu?.className).toContain("w-max")
    // Live source sets the visible-item cap through an element-scoped custom
    // property, with 6.8 as the reusable stylesheet fallback.
    expect(menu?.style.getPropertyValue("--min-items")).toBe("5.8")
    expect(menu?.className).toContain(
      "var(--min-items,6.8)*var(--floating-menu-item-height)"
    )
    expect(menu?.className).toContain("py-1.5")
    expect(menu?.className).toContain("bg-(--floating-menu-touch-surface)")
    expect(menu?.className).toContain("shadow-floating-menu-touch")
    expect(menu?.className).toContain("select-none")

    // Camera / Photos / Files rows with 36px full-round icon chips on the
    // tertiary token, plus Web search and real connector rows in the same
    // vocabulary.
    const labels = [...(menu?.querySelectorAll(".truncate") ?? [])].map(
      (node) => node.textContent
    )
    expect(labels).toEqual([
      "Camera",
      "Photos",
      "Files",
      "Web search",
      "GitHub",
    ])
    const chips = menu?.querySelectorAll(
      '[class*="rounded-full"][class*="--floating-menu-touch-tertiary"]'
    )
    expect(chips).toHaveLength(5)
    const rows = menu?.querySelectorAll(
      '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]'
    )
    for (const row of rows ?? []) {
      expect(row.className).toContain("min-h-(--floating-menu-item-height)")
      expect(row.className).toContain("rounded-[28px]")
      expect(row.className).toContain("scroll-m-1.5")
      expect(row.className).toContain("cursor-auto")
    }
    const connectorRow = [...(rows ?? [])].find(
      (row) => row.textContent === "GitHub"
    ) as HTMLElement
    expect(connectorRow.getAttribute("role")).toBe("menuitemcheckbox")
    expect(connectorRow.getAttribute("aria-checked")).toBe("true")

    // The camera/photo sources are hidden inputs outside the menu, with
    // ChatGPT's accept/capture contract; rows click them.
    const cameraInput = container.querySelector<HTMLInputElement>(
      '[data-testid="composer-upload-camera-input"]'
    )
    const photosInput = container.querySelector<HTMLInputElement>(
      '[data-testid="composer-upload-photos-input"]'
    )
    expect(cameraInput?.getAttribute("accept")).toBe("image/*")
    expect(cameraInput?.id).toBe("upload-camera")
    expect(cameraInput?.getAttribute("capture")).toBe("environment")
    expect(cameraInput?.multiple).toBe(true)
    expect(photosInput?.getAttribute("accept")).toBe("image/*")
    expect(photosInput?.id).toBe("upload-photos")
    expect(photosInput?.hasAttribute("capture")).toBe(false)

    const cameraClick = vi.spyOn(cameraInput!, "click")
    const cameraRow = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find(
      (row) => row.textContent === "Camera"
    ) as HTMLElement
    act(() => cameraRow.click())
    expect(cameraClick).toHaveBeenCalledTimes(1)

    // Picked files feed the shared added-files pipeline and reset the input.
    const file = new File(["x"], "shot.png", { type: "image/png" })
    Object.defineProperty(photosInput!, "files", {
      configurable: true,
      value: { length: 1, 0: file, item: () => file, [Symbol.iterator]: [file][Symbol.iterator].bind([file]) },
    })
    act(() => {
      photosInput!.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(onFilesAdded).toHaveBeenCalledWith([file])
  })

  it("toggles real connectors from the direct mobile menu", () => {
    breakpointMocks.isMobile = true
    breakpointMocks.isTouch = true
    const onToggleConnector = vi.fn()

    act(() => {
      root.render(
        <FileUpload onFilesAdded={() => {}}>
          <form data-type="unified-composer">
            <div id="prompt-textarea" role="textbox" tabIndex={0} />
            <ButtonPlusMenu
              connectors={[
                {
                  id: "github",
                  name: "GitHub",
                  description: "github.com",
                  enabled: false,
                },
              ]}
              enableSearch={false}
              isFileUploadAvailable
              searchMode="optional"
              isUserAuthenticated
              onToggleConnector={onToggleConnector}
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
    act(() => trigger.click())

    const connectorRow = [...document.body.querySelectorAll('[role="menuitemcheckbox"]')].find(
      (row) => row.textContent === "GitHub"
    ) as HTMLElement
    expect(connectorRow.getAttribute("aria-checked")).toBe("false")
    act(() => connectorRow.click())
    expect(onToggleConnector).toHaveBeenCalledWith("github")
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
                searchMode="optional"
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
