/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"
import { Sheet, SheetContent, SheetTitle } from "./sheet"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
})

describe("SheetContent overlayClassName (R2)", () => {
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

  function overlayClassFor(overlayClassName?: string): string {
    act(() => {
      root?.render(
        <Sheet open onOpenChange={() => {}}>
          <SheetContent overlayClassName={overlayClassName}>
            <SheetTitle>T</SheetTitle>
          </SheetContent>
        </Sheet>
      )
    })
    return (
      document
        .querySelector('[data-slot="sheet-overlay"]')
        ?.getAttribute("class") ?? ""
    )
  }

  // The two production Sheet consumers never pass overlayClassName, so the prop
  // must be purely additive: omitting it leaves the overlay class exactly as it
  // is, and passing it only appends. Asserted relatively (no hardcoded base) so
  // the test survives unrelated base-class tweaks.
  it("is additive — omitting leaves the overlay unchanged, passing only appends", () => {
    const base = overlayClassFor(undefined)
    expect(base).not.toBe("")
    expect(overlayClassFor("scrim-test")).toBe(`${base} scrim-test`)
  })
})
