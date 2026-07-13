/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { PromptInput, PromptInputTextarea } from "./prompt-input"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = () =>
    ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList
})

describe("PromptInputTextarea", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    const rootToUnmount = root
    if (rootToUnmount) {
      act(() => {
        rootToUnmount.unmount()
      })
    }
    container?.remove()
    root = null
    container = null
  })

  it("separates grid alignment from the capped editor scroller", () => {
    act(() => {
      root?.render(
        <PromptInput
          maxHeight={240}
          value=""
          onValueChange={() => {}}
          formControls={<input data-testid="form-control" type="file" />}
        >
          <PromptInputTextarea />
        </PromptInput>
      )
    })

    const textarea = container?.querySelector("textarea")
    const wrapper = container?.querySelector(
      '[data-slot="prompt-input-editor-wrapper"]'
    ) as HTMLDivElement | null
    const scroller = container?.querySelector(
      '[data-slot="prompt-input-editor-scroller"]'
    ) as HTMLDivElement | null

    expect(textarea?.className).toContain("field-sizing-content")
    expect(textarea?.style.height).toBe("")
    expect(wrapper?.style.maxHeight).toBe("")
    expect(scroller?.style.maxHeight).toBe("240px")
    expect(wrapper?.dataset.composerEditorWrapper).toBe("true")
    expect(scroller?.dataset.composerEditorScroller).toBe("true")
    expect(scroller?.parentElement).toBe(wrapper)
    expect(textarea?.parentElement).toBe(scroller)
    expect(textarea?.className).toContain("mt-4")
    expect(textarea?.className).toContain("pb-4")
    const form = container?.querySelector("form")
    expect(form?.children[0]?.getAttribute("data-testid")).toBe("form-control")
    expect(form?.children[1]?.className).toBe("relative")
    expect(
      form?.children[1]?.querySelector('[data-slot="prompt-input-surface"]')
    ).toBeTruthy()
  })
})
