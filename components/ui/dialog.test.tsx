/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "./dialog"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("Dialog structured primitives", () => {
  const containers: HTMLDivElement[] = []
  const roots: ReturnType<typeof createRoot>[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount())
    for (const container of containers.splice(0)) container.remove()
  })

  it("owns the shared header, close affordance, footer slots, and large size", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    containers.push(container)
    const root = createRoot(container)
    roots.push(root)

    act(() => {
      root.render(
        <Dialog open>
          <DialogContent showCloseButton={false} size="large">
            <DialogHeader description="Supporting copy" title="Create project">
              <button type="button">More</button>
            </DialogHeader>
            <DialogFooter
              footerContent={<button type="button">Default memory</button>}
              secondaryButton={<button type="button">Cancel</button>}
              primaryButton={<button type="button">Create project</button>}
            />
          </DialogContent>
        </Dialog>
      )
    })

    const content = document.querySelector<HTMLElement>(
      '[data-slot="dialog-content"]'
    )
    expect(content?.dataset.size).toBe("large")
    expect(content?.className).toContain("sm:max-w-lg")
    const title = document.querySelector("h2")
    expect(title?.textContent).toBe("Create project")
    expect(document.activeElement).toBe(title)

    const closeButton = document.querySelector<HTMLButtonElement>(
      '[data-slot="dialog-close-button"]'
    )
    expect(closeButton?.getAttribute("aria-label")).toBe("Close")
    expect(closeButton?.className).toContain("size-9")
    expect(closeButton?.className).toContain("rounded-[8px]")

    const footer = document.querySelector<HTMLElement>(
      '[data-slot="dialog-footer"]'
    )
    expect(footer?.textContent).toBe("Default memoryCancelCreate project")
    expect(footer?.lastElementChild?.className).toContain("gap-1.5")
  })
})
