/** @vitest-environment jsdom */

import { FileUpload } from "@/components/ui/file-upload"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ButtonPlusMenu } from "./button-plus-menu"

vi.mock("./popover-content-auth", () => ({ PopoverContentAuth: () => null }))

describe("ButtonPlusMenu editor-owned interaction", () => {
  let container: HTMLDivElement
  let root: Root
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
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

  it("keeps editor focus while logical highlight handles arrows and Enter", () => {
    const onToggleSearch = vi.fn()
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
              onToggleSearch={onToggleSearch}
            />
            <div data-composer-overlay-host />
          </form>
        </FileUpload>
      )
    })

    const editor = container.querySelector("#prompt-textarea") as HTMLElement
    const trigger = container.querySelector(
      '[aria-label="Add files and more"]'
    ) as HTMLButtonElement

    act(() => {
      editor.focus()
      trigger.click()
    })

    expect(document.activeElement).toBe(editor)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(
      container.querySelector("[data-composer-overlay-host] [aria-busy=false]")
    ).not.toBeNull()
    expect(
      container.querySelector('[data-highlighted]')?.textContent
    ).toContain("Add photos & files")
    const actionGroup = container.querySelector('[role="group"]')
    const firstActionRow = actionGroup?.querySelector('[tabindex="0"]')
    expect(actionGroup?.parentElement?.getAttribute("aria-busy")).toBe("false")
    expect(firstActionRow?.parentElement?.parentElement).toBe(actionGroup)
    expect(firstActionRow?.getAttribute("data-fill")).toBe("")
    expect(firstActionRow?.className).toContain("relative")
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
      container.querySelector('[data-highlighted]')?.textContent
    ).toContain("Web search")
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(initialScrollCalls)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" })
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
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(editor)
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

    renderMenu({ from: 1, id: 7, query: "", to: 2 })
    const trigger = container.querySelector(
      '[aria-label="Add files and more"]'
    ) as HTMLButtonElement
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
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

    renderMenu({ from: 1, id: 7, query: "w", to: 3 })
    expect(container.querySelector("[data-highlighted]")).toBeNull()

    renderMenu(null)
    renderMenu({ from: 1, id: 8, query: "w", to: 3 })
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
      query: "w",
      to: 3,
    })
    expect(container.querySelector("[data-highlighted]")).toBeNull()
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(editor)
  })
})
