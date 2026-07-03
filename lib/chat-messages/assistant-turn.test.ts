import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import {
  assistantTurnViewsEqual,
  deriveAssistantLoadingState,
  deriveAssistantTurnView,
  deriveReasoningView,
} from "./assistant-turn"

const parts = (value: unknown) => value as UIMessage["parts"]

describe("deriveReasoningView", () => {
  it("is thinking while any reasoning part streams", () => {
    const view = deriveReasoningView(
      parts([{ type: "reasoning", text: "…", state: "streaming" }]),
      "streaming"
    )
    expect(view.phase).toBe("thinking")
    expect(view.isStreaming).toBe(true)
  })

  it("completes on done parts and reads the persisted duration via the metadata module", () => {
    const view = deriveReasoningView(
      parts([{ type: "reasoning", text: "done", state: "done" }]),
      "ready",
      { reasoningDurationMs: 2000 }
    )
    expect(view.phase).toBe("complete")
    expect(view.text).toBe("done")
    expect(view.persistedDurationMs).toBe(2000)
  })

  it("keeps isStreaming a raw part fact: state-less stored parts never shimmer historical triggers", () => {
    // A stored opaque-reasoning part without a `state` field, read while some
    // OTHER turn streams: the panel's phase inference may say "thinking", but
    // the row trigger must not — isStreaming is the literal part state.
    const view = deriveReasoningView(
      parts([{ type: "reasoning", text: "" }]),
      "streaming"
    )
    expect(view.phase).toBe("thinking")
    expect(view.isStreaming).toBe(false)
  })
})

describe("deriveAssistantTurnView", () => {
  it("derives text, tools, sources, and identity in one pass", () => {
    const message = {
      parts: parts([
        { type: "text", text: "Answer " },
        { type: "text", text: "continued" },
        {
          type: "tool-search",
          toolCallId: "t1",
          state: "output-available",
          input: { query: "q" },
          output: { summary: "s" },
        },
        {
          type: "source-url",
          sourceId: "s1",
          url: "https://example.com",
          title: "Example",
        },
      ]),
      metadata: { serverMessageId: "server-1" },
    }

    const view = deriveAssistantTurnView(message, "ready")
    expect(view.text).toBe("Answer continued")
    expect(view.toolParts).toHaveLength(1)
    expect(view.sources.map((s) => s.url)).toEqual(["https://example.com"])
    expect(view.serverMessageId).toBe("server-1")
    expect(view.metadata).toBe(message.metadata)
    expect(view.toolRenderSignature).toContain("search")
  })

  it("observes in-place part mutation across derivations (no memoization)", () => {
    const shared = parts([
      {
        type: "tool-search",
        toolCallId: "t1",
        state: "input-streaming",
        input: { query: "a" },
      },
    ])
    const message = { parts: shared }

    const before = deriveAssistantTurnView(message, "streaming")
    ;(shared as unknown as Array<{ input: { query: string } }>)[0].input.query =
      "ab"
    const after = deriveAssistantTurnView(message, "streaming")

    expect(before.toolRenderSignature).not.toBe(after.toolRenderSignature)
  })
})

describe("assistantTurnViewsEqual (the R3 memo contract)", () => {
  const base = () =>
    deriveAssistantTurnView(
      {
        parts: parts([{ type: "reasoning", text: "a", state: "streaming" }]),
        metadata: undefined,
      },
      "streaming"
    )

  it("treats reasoning text deltas and source additions as equal (panel-owned; row must not churn)", () => {
    const a = base()
    const b = deriveAssistantTurnView(
      {
        parts: parts([
          { type: "reasoning", text: "a longer delta", state: "streaming" },
          {
            type: "source-url",
            sourceId: "s1",
            url: "https://example.com",
            title: "Example",
          },
        ]),
        metadata: undefined,
      },
      "streaming"
    )
    expect(assistantTurnViewsEqual(a, b)).toBe(true)
  })

  it("differs on a reasoning phase transition", () => {
    const a = base()
    const b = deriveAssistantTurnView(
      {
        parts: parts([{ type: "reasoning", text: "a", state: "done" }]),
        metadata: undefined,
      },
      "ready"
    )
    expect(assistantTurnViewsEqual(a, b)).toBe(false)
  })

  it("differs on tool signature and metadata identity changes", () => {
    const a = base()
    const withTool = deriveAssistantTurnView(
      {
        parts: parts([
          { type: "reasoning", text: "a", state: "streaming" },
          {
            type: "tool-search",
            toolCallId: "t1",
            state: "input-streaming",
            input: { query: "q" },
          },
        ]),
        metadata: undefined,
      },
      "streaming"
    )
    expect(assistantTurnViewsEqual(a, withTool)).toBe(false)

    const withMetadata = deriveAssistantTurnView(
      {
        parts: parts([{ type: "reasoning", text: "a", state: "streaming" }]),
        metadata: { serverMessageId: "server-1" },
      },
      "streaming"
    )
    expect(assistantTurnViewsEqual(a, withMetadata)).toBe(false)
  })
})

describe("deriveAssistantLoadingState", () => {
  it("shows dots only for a bare streaming tail", () => {
    const view = deriveAssistantTurnView({ parts: parts([]) }, "streaming")
    const state = deriveAssistantLoadingState(view, {
      status: "streaming",
      isLast: true,
      contentNullOrEmpty: true,
      showToolInvocations: true,
    })
    expect(state.showDots).toBe(true)
  })

  it("keeps dots visible for opaque streaming reasoning with no visible output", () => {
    const view = deriveAssistantTurnView(
      {
        parts: parts([{ type: "reasoning", text: "", state: "streaming" }]),
      },
      "streaming"
    )
    const state = deriveAssistantLoadingState(view, {
      status: "streaming",
      isLast: true,
      contentNullOrEmpty: true,
      showToolInvocations: true,
    })
    expect(view.reasoning.isOpaque).toBe(true)
    expect(state.showDots).toBe(true)
  })

  it("suppresses dots when streaming reasoning has visible text", () => {
    const view = deriveAssistantTurnView(
      {
        parts: parts([
          { type: "reasoning", text: "thinking", state: "streaming" },
        ]),
      },
      "streaming"
    )
    const state = deriveAssistantLoadingState(view, {
      status: "streaming",
      isLast: true,
      contentNullOrEmpty: true,
      showToolInvocations: true,
    })
    expect(view.reasoning.isOpaque).toBe(false)
    expect(state.showDots).toBe(false)
  })

  it("suppresses dots when reasoning is present and reports in-progress tools", () => {
    const view = deriveAssistantTurnView(
      {
        parts: parts([
          { type: "reasoning", text: "…", state: "streaming" },
          {
            type: "tool-search",
            toolCallId: "t1",
            state: "input-streaming",
            input: {},
          },
        ]),
      },
      "streaming"
    )
    const state = deriveAssistantLoadingState(view, {
      status: "streaming",
      isLast: true,
      contentNullOrEmpty: true,
      showToolInvocations: true,
    })
    expect(state.showDots).toBe(false)
    expect(state.showToolProgress).toBe(true)
    expect(state.activeToolNames).toEqual(["search"])
  })
})
