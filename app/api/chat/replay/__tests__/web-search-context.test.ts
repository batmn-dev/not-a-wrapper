import { describe, expect, it } from "vitest"
import { synthesizeWebSearchReplayContext } from "../compilers/web-search-context"
import type { ReplayToolExchange } from "../types"

describe("synthesizeWebSearchReplayContext", () => {
  it("formats every normalized result through one provider-neutral policy", () => {
    const tool: ReplayToolExchange = {
      toolName: "web_search",
      replayable: true,
      webSearch: {
        query: "replay safety",
        results: [
          {
            url: "https://example.com/one",
            title: " First result ",
            snippet: " First snippet ",
          },
          { url: "https://example.com/two", title: "  ", snippet: "  " },
          { url: "https://example.com/three", title: "Third result" },
          { url: "https://example.com/four", snippet: "Fourth snippet" },
        ],
      },
    }

    expect(synthesizeWebSearchReplayContext(tool, "provider-safe replay")).toBe(
      'Replay context from prior web_search for "replay safety":\n- First result (https://example.com/one) - First snippet\n- Result (https://example.com/two)\n- Third result (https://example.com/three)\n- Result (https://example.com/four) - Fourth snippet'
    )
  })

  it("uses the caller-provided label for empty-result replay notes", () => {
    const tool: ReplayToolExchange = {
      toolName: "web_search",
      replayable: false,
      webSearch: { query: "replay safety", results: [] },
    }

    expect(synthesizeWebSearchReplayContext(tool, "OpenAI-safe replay")).toBe(
      'Replay note: web_search for "replay safety" was omitted for OpenAI-safe replay.'
    )
    expect(
      synthesizeWebSearchReplayContext(tool, "Anthropic-safe replay")
    ).toBe(
      'Replay note: web_search for "replay safety" was omitted for Anthropic-safe replay.'
    )
  })

  it("applies explicit result and field limits with an omission note", () => {
    const tool: ReplayToolExchange = {
      toolName: "web_search",
      replayable: true,
      webSearch: {
        query: "long replay query",
        results: [
          {
            url: "https://example.com/one-long",
            title: "First title is long",
            snippet: "First snippet is long",
          },
          {
            url: "https://example.com/two-long",
            title: "Second title is long",
            snippet: "Second snippet is long",
          },
          { url: "https://example.com/three" },
        ],
      },
    }

    expect(
      synthesizeWebSearchReplayContext(tool, "provider-safe replay", {
        maxResults: 2,
        maxQueryChars: 8,
        maxTitleChars: 8,
        maxUrlChars: 20,
        maxSnippetChars: 10,
      })
    ).toBe(
      'Replay context from prior web_search for "long re…":\n- First t… (https://example.com…) - First sni…\n- Second… (https://example.com…) - Second sn…\n[1 additional web_search result omitted from replay.]'
    )
  })

  it("returns null when normalized web-search context is unavailable", () => {
    const tool: ReplayToolExchange = {
      toolName: "web_search",
      replayable: false,
    }

    expect(
      synthesizeWebSearchReplayContext(tool, "provider-safe replay")
    ).toBeNull()
  })
})
