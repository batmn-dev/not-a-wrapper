import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { getSources } from "./sources"
import {
  classifyToolName,
  deriveTurnEvidence,
  resolveEntryStatus,
  type ToolCallEvidence,
} from "./turn-evidence"

const parts = (value: unknown) => value as UIMessage["parts"]

describe("tool lifecycle × liveness resolution", () => {
  it.each([
    // state fixture, lifecycle kind, live status, settled status
    [{ state: "input-streaming", input: {} }, "in-flight", "running", "stopped"],
    [{ state: "input-available", input: {} }, "in-flight", "running", "stopped"],
    [
      { state: "approval-requested", input: {}, approval: { id: "a1" } },
      "awaiting-approval",
      "approval",
      "approval",
    ],
    [
      {
        state: "approval-responded",
        input: {},
        approval: { id: "a1", approved: true },
      },
      "in-flight",
      "running",
      "stopped",
    ],
    [
      {
        state: "approval-responded",
        input: {},
        approval: { id: "a1", approved: false },
      },
      "denied",
      "denied",
      "denied",
    ],
    [
      {
        state: "output-denied",
        input: {},
        approval: { id: "a1", approved: false, reason: "No" },
      },
      "denied",
      "denied",
      "denied",
    ],
    [
      { state: "output-available", input: {}, output: {} },
      "succeeded",
      "complete",
      "complete",
    ],
    [
      { state: "output-available", input: {}, output: { isError: true } },
      "errored",
      "error",
      "error",
    ],
    [
      { state: "output-error", input: {}, errorText: "boom" },
      "errored",
      "error",
      "error",
    ],
  ] as const)(
    "maps %o to lifecycle %s (live %s, settled %s)",
    (partFixture, lifecycleKind, liveStatus, settledStatus) => {
      const [item] = deriveTurnEvidence(
        parts([{ type: "tool-python", toolCallId: "c1", ...partFixture }])
      ).timeline
      expect(item.kind).toBe("tool")
      expect((item as ToolCallEvidence).lifecycle.kind).toBe(lifecycleKind)
      expect(resolveEntryStatus(item, false)).toBe(liveStatus)
      expect(resolveEntryStatus(item, true)).toBe(settledStatus)
    }
  )

  it("resolves frozen streaming reasoning as complete only once settled", () => {
    const [item] = deriveTurnEvidence(
      parts([{ type: "reasoning", text: "…", state: "streaming" }])
    ).timeline
    expect(resolveEntryStatus(item, false)).toBe("running")
    expect(resolveEntryStatus(item, true)).toBe("complete")
  })
})

describe("classifyToolName", () => {
  it("declares the tool-name sets once", () => {
    expect(classifyToolName("web_search")).toBe("search")
    expect(classifyToolName("google_search")).toBe("search")
    expect(classifyToolName("imageGeneration")).toBe("image-generation")
    expect(classifyToolName("image_generation")).toBe("image-generation")
    expect(classifyToolName("imageSearch")).toBe("image-search")
    expect(classifyToolName("anything_else")).toBe("generic")
  })
})

describe("source provenance", () => {
  it("buffers an explicitly-attributed source arriving before its producing search", () => {
    const evidence = deriveTurnEvidence(
      parts([
        {
          type: "source-url",
          sourceId: "early",
          url: "https://early.example",
          title: "Early",
          toolCallId: "search-late",
        },
        {
          type: "tool-web_search",
          toolCallId: "search-late",
          state: "output-available",
          input: { query: "late" },
          output: {},
        },
      ])
    )
    expect(evidence.timeline).toHaveLength(1)
    const [search] = evidence.timeline as [ToolCallEvidence]
    expect(search.id).toBe("tool-search-late")
    expect(search.sources.map((s) => s.url)).toEqual(["https://early.example"])
  })

  it("keeps a source whose producing search never appears out of the timeline but in turn-level sources", () => {
    const evidence = deriveTurnEvidence(
      parts([
        {
          type: "source-url",
          sourceId: "orphaned",
          url: "https://orphan.example",
          title: "Orphan",
          toolCallId: "search-missing",
        },
      ])
    )
    expect(evidence.timeline).toHaveLength(0)
    expect(evidence.sources.map((s) => s.url)).toEqual([
      "https://orphan.example",
    ])
  })

  it("opens one implied search for unattributed sources and hands over to the next real search", () => {
    const evidence = deriveTurnEvidence(
      parts([
        {
          type: "source-url",
          sourceId: "s1",
          url: "https://a.example",
          title: "A",
        },
        {
          type: "source-url",
          sourceId: "s2",
          url: "https://b.example",
          title: "B",
        },
        {
          type: "tool-web_search",
          toolCallId: "real",
          state: "output-available",
          input: { query: "real" },
          output: {},
        },
        {
          type: "source-url",
          sourceId: "s3",
          url: "https://c.example",
          title: "C",
        },
      ])
    )
    expect(
      evidence.timeline.map((item) => ({ kind: item.kind, id: (item as { id?: string }).id }))
    ).toEqual([
      { kind: "implied-search", id: "search-sources-0" },
      { kind: "tool", id: "tool-real" },
    ])
    const [implied, real] = evidence.timeline as [
      { sources: readonly { url: string }[] },
      ToolCallEvidence,
    ]
    expect(implied.sources.map((s) => s.url)).toEqual([
      "https://a.example",
      "https://b.example",
    ])
    expect(real.sources.map((s) => s.url)).toEqual(["https://c.example"])
  })

  it("keeps one item per toolCallId with last-wins facts and accumulated sources", () => {
    const evidence = deriveTurnEvidence(
      parts([
        {
          type: "tool-web_search",
          toolCallId: "c1",
          state: "input-streaming",
          input: { query: "first" },
        },
        { type: "reasoning", text: "between", state: "done" },
        {
          type: "tool-web_search",
          toolCallId: "c1",
          state: "output-available",
          input: { query: "final" },
          output: { sources: [{ url: "https://result.example" }] },
        },
      ])
    )
    expect(evidence.timeline.map((item) => item.kind)).toEqual([
      "tool",
      "reasoning",
    ])
    const [search] = evidence.timeline as [ToolCallEvidence]
    expect(search.lifecycle.kind).toBe("succeeded")
    expect(search.searchQuery).toBe("final")
    expect(search.sources.map((s) => s.url)).toEqual(["https://result.example"])
  })

  it("derives turn-level sources identically to getSources", () => {
    const fixture = parts([
      {
        type: "tool-web_search",
        toolCallId: "c1",
        state: "output-available",
        input: { query: "q" },
        output: { sources: [{ url: "https://dup.example", title: "T" }] },
      },
      {
        type: "source-url",
        sourceId: "s1",
        url: "https://dup.example",
        title: "Duplicate",
      },
      {
        type: "source-url",
        sourceId: "s2",
        url: "https://unique.example",
        title: "Unique",
      },
    ])
    expect(deriveTurnEvidence(fixture).sources).toEqual(getSources(fixture))
  })
})
