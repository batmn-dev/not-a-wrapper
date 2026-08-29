/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { CollapsibleSection } from "./collapsible-section"

describe("CollapsibleSection semantics", () => {
  it("wraps the sidebar trigger in a heading without including header actions", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <CollapsibleSection
          title="Projects"
          variant="sidebar"
          headerActions={<button type="button">More</button>}
        >
          Project list
        </CollapsibleSection>
      )
    })

    const heading = container.querySelector("h2")
    const trigger = heading?.querySelector("button")

    expect(heading?.children).toHaveLength(1)
    expect(heading?.firstElementChild).toBe(trigger)
    expect(trigger?.textContent).toContain("Projects")
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
    expect(heading?.textContent).not.toContain("More")
    const panelId = trigger?.getAttribute("aria-controls")
    expect(panelId).toBeTruthy()
    expect(panelId && document.getElementById(panelId)).not.toBeNull()

    act(() => trigger?.click())

    expect(trigger?.getAttribute("aria-expanded")).toBe("false")

    act(() => root.unmount())
    container.remove()
  })
})
