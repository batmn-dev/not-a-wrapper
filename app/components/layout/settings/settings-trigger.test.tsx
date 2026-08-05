/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { SettingsDialog } from "./settings-trigger"

vi.mock("./settings-content", () => ({
  SettingsContent: () => <input aria-label="Search settings" />,
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("SettingsDialog", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it("focuses the dialog container instead of the search field when opened", async () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<SettingsDialog open onOpenChange={vi.fn()} />)
    })

    await vi.waitFor(() => {
      const dialog = document.querySelector<HTMLElement>(
        '[data-slot="dialog-content"]'
      )
      const search = document.querySelector<HTMLInputElement>(
        'input[aria-label="Search settings"]'
      )

      expect(document.activeElement).toBe(dialog)
      expect(document.activeElement).not.toBe(search)
    })
  })
})
