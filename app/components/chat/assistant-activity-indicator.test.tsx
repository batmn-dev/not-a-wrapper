/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, describe, expect, it } from "vitest"
import { AssistantActivityIndicator } from "./assistant-activity-indicator"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("AssistantActivityIndicator", () => {
  it("keeps live and passive non-inspectable states out of keyboard order", () => {
    const container = document.createElement("div")
    const root = createRoot(container)

    act(() => {
      root.render(
        <>
          <AssistantActivityIndicator
            presentation={{
              kind: "live-status",
              semanticKind: "thinking",
              label: "Thinking",
              motion: "shimmer",
            }}
            open={false}
          />
          <AssistantActivityIndicator
            presentation={{
              kind: "passive",
              label: "Thought for 1s",
              durationSeconds: 1,
            }}
            open={false}
          />
        </>
      )
    })

    expect(container.textContent).toContain("Thinking")
    expect(container.textContent).toContain("Thought for 1s")
    expect(container.querySelector("button")).toBeNull()
    expect(container.querySelector("[aria-expanded]")).toBeNull()
    expect(container.querySelector("[aria-controls]")).toBeNull()

    const statusRows = container.querySelectorAll(
      '[data-slot="activity-status-row"]'
    )
    expect(statusRows).toHaveLength(2)
    for (const statusRow of statusRows) {
      expect(statusRow.className).toContain("h-6")
      expect(statusRow.className).toContain("gap-0.5")
    }

    act(() => root.unmount())
  })
})
