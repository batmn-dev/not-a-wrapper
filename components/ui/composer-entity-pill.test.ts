/** @vitest-environment jsdom */

import {
  createPromptInputDocument,
  promptInputSchema,
  readPromptInputEntities,
  type PromptInputEntity,
} from "@/components/ui/prompt-input-schema"
import {
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
} from "prosemirror-model"
import { describe, expect, it } from "vitest"

function roundTripEntities(entities: readonly PromptInputEntity[]) {
  const source = createPromptInputDocument("", entities)
  const container = document.createElement("div")
  container.appendChild(
    DOMSerializer.fromSchema(promptInputSchema).serializeFragment(source.content)
  )
  const parsed = ProseMirrorDOMParser.fromSchema(promptInputSchema).parse(
    container
  )
  return readPromptInputEntities(parsed)
}

describe("composer entity pill DOM contract", () => {
  it("restores the canonical web-search capability id from ChatGPT's DOM id", () => {
    const webSearch: PromptInputEntity = {
      id: "web-search",
      kind: "capability",
      label: "Web search",
      iconUrl: null,
    }

    expect(roundTripEntities([webSearch])).toEqual([webSearch])
  })

  it("preserves a tool whose id happens to be search", () => {
    const tool: PromptInputEntity = {
      id: "search",
      kind: "tool",
      label: "Search connector",
      iconUrl: "/icons/search.png",
    }

    expect(roundTripEntities([tool])).toEqual([tool])
  })
})
