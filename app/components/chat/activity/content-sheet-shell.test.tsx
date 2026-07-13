/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { ContentSheetShell } from "./content-sheet-shell"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("ContentSheetShell", () => {
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

  it("does not expose the close button as a disclosure trigger", () => {
    act(() => {
      root?.render(
        <ContentSheetShell
          panelId="activity-panel"
          open
          onOpenChange={() => {}}
          title="Activity"
        >
          <div>Activity details</div>
        </ContentSheetShell>
      )
    })

    const closeButton = document.querySelector<HTMLButtonElement>(
      'button[data-slot="sheet-close"]'
    )
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-modal="true"]'
    )

    expect(dialog).toBeTruthy()
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy()
    expect(closeButton?.getAttribute("aria-label")).toBe("Close")
    expect(closeButton?.getAttribute("aria-expanded")).toBeNull()
    expect(closeButton?.getAttribute("aria-controls")).toBeNull()
    expect(closeButton?.getAttribute("data-testid")).toBe("close-button")
    expect(
      document.querySelector(
        '[data-testid="chat-screen-cot-mobile-sheet-title-focus-target"]'
      )?.textContent
    ).toBe("Activity")
    expect(
      document.querySelector(
        '[data-testid="chat-screen-cot-mobile-sheet-handle"]'
      )
    ).toBeTruthy()
    expect(dialog?.querySelector("section")?.className).toContain("h-[80vh]")
  })
})
