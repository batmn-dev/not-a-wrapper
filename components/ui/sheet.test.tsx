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

// The overlay base class (sheet.tsx) that must stay byte-identical when
// `overlayClassName` is omitted (GA §7 R2; default-equivalence snapshot).
const OVERLAY_BASE =
  "fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
})

describe("SheetContent overlay (R2)", () => {
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

  function renderSheet(content: React.ReactNode): HTMLElement | null {
    act(() => {
      root?.render(
        <Sheet open onOpenChange={() => {}}>
          {content}
        </Sheet>
      )
    })
    return document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]')
  }

  it("renders an overlay byte-identical to the base when overlayClassName is omitted", () => {
    const overlay = renderSheet(
      <SheetContent>
        <SheetTitle>Default</SheetTitle>
      </SheetContent>
    )

    expect(overlay).toBeTruthy()
    expect(overlay!.getAttribute("class")).toBe(OVERLAY_BASE)
  })

  it("appends overlayClassName additively without dropping the base", () => {
    const overlay = renderSheet(
      <SheetContent overlayClassName="scrim-test">
        <SheetTitle>With scrim</SheetTitle>
      </SheetContent>
    )

    expect(overlay!.getAttribute("class")).toBe(`${OVERLAY_BASE} scrim-test`)
  })

  it("keeps the overlay byte-identical for the sidebar.tsx consumer usage", () => {
    // Mirrors components/ui/sidebar.tsx:208-219 (no overlayClassName).
    const overlay = renderSheet(
      <SheetContent
        side="left"
        className="bg-sidebar text-sidebar-foreground w-(--sidebar-width) p-0 [&>button]:hidden"
      >
        <SheetTitle>Sidebar</SheetTitle>
      </SheetContent>
    )

    expect(overlay!.getAttribute("class")).toBe(OVERLAY_BASE)
  })

  it("keeps the overlay byte-identical for the app-sidebar.tsx consumer usage", () => {
    // Mirrors app/components/layout/sidebar/app-sidebar.tsx:229-236 (no overlayClassName).
    const overlay = renderSheet(
      <SheetContent
        side="left"
        showCloseButton={false}
        className="bg-sidebar text-sidebar-foreground h-full min-w-0 gap-0 overflow-hidden p-0"
      >
        <SheetTitle>App sidebar</SheetTitle>
      </SheetContent>
    )

    expect(overlay!.getAttribute("class")).toBe(OVERLAY_BASE)
  })
})
