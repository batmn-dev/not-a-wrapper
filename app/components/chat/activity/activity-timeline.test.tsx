import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ActivityStep, ActivityTimeline } from "./activity-timeline"

describe("ActivityTimeline", () => {
  it("renders every step's content", () => {
    const markup = renderToStaticMarkup(
      <ActivityTimeline>
        <ActivityStep leading="globe">First</ActivityStep>
        <ActivityStep leading="done">Last</ActivityStep>
      </ActivityTimeline>
    )

    expect(markup).toContain("First")
    expect(markup).toContain("Last")
  })

  it("omits the connector on the last step via data-last", () => {
    const markup = renderToStaticMarkup(
      <ActivityTimeline>
        <ActivityStep leading="globe">First</ActivityStep>
        <ActivityStep leading="done">Last</ActivityStep>
      </ActivityTimeline>
    )

    // Each step carries a connector hidden via group-data-[last=true]:hidden;
    // the last step is marked data-last="true" so its connector is hidden.
    expect(markup).toContain("group-data-[last=true]:hidden")
    expect(markup).toContain('data-last="true"')
    expect(markup).toContain('data-last="false"')
  })

  it("keeps the bg-primary/20 rail color (not border-border)", () => {
    const markup = renderToStaticMarkup(
      <ActivityTimeline>
        <ActivityStep leading="globe">Only</ActivityStep>
      </ActivityTimeline>
    )

    expect(markup).toContain("bg-primary/20")
  })
})
