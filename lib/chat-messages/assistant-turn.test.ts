import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import {
  assistantTurnViewsEqual,
  deriveAssistantTurnIndicator,
  deriveAssistantTurnPhase,
  deriveAssistantTurnView,
  deriveReasoningView,
  type AssistantTurnRenderStatus,
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

  it("treats a persisted duration without reasoning parts as completed opaque reasoning", () => {
    // The persist layer drops empty opaque reasoning parts; the stamped
    // duration is the surviving evidence. The settled trigger must not vanish
    // when the durable snapshot is adopted.
    const view = deriveReasoningView(parts([]), "ready", {
      reasoningDurationMs: 3000,
    })
    expect(view.phase).toBe("complete")
    expect(view.isOpaque).toBe(true)
    expect(view.persistedDurationMs).toBe(3000)

    // No parts AND no duration stays idle (e.g. the pending placeholder).
    expect(deriveReasoningView(parts([]), "ready").phase).toBe("idle")
  })

  it("settles a part frozen in 'streaming' state once the chat status ends (Stop/error kills the timer)", () => {
    // Abort/stop/error never transitions part states, so a stuck "streaming"
    // part must read complete on a settled turn — this is what freezes the
    // panel's elapsed timer and the trigger's shimmer after Stop.
    for (const status of ["ready", "error"] as const) {
      const view = deriveReasoningView(
        parts([{ type: "reasoning", text: "", state: "streaming" }]),
        status
      )
      expect(view.phase).toBe("complete")
      expect(view.isStreaming).toBe(false)
      expect(view.isOpaque).toBe(true)
    }
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

  it("dedupes sources by URL, keeping the first occurrence", () => {
    // Providers cite the same URL across parts/steps. The view is the single
    // derivation for every consumer (gallery rows, "Sources · N", trigger
    // counts), so one URL must appear once — with its first title.
    const message = {
      parts: parts([
        {
          type: "source-url",
          sourceId: "s1",
          url: "https://releasebot.io/a",
          title: "Releasebot",
        },
        {
          type: "source-url",
          sourceId: "s2",
          url: "https://releasebot.io/a",
          title: "Releasebot (duplicate)",
        },
        {
          type: "source-url",
          sourceId: "s3",
          url: "https://other.dev/b",
          title: "Other",
        },
      ]),
    }

    const view = deriveAssistantTurnView(message, "ready")
    expect(view.sources.map((s) => s.url)).toEqual([
      "https://releasebot.io/a",
      "https://other.dev/b",
    ])
    expect(view.sources[0].title).toBe("Releasebot")
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

// --- The canonical turn phase + its single indicator ---

const liveCtx = { status: "streaming" as const, isLast: true }

function viewOf(
  rawParts: unknown,
  status: "streaming" | "ready" | "submitted" | "error" = "streaming",
  metadata?: unknown
) {
  return deriveAssistantTurnView({ parts: parts(rawParts), metadata }, status)
}

describe("deriveAssistantTurnPhase", () => {
  it("is generating for a bare live stream with nothing else signaled", () => {
    const phase = deriveAssistantTurnPhase(viewOf([]), liveCtx)
    expect(phase).toEqual({ kind: "generating" })
  })

  it("is thinking(opaque) while opaque reasoning streams — the dots+Thinking regression", () => {
    const phase = deriveAssistantTurnPhase(
      viewOf([{ type: "reasoning", text: "", state: "streaming" }]),
      liveCtx
    )
    expect(phase).toEqual({ kind: "thinking", visibility: "opaque" })
  })

  it("is thinking(visible) while reasoning streams visible text", () => {
    const phase = deriveAssistantTurnPhase(
      viewOf([{ type: "reasoning", text: "let me think", state: "streaming" }]),
      liveCtx
    )
    expect(phase).toEqual({ kind: "thinking", visibility: "visible" })
  })

  it("ranks an in-flight tool above streaming reasoning", () => {
    const phase = deriveAssistantTurnPhase(
      viewOf([
        { type: "reasoning", text: "…", state: "streaming" },
        {
          type: "tool-web_search",
          toolCallId: "t1",
          state: "input-streaming",
          input: {},
        },
      ]),
      liveCtx
    )
    expect(phase).toEqual({ kind: "tooling", toolNames: ["web_search"] })
  })

  it("ranks image generation above other in-flight tools", () => {
    const phase = deriveAssistantTurnPhase(
      viewOf([
        {
          type: "tool-web_search",
          toolCallId: "t1",
          state: "input-available",
          input: {},
        },
        {
          type: "tool-imageGeneration",
          toolCallId: "t2",
          state: "input-available",
          input: {},
        },
      ]),
      liveCtx
    )
    expect(phase).toEqual({ kind: "generating-image" })
  })

  it("is awaiting-approval for an approval-requested part, not tooling", () => {
    const phase = deriveAssistantTurnPhase(
      viewOf([
        {
          type: "tool-web_search",
          toolCallId: "t1",
          state: "approval-requested",
          input: {},
          approval: { id: "a1" },
        },
      ]),
      liveCtx
    )
    expect(phase).toEqual({ kind: "awaiting-approval" })
  })

  it("is awaiting-approval when the durable status pauses the turn", () => {
    const phase = deriveAssistantTurnPhase(viewOf([], "ready"), {
      status: "awaiting_approval",
      isLast: true,
    })
    expect(phase).toEqual({ kind: "awaiting-approval" })
  })

  it("counts an approved approval response as in-flight, but not a denied one", () => {
    const approved = deriveAssistantTurnPhase(
      viewOf([
        {
          type: "tool-web_search",
          toolCallId: "t1",
          state: "approval-responded",
          input: {},
          approval: { id: "a1", approved: true },
        },
      ]),
      liveCtx
    )
    expect(approved).toEqual({ kind: "tooling", toolNames: ["web_search"] })

    const denied = deriveAssistantTurnPhase(
      viewOf([
        {
          type: "tool-web_search",
          toolCallId: "t1",
          state: "approval-responded",
          input: {},
          approval: { id: "a1", approved: false },
        },
      ]),
      liveCtx
    )
    expect(denied.kind).toBe("responding")
  })

  it("is responding once the turn has substance and nothing is in flight", () => {
    // Text streaming
    expect(
      deriveAssistantTurnPhase(viewOf([{ type: "text", text: "Hi" }]), liveCtx)
        .kind
    ).toBe("responding")
    // Opaque reasoning finished, first token not yet arrived — the trigger
    // must settle to "Thought", not bounce back to the generating shimmer.
    expect(
      deriveAssistantTurnPhase(
        viewOf([{ type: "reasoning", text: "", state: "done" }]),
        liveCtx
      ).kind
    ).toBe("responding")
    // A completed tool card is substance too.
    expect(
      deriveAssistantTurnPhase(
        viewOf([
          {
            type: "tool-web_search",
            toolCallId: "t1",
            state: "output-available",
            input: {},
            output: {},
          },
        ]),
        liveCtx
      ).kind
    ).toBe("responding")
  })

  it("is submitted pre-stream", () => {
    const phase = deriveAssistantTurnPhase(viewOf([], "submitted"), {
      status: "submitted",
      isLast: true,
    })
    expect(phase).toEqual({ kind: "submitted" })
  })

  it("settles non-last turns regardless of frozen in-progress part states", () => {
    const phase = deriveAssistantTurnPhase(
      viewOf(
        [
          { type: "reasoning", text: "", state: "streaming" },
          {
            type: "tool-web_search",
            toolCallId: "t1",
            state: "input-available",
            input: {},
          },
        ],
        "ready"
      ),
      { status: "streaming", isLast: false }
    )
    expect(phase).toEqual({ kind: "settled" })
  })

  it("settles the last turn the moment the client stream ends — Stop mid-tool-call", () => {
    for (const status of [
      "ready",
      "error",
      "aborted",
      "failed",
      "completed",
    ] as AssistantTurnRenderStatus[]) {
      const phase = deriveAssistantTurnPhase(
        viewOf(
          [
            {
              type: "tool-web_search",
              toolCallId: "t1",
              state: "input-available",
              input: {},
            },
          ],
          "ready"
        ),
        { status, isLast: true }
      )
      expect(phase).toEqual({ kind: "settled" })
    }
  })
})

describe("deriveAssistantTurnIndicator", () => {
  it("maps every live phase to exactly one indicator", () => {
    const emptyView = viewOf([])
    expect(
      deriveAssistantTurnIndicator({ kind: "submitted" }, emptyView)
    ).toEqual({ kind: "trigger", state: { status: "thinking" } })
    expect(
      deriveAssistantTurnIndicator(
        { kind: "thinking", visibility: "opaque" },
        emptyView
      )
    ).toEqual({ kind: "trigger", state: { status: "thinking" } })
    expect(
      deriveAssistantTurnIndicator(
        { kind: "tooling", toolNames: ["web_search"] },
        emptyView
      )
    ).toEqual({
      kind: "trigger",
      state: { status: "running", label: "Searching the web" },
    })
    expect(
      deriveAssistantTurnIndicator({ kind: "generating-image" }, emptyView)
    ).toEqual({
      kind: "trigger",
      state: { status: "running", label: "Generating image" },
    })
    expect(
      deriveAssistantTurnIndicator({ kind: "generating" }, emptyView)
    ).toEqual({ kind: "generating" })
  })

  it("labels multi-tool and custom-tool progress", () => {
    const emptyView = viewOf([])
    expect(
      deriveAssistantTurnIndicator(
        { kind: "tooling", toolNames: ["web_search", "extract_content"] },
        emptyView
      )
    ).toEqual({
      kind: "trigger",
      state: { status: "running", label: "Running tools" },
    })
    expect(
      deriveAssistantTurnIndicator(
        { kind: "tooling", toolNames: ["fetchWeather"] },
        emptyView
      )
    ).toEqual({
      kind: "trigger",
      state: { status: "running", label: "Running Fetch Weather" },
    })
  })

  it("settles to thought > sources > activity > none", () => {
    const settled = { kind: "settled" } as const

    // Duration metadata without a stored reasoning part still reads as
    // thought — the adopted durable snapshot must keep the live turn's label.
    const durationOnly = viewOf([], "ready", { reasoningDurationMs: 3000 })
    expect(deriveAssistantTurnIndicator(settled, durationOnly)).toEqual({
      kind: "trigger",
      state: { status: "thought", durationSeconds: 3 },
    })

    const withReasoning = viewOf(
      [{ type: "reasoning", text: "t", state: "done" }],
      "ready",
      { reasoningDurationMs: 2000 }
    )
    expect(deriveAssistantTurnIndicator(settled, withReasoning)).toEqual({
      kind: "trigger",
      state: { status: "thought", durationSeconds: 2 },
    })

    const withSources = viewOf(
      [{ type: "source-url", sourceId: "s1", url: "https://example.com" }],
      "ready"
    )
    expect(deriveAssistantTurnIndicator(settled, withSources)).toEqual({
      kind: "trigger",
      state: { status: "sources", count: 1 },
    })

    const withTools = viewOf(
      [
        {
          type: "tool-web_search",
          toolCallId: "t1",
          state: "output-available",
          input: {},
          output: {},
        },
      ],
      "ready"
    )
    expect(deriveAssistantTurnIndicator(settled, withTools)).toEqual({
      kind: "trigger",
      state: { status: "activity" },
    })

    expect(
      deriveAssistantTurnIndicator(settled, viewOf([], "ready"))
    ).toEqual({ kind: "none" })
  })

  it("never yields more than one indicator across a sweep of turn states", () => {
    // The closed-by-construction property: for any (parts × status × isLast)
    // combination, the derivation is total and single-valued.
    const partVariants: unknown[] = [
      [],
      [{ type: "reasoning", text: "", state: "streaming" }],
      [{ type: "reasoning", text: "visible", state: "streaming" }],
      [{ type: "reasoning", text: "", state: "done" }],
      [{ type: "text", text: "answer" }],
      [
        {
          type: "tool-web_search",
          toolCallId: "t1",
          state: "input-available",
          input: {},
        },
      ],
      [
        { type: "reasoning", text: "…", state: "streaming" },
        {
          type: "tool-imageGeneration",
          toolCallId: "t2",
          state: "input-streaming",
          input: {},
        },
        { type: "text", text: "partial" },
      ],
    ]
    const statuses: AssistantTurnRenderStatus[] = [
      "submitted",
      "streaming",
      "ready",
      "error",
      "completed",
      "aborted",
      "failed",
      "awaiting_approval",
    ]
    const kinds = new Set<string>()
    for (const p of partVariants) {
      for (const status of statuses) {
        for (const isLast of [true, false]) {
          const view = viewOf(
            p,
            status === "streaming" || status === "submitted"
              ? (status as "streaming" | "submitted")
              : "ready"
          )
          const phase = deriveAssistantTurnPhase(view, { status, isLast })
          const indicator = deriveAssistantTurnIndicator(phase, view)
          kinds.add(indicator.kind)
          expect(["none", "generating", "trigger"]).toContain(indicator.kind)
        }
      }
    }
    expect(kinds.size).toBeGreaterThan(1)
  })
})
