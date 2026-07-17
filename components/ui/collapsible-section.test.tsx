import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CollapsibleSection } from "./collapsible-section"

describe("CollapsibleSection", () => {
  it("keeps sidebar chevron geometry consistent with and without header actions", () => {
    const markup = renderToStaticMarkup(
      <div>
        <CollapsibleSection title="Pinned" variant="sidebar">
          Pinned chats
        </CollapsibleSection>
        <CollapsibleSection
          title="Chats"
          variant="sidebar"
          headerActions={<button type="button">Actions</button>}
        >
          Recent chats
        </CollapsibleSection>
      </div>
    )

    expect(markup.match(/--icon-slot-size:16px/g)).toHaveLength(2)
    expect(markup.match(/--icon-glyph-size:14px/g)).toHaveLength(2)
    expect(markup.match(/gap-\[0\.5px\]/g)).toHaveLength(2)
  })
})
