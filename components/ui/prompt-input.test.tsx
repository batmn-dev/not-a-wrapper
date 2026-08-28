/** @vitest-environment jsdom */

import { RI_GLOBAL_LINE_PATH } from "@/lib/icons/composer"
import React, { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputFooter,
  PromptInputTextarea,
} from "./prompt-input"
import { Button } from "./button"
import { ScrollRoot } from "./scroll-root"

let surfaceWidth = 768
let leadingWidth = 36
let trailingWidth = 148
let scrollHeightReads = 0
let mediaMatches = false
let resizeObservers: ResizeObserverMock[] = []

function rect(width: number): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }
}

class ResizeObserverMock {
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()

  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this)
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

describe("PromptInput responsive expansion", () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT
  })

  beforeEach(() => {
    surfaceWidth = 768
    leadingWidth = 36
    trailingWidth = 148
    scrollHeightReads = 0
    mediaMatches = false
    resizeObservers = []

    vi.stubGlobal("ResizeObserver", ResizeObserverMock)
    Object.defineProperties(Range.prototype, {
      getBoundingClientRect: {
        configurable: true,
        value: () => rect(0),
      },
      getClientRects: {
        configurable: true,
        value: () => [],
      },
    })
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: mediaMatches,
        media: "(max-width: 639px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    )

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: Element) {
        if (!(this instanceof HTMLElement)) return rect(0)
        if (
          this.dataset.composerSurface === "true" ||
          this.dataset.composerLayout === "true"
        ) {
          return rect(surfaceWidth)
        }
        if (this.dataset.composerLeading === "true") {
          return rect(leadingWidth)
        }
        if (this.dataset.composerTrailing === "true") {
          return rect(trailingWidth)
        }
        return rect(this instanceof HTMLTextAreaElement ? 555 : 0)
      }
    )

    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      if (element instanceof HTMLTextAreaElement) {
        return {
          lineHeight: "26px",
          paddingBottom: "16px",
          paddingTop: "0px",
          getPropertyValue: () => "",
        } as unknown as CSSStyleDeclaration
      }

      return {
        paddingLeft: "8px",
        paddingRight: "8px",
        getPropertyValue: (property: string) => {
          if (property === "--composer-compact-editor-padding-start") {
            return "7px"
          }
          if (property === "--composer-compact-editor-padding-end") {
            return "6px"
          }
          return ""
        },
      } as unknown as CSSStyleDeclaration
    })

    vi.spyOn(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
      "get"
    ).mockImplementation(function scrollHeight(this: HTMLTextAreaElement) {
      scrollHeightReads += 1
      const width = Number.parseFloat(this.style.width) || 555
      return this.value.length * 8 > width ? 68 : 42
    })

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("remeasures a static draft when available inline width changes", () => {
    const value = "a".repeat(65)

    act(() => {
      root.render(
        <PromptInput value={value} onValueChange={() => {}}>
          <PromptInputActions data-composer-leading="true" />
          <PromptInputTextarea aria-label="Ask anything" />
          <PromptInputFooter aria-hidden="true" />
          <PromptInputActions data-composer-trailing="true" />
        </PromptInput>
      )
    })

    const form = container.querySelector("form")
    const observer = resizeObservers.at(-1)
    expect(observer).toBeTruthy()
    expect(form?.hasAttribute("data-expanded")).toBe(false)

    const readsAfterInitialLayout = scrollHeightReads
    act(() => observer?.trigger())
    expect(scrollHeightReads).toBe(readsAfterInitialLayout)

    trailingWidth = 264
    act(() => observer?.trigger())
    expect(form?.hasAttribute("data-expanded")).toBe(true)

    trailingWidth = 148
    act(() => observer?.trigger())
    expect(form?.hasAttribute("data-expanded")).toBe(false)

    surfaceWidth = 650
    act(() => observer?.trigger())
    expect(form?.hasAttribute("data-expanded")).toBe(true)

    surfaceWidth = 768
    act(() => observer?.trigger())
    expect(form?.hasAttribute("data-expanded")).toBe(false)
  })

  it("disconnects geometry observation with the textarea DOM lifecycle", () => {
    act(() => {
      root.render(
        <PromptInput value="draft" onValueChange={() => {}}>
          <PromptInputActions data-composer-leading="true" />
          <PromptInputTextarea aria-label="Ask anything" />
          <PromptInputActions data-composer-trailing="true" />
        </PromptInput>
      )
    })

    const observer = resizeObservers.at(-1)
    expect(observer).toBeTruthy()

    act(() => root.unmount())
    expect(observer?.disconnect).toHaveBeenCalledTimes(1)

    root = createRoot(container)
  })

  it("describes the focusable visually disabled action with its tooltip", () => {
    act(() => {
      root.render(
        <PromptInput value="" onValueChange={() => {}}>
          <PromptInputAction tooltip="Message is empty">
            <Button visuallyDisabled aria-label="Send prompt" />
          </PromptInputAction>
        </PromptInput>
      )
    })

    const button = container.querySelector(
      'button[aria-label="Send prompt"]'
    ) as HTMLButtonElement
    const descriptionId = button.getAttribute("aria-describedby")

    expect(button.hasAttribute("data-visually-disabled")).toBe(true)
    expect(button.disabled).toBe(false)
    expect(button.tabIndex).toBe(0)
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.getAttribute("data-slot")).toBe("button")
    expect(button.parentElement?.getAttribute("data-slot")).toBe(
      "tooltip-trigger"
    )
    expect(button.parentElement?.getAttribute("aria-describedby")).toBe(
      descriptionId
    )
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId ?? "")?.textContent).toBe(
      "Message is empty"
    )
  })

  it("keeps one ProseMirror textbox across controlled draft replacements", () => {
    const renderDraft = (value: string) => {
      act(() => {
        root.render(
          <PromptInput value={value} onValueChange={() => {}}>
            <PromptInputTextarea
              aria-label="Ask anything"
              placeholder="Ask anything"
            />
          </PromptInput>
        )
      })
    }

    renderDraft("first line")

    const editor = container.querySelector("#prompt-textarea") as HTMLElement
    const fallback = container.querySelector(
      ".composer-fallback-textarea"
    ) as HTMLTextAreaElement
    const surface = container.querySelector(
      '[data-composer-surface="true"]'
    ) as HTMLElement
    const form = container.querySelector("form") as HTMLFormElement
    const overlayHost = container.querySelector(
      "[data-composer-overlay-host]"
    ) as HTMLElement
    const layout = container.querySelector(
      '[data-composer-layout="true"]'
    ) as HTMLElement
    const editorScroller = container.querySelector(
      '[data-composer-editor-scroller="true"]'
    ) as HTMLElement
    const editorWrapper = container.querySelector(
      '[data-composer-editor-wrapper="true"]'
    ) as HTMLElement

    expect(editor.getAttribute("contenteditable")).toBe("true")
    expect(editor.getAttribute("role")).toBe("textbox")
    expect(editor.getAttribute("aria-multiline")).toBe("true")
    expect(editor.getAttribute("data-virtualkeyboard")).toBe("true")
    expect(editor.getAttribute("autocomplete")).toBe("off")
    expect(editor.getAttribute("inputmode")).toBe("text")
    expect(editor.getAttribute("autocorrect")).toBe("on")
    expect(editor.getAttribute("autocapitalize")).toBe("sentences")
    expect(editor.getAttribute("spellcheck")).toBe("true")
    expect(editor.getAttribute("translate")).toBe("no")
    expect(editor.className).not.toContain("min-h-[42px]")
    expect(editor.className).not.toContain("mt-4")
    expect(editor.className).not.toContain("pb-4")
    expect(editor.textContent).toBe("first line")
    expect(editor.querySelector("p")?.getAttribute("dir")).toBe("auto")
    expect(fallback.className).toContain("wcDTda_fallbackTextarea")
    expect(fallback.getAttribute("aria-hidden")).toBeNull()
    expect(fallback.getAttribute("tabindex")).toBeNull()
    expect(fallback.getAttribute("readonly")).toBeNull()
    expect(fallback.name).toBe("prompt-textarea")
    expect(fallback.style.display).toBe("none")
    expect(form.className).toContain("relative")
    expect(form.className).toContain("z-1")
    expect(overlayHost.parentElement?.parentElement).toBe(form)
    expect(overlayHost.className).toContain("pointer-events-none")
    expect(overlayHost.className).toContain("absolute")
    expect(overlayHost.className).toContain("inset-0")
    expect(layout.hasAttribute("data-composer-body")).toBe(true)
    expect(layout.hasAttribute("data-composer-grid")).toBe(true)
    expect(layout.className).toContain("min-w-0")
    expect(layout.className).toContain(
      "@max-[520px]/main:[grid-template-areas:'header_header_header'_'primary_primary_primary'_'leading_footer_trailing']"
    )
    expect(layout.className).toContain(
      "max-sm:group-not-data-expanded/composer:pb-2"
    )
    expect(editorScroller.className).toContain("vertical-scroll-fade-mask")
    expect(editorScroller.hasAttribute("data-scrollable-surface")).toBe(true)
    expect(editorScroller.className).toContain("wcDTda_prosemirror-parent")
    expect(editorScroller.className).toContain("default-browser")
    expect(editorScroller.className).toContain("max-h-[max(30svh,5rem)]")
    expect(editorScroller.className).not.toContain("max-h-52")
    expect(editorScroller.className).toContain("scroll-py-4")
    expect(editorScroller.style.maxHeight).toBe("")
    expect(editorWrapper.className).toContain("min-h-0")
    expect(editorWrapper.className).toContain("items-stretch")
    expect(editorWrapper.className).not.toContain(
      "group-data-[expanded-composer]/composer:h-full"
    )
    expect(form.style.getPropertyValue("--composer-border-radius")).toBe("28px")
    expect(form.style.getPropertyValue("view-transition-name")).toBe(
      "var(--vt-composer)"
    )
    expect(surface.className).toContain(
      "rounded-[var(--composer-border-radius)]"
    )
    expect(surface.className).toContain("bg-[var(--composer-surface-primary)]")
    expect(surface.className).toContain("[corner-shape:superellipse(1.1)]")
    expect(surface.className).toContain(
      "max-sm:not-dark:shadow-[0_0_0_1px_rgba(0,_0,_0,_0.04),0_2px_8px_0_rgba(0,_0,_0,_0.04),0px_4px_40px_8px_rgba(0,_0,_0,_0.025)]"
    )

    renderDraft("second line\nthird line")

    expect(container.querySelector("#prompt-textarea")).toBe(editor)
    expect(
      Array.from(
        editor.querySelectorAll("p"),
        (paragraph) => paragraph.textContent
      )
    ).toEqual(["second line", "third line"])
  })

  it("keeps one empty paragraph through the Strict Mode callback-ref remount", () => {
    act(() => {
      root.render(
        <StrictMode>
          <PromptInput value="" onValueChange={() => {}}>
            <PromptInputTextarea
              aria-label="Ask anything"
              placeholder="Ask anything"
            />
          </PromptInput>
        </StrictMode>
      )
    })

    const editor = container.querySelector("#prompt-textarea") as HTMLElement
    const paragraph = editor.querySelector("p")

    expect(editor.querySelectorAll("p")).toHaveLength(1)
    expect(paragraph?.getAttribute("data-empty-paragraph")).toBe("true")
    expect(paragraph?.getAttribute("data-placeholder")).toBe("Ask anything")
    expect(paragraph?.classList).toContain("placeholder")

    act(() => {
      root.render(
        <StrictMode>
          <PromptInput value={"\n"} onValueChange={() => {}}>
            <PromptInputTextarea
              aria-label="Ask anything"
              placeholder="Ask anything"
            />
          </PromptInput>
        </StrictMode>
      )
    })

    expect(editor.querySelectorAll("p")).toHaveLength(2)
    expect(editor.querySelector("p.placeholder")).toBeNull()
  })

  it("renders protected typed entities inside the stable editor DOM", () => {
    const entity = {
      id: "web-search",
      kind: "capability" as const,
      label: "Web search",
    }

    act(() => {
      root.render(
        <PromptInput
          entities={[entity]}
          value="draft"
          onEntitiesChange={() => {}}
          onValueChange={() => {}}
        >
          <PromptInputTextarea aria-label="Ask anything" />
        </PromptInput>
      )
    })

    const editor = container.querySelector("#prompt-textarea") as HTMLElement
    const cursorTarget = editor.querySelector(
      "span[data-inline-selection-pill-cursor-target]"
    )
    const entityNode = editor.querySelector("span[data-inline-selection-pill]")

    expect(cursorTarget?.getAttribute("aria-hidden")).toBe("true")
    expect(cursorTarget?.textContent).toBe("\uFEFF")
    expect(entityNode?.getAttribute("contenteditable")).toBe("false")
    expect(entityNode?.getAttribute("data-id")).toBe("search")
    expect(entityNode?.getAttribute("data-keyword")).toBe("Web search")
    expect(entityNode?.getAttribute("data-system-hint-type")).toBe("search")
    expect(entityNode?.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true"
    )
    expect(entityNode?.querySelector("circle")).toBeNull()
    expect(entityNode?.querySelector("path")?.getAttribute("d")).toBe(
      RI_GLOBAL_LINE_PATH
    )
    expect(entityNode?.querySelector("path")?.getAttribute("fill")).toBe(
      "var(--web-search-icon-foreground)"
    )
    expect(entityNode?.textContent).toBe("Web search")
    expect(entityNode?.nextSibling?.nodeType).toBe(Node.TEXT_NODE)
    expect(entityNode?.nextSibling?.textContent).toBe(" draft")
    expect(editor.querySelector(".ProseMirror-trailingBreak")).toBeNull()

    act(() => {
      root.render(
        <PromptInput
          entities={[{ ...entity }]}
          value="draft"
          onEntitiesChange={() => {}}
          onValueChange={() => {}}
        >
          <PromptInputTextarea aria-label="Ask anything" />
        </PromptInput>
      )
    })

    expect(container.querySelector("#prompt-textarea")).toBe(editor)
    expect(editor.querySelector("span[data-inline-selection-pill]")).toBe(
      entityNode
    )
  })

  it("submits Enter and preserves Shift+Enter as a draft paragraph", () => {
    const onSubmit = vi.fn()
    const onValueChange = vi.fn()

    act(() => {
      root.render(
        <PromptInput
          value="draft"
          onSubmit={onSubmit}
          onValueChange={onValueChange}
        >
          <PromptInputTextarea aria-label="Ask anything" />
        </PromptInput>
      )
    })

    const editor = container.querySelector("#prompt-textarea") as HTMLElement

    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      )
    })
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onValueChange).not.toHaveBeenCalled()

    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
          shiftKey: true,
        })
      )
    })
    expect(onValueChange).toHaveBeenLastCalledWith("\ndraft")
  })

  it("keeps IME composition and disabled submission inside the editor primitive", () => {
    const onSubmit = vi.fn()
    const onKeyDown = vi.fn()

    act(() => {
      root.render(
        <PromptInput
          disabled
          value="draft"
          onSubmit={onSubmit}
          onValueChange={() => {}}
        >
          <PromptInputTextarea
            aria-label="Ask anything"
            onKeyDown={onKeyDown}
          />
        </PromptInput>
      )
    })

    const editor = container.querySelector("#prompt-textarea") as HTMLElement
    const form = container.querySelector("form") as HTMLFormElement

    expect(editor.getAttribute("contenteditable")).toBe("false")
    expect(editor.getAttribute("aria-disabled")).toBe("true")
    expect(editor.getAttribute("aria-readonly")).toBe("true")

    act(() => {
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true })
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()

    act(() => {
      root.render(
        <PromptInput value="draft" onSubmit={onSubmit} onValueChange={() => {}}>
          <PromptInputTextarea
            aria-label="Ask anything"
            onKeyDown={onKeyDown}
          />
        </PromptInput>
      )
    })

    const composingEnter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    })
    Object.defineProperty(composingEnter, "isComposing", { value: true })
    act(() => editor.dispatchEvent(composingEnter))

    const imeEnter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    })
    Object.defineProperty(imeEnter, "keyCode", { value: 229 })
    act(() => editor.dispatchEvent(imeEnter))

    const alreadyHandledEnter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    })
    alreadyHandledEnter.preventDefault()
    act(() => editor.dispatchEvent(alreadyHandledEnter))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onKeyDown).not.toHaveBeenCalled()
    expect(editor.getAttribute("aria-disabled")).toBeNull()
    expect(editor.getAttribute("aria-readonly")).toBeNull()
  })

  it("uses ChatGPT's accessible expand control and root-owned scroll lock", () => {
    const renderComposer = (expanded: boolean) => {
      act(() => {
        root.render(
          <ScrollRoot>
            <PromptInput
              expanded={expanded}
              value={expanded ? "first line\nsecond line" : "draft"}
              onValueChange={() => {}}
            >
              <PromptInputTextarea aria-label="Ask anything" />
              <PromptInputFooter aria-hidden="true" />
            </PromptInput>
          </ScrollRoot>
        )
      })
    }

    renderComposer(true)

    const scrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement
    const form = container.querySelector("form") as HTMLFormElement
    const surface = container.querySelector(
      '[data-composer-surface="true"]'
    ) as HTMLElement
    const editorWrapper = container.querySelector(
      '[data-composer-editor-wrapper="true"]'
    ) as HTMLElement
    const editorScroller = container.querySelector(
      '[data-composer-editor-scroller="true"]'
    ) as HTMLElement
    const expandButton = container.querySelector(
      'button[aria-label="Expand"]'
    ) as HTMLButtonElement

    expect(form.hasAttribute("data-expanded-composer-mode-button")).toBe(true)
    expect(editorWrapper.className).toContain(
      "group-data-expanded/composer:ps-2.5"
    )
    expect(editorWrapper.className).toContain(
      "group-data-expanded/composer:pe-0"
    )
    expect(editorWrapper.className).not.toContain(
      "group-data-[expanded]/composer:px-2.5"
    )
    expect(editorScroller.className).toContain(
      "group-data-[expanded-composer-mode-button]/composer:pe-9"
    )
    expect(editorWrapper.className).not.toContain(
      "group-data-[expanded-composer]/composer:h-full"
    )
    expect(editorScroller.className).toContain(
      "group-data-[expanded-composer]/composer:h-full"
    )
    expect(
      container.querySelector("[data-composer-controls-anchor]")
    ).not.toBeNull()
    expect(expandButton.type).toBe("button")
    expect(expandButton.getAttribute("aria-pressed")).toBe("false")
    expect(expandButton.getAttribute("data-slot")).toBe("tooltip-trigger")
    expect(expandButton.hasAttribute("data-composer-control")).toBe(true)
    expect(expandButton.className).toContain("composer-btn")
    expect(expandButton.className).not.toContain("hover:bg-interactive-hover")
    expect(expandButton.className).not.toContain(
      "active:bg-interactive-pressed"
    )
    expect(expandButton.className).toContain("press-motion")
    expect(expandButton.querySelector('[data-slot="icon"]')).not.toBeNull()
    expect(
      expandButton.querySelector('[data-slot="icon"]')?.className
    ).toContain("text-[var(--text-secondary)]")
    expect(expandButton.querySelector("svg")?.getAttribute("width")).toBe("20")
    expect(expandButton.querySelector("path")?.getAttribute("fill")).toBe(
      "currentColor"
    )
    expect(expandButton.querySelector("path")?.getAttribute("d")).toBe(
      "M4.335 11a.665.665 0 0 1 1.33 0v3.335H9l.134.014a.665.665 0 0 1 0 1.302L9 15.665H5A.665.665 0 0 1 4.335 15zm10-2V5.665H11a.665.665 0 0 1 0-1.33h4l.134.014c.303.062.531.33.531.651v4a.665.665 0 1 1-1.33 0"
    )

    act(() => expandButton.click())

    const collapseButton = container.querySelector(
      'button[aria-label="Collapse"]'
    ) as HTMLButtonElement
    expect(collapseButton.getAttribute("aria-pressed")).toBe("true")
    expect(collapseButton.querySelector("path")?.getAttribute("fill")).toBe(
      "currentColor"
    )
    expect(form.hasAttribute("data-expanded-composer")).toBe(true)
    expect(surface.hasAttribute("data-expanded-composer")).toBe(true)
    expect(scrollRoot.hasAttribute("data-expanded-composer")).toBe(true)
    expect(surface.className).toContain("[corner-shape:superellipse(1.1)]")
    expect(surface.className).toContain(
      "h-[min(calc(100svh-var(--header-height)-8rem),48rem)]"
    )
    expect(collapseButton.querySelector("path")?.getAttribute("d")).toBe(
      "M7.335 16v-3.335H4a.665.665 0 1 1 0-1.33h4c.367 0 .665.298.665.665v4a.665.665 0 0 1-1.33 0m4-12a.665.665 0 1 1 1.33 0v3.335H16l.134.014a.665.665 0 0 1 0 1.302L16 8.665h-4A.665.665 0 0 1 11.335 8z"
    )

    renderComposer(false)
    expect(scrollRoot.hasAttribute("data-expanded-composer")).toBe(false)
    expect(surface.className).toContain("[corner-shape:superellipse(1.1)]")
    expect(container.querySelector('button[aria-label="Expand"]')).toBeNull()
  })

  it("keeps the expand and collapse tooltip synchronized with the control", async () => {
    await act(async () => {
      root.render(
        <PromptInput
          expanded
          value={"first line\nsecond line"}
          onValueChange={() => {}}
        >
          <PromptInputTextarea aria-label="Ask anything" />
        </PromptInput>
      )
    })

    const expandButton = container.querySelector(
      'button[aria-label="Expand"]'
    ) as HTMLButtonElement

    await act(async () => {
      expandButton.focus()
    })
    expect(
      document.body.querySelector('[data-slot="tooltip-content"]')?.textContent
    ).toBe("Expand")

    await act(async () => {
      expandButton.click()
    })
    const collapseButton = container.querySelector(
      'button[aria-label="Collapse"]'
    ) as HTMLButtonElement
    await act(async () => {
      collapseButton.blur()
      collapseButton.focus()
    })
    expect(
      document.body.querySelector('[data-slot="tooltip-content"]')?.textContent
    ).toBe("Collapse")
  })
})
