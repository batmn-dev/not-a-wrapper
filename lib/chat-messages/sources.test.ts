import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { getPartSources, getSources } from "./sources"

const part = (value: unknown) => value as UIMessage["parts"][number]

describe("source normalization", () => {
  it("extracts publishedDate from Exa web_search output", () => {
    const [source] = getPartSources(
      part({
        type: "tool-web_search",
        toolCallId: "search-1",
        state: "output-available",
        input: { query: "q" },
        output: [
          {
            url: "https://example.com/post",
            title: "Post title",
            content: "Article body that is not used as the description.",
            publishedDate: "2024-01-15",
          },
        ],
      })
    )

    expect(source).toMatchObject({
      url: "https://example.com/post",
      title: "Post title",
      publishedDate: "2024-01-15",
    })
    expect(source.description).toBeUndefined()
  })

  it("leaves a missing title undefined instead of coercing it to the URL", () => {
    const [source] = getSources([
      part({
        type: "source-url",
        sourceId: "s1",
        url: "https://example.com/untitled",
      }),
    ])

    expect(source.url).toBe("https://example.com/untitled")
    expect(source.title).toBeUndefined()
  })
})
