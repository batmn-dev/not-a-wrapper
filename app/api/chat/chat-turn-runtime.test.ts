import { api } from "@/convex/_generated/api"
import { getAllModels } from "@/lib/models"
import { prepareToolRuntime } from "@/lib/tools/runtime"
import { getEffectiveProviderApiKey } from "@/lib/user-keys"
import * as Sentry from "@sentry/nextjs"
import {
  convertToModelMessages,
  toUIMessageStream,
  validateUIMessages,
} from "ai"
import { getFunctionName } from "convex/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { adaptHistoryForProvider } from "./adapters"
import {
  createChatTurnRuntime,
  type ChatTurnDeps,
  type ChatTurnInput,
} from "./chat-turn-runtime"
import type {
  DurableWorkerCall,
  DurableWorkerWire,
} from "./durable-turn-runtime"
import { prepareTextFilePartsForModelInput } from "./text-file-parts"

// --- mock the heavy collaborators so a whole turn runs without HTTP or a model.
// The Chat turn runtime's interface IS the test surface: inject streamText +
// fetchMutation and drive the stream callbacks directly.

vi.mock("@sentry/nextjs", () => ({
  setTag: vi.fn(),
  setContext: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
}))

vi.mock("@/lib/models", () => ({
  getAllModels: vi.fn(),
}))

vi.mock("@/lib/openproviders/provider-map", () => ({
  getProviderForModel: vi.fn(() => "anthropic"),
}))

vi.mock("@/lib/openproviders/create-language-model", () => ({
  createLanguageModel: vi.fn(() => ({})),
}))

vi.mock("@/lib/openproviders/request-shaping", () => ({
  shapeRequest: vi.fn(() => ({ providerOptions: {}, headers: {} })),
}))

vi.mock("@/lib/openproviders/env", () => ({ env: {} }))

vi.mock("@/lib/user-keys", () => ({
  getEffectiveProviderApiKey: vi.fn(),
}))

vi.mock("@/lib/tools/runtime", () => ({
  prepareToolRuntime: vi.fn(),
}))

vi.mock("./adapters", () => ({
  adaptHistoryForProvider: vi.fn(),
}))

vi.mock("./text-file-parts", () => ({
  getTextFilePartReferences: vi.fn(() => []),
  prepareTextFilePartsForModelInput: vi.fn(),
}))

vi.mock("@/lib/observability/braintrust", () => ({
  getBraintrustStreamText: vi.fn(),
  withBraintrustTrace: vi.fn((_opts: unknown, cb: (span: null) => unknown) =>
    cb(null)
  ),
  hashBraintrustIdentifier: vi.fn(async () => "hash"),
  logBraintrustTraceMetadata: vi.fn(),
  getBraintrustErrorMetadata: vi.fn(() => ({})),
  flushBraintrust: vi.fn(async () => {}),
}))

vi.mock("@/lib/posthog", () => ({
  captureGeneration: vi.fn(),
  flushPostHog: vi.fn(async () => {}),
  getPostHogClient: vi.fn(() => null),
}))

vi.mock("@/lib/posthog/scrub", () => ({
  scrubForAnalytics: vi.fn((x: unknown) => x),
}))

vi.mock("@/convex/lib/messageMetadata", () => ({
  projectPersistedMessageMetadata: vi.fn((m: unknown) => m ?? {}),
}))

vi.mock("ai", async (importActual) => {
  const actual = await importActual<typeof import("ai")>()
  return {
    ...actual,
    validateUIMessages: vi.fn(
      async ({ messages }: { messages: unknown[] }) => messages
    ),
    convertToModelMessages: vi.fn(async () => []),
    toUIMessageStream: vi.fn(actual.toUIMessageStream),
  }
})

const SERVER_CHAT_ID = "convexchatid000000000000"

function makeToolRuntime(overrides: Record<string, unknown> = {}) {
  return {
    tools: {},
    hasTools: false,
    metadata: {
      toInvocationMetadataByName: () => ({}),
      source: () => "mcp",
    },
    policySummary: {
      capabilities: {
        search: false,
        extract: false,
        code: false,
        mcp: false,
        platform: false,
      },
      capabilityReasons: {},
      userTier: "free",
      keyMode: undefined,
      keyModeReason: "none",
      totalTools: 0,
      earlyAllowedCount: 0,
      lateAllowedCount: 0,
      searchInjected: false,
    },
    toolCounts: { builtIn: 0, thirdParty: 0, content: 0, mcp: 0, total: 0 },
    mcpServerCount: 0,
    mcpClientCount: 0,
    approvalDecisionsByToolName: new Map(),
    approvalFor: () => undefined,
    toolApproval: undefined,
    prepareStep: undefined,
    onStepFinish: vi.fn(async () => {}),
    outcomeSummary: () => ({
      totalToolCalls: 0,
      failedToolCalls: 0,
      timeoutToolCalls: 0,
      budgetDeniedToolCalls: 0,
    }),
    dispose: vi.fn(async () => {}),
    ...overrides,
  }
}

function makeInput(overrides: Partial<ChatTurnInput> = {}): ChatTurnInput {
  return {
    messages: [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
    ] as ChatTurnInput["messages"],
    chatId: SERVER_CHAT_ID,
    model: "test-model",
    systemPrompt: "sys",
    enableSearch: false,
    chatVersion: 1,
    requestId: "req-1",
    userId: "user-1",
    anonymousId: undefined,
    isAuthenticated: true,
    convexToken: "tok",
    ...overrides,
  }
}

type StreamHarness = {
  streamText: ReturnType<typeof vi.fn>
  captured: { streamOpts?: any; responseOpts?: any }
}

function makeStreamHarness(): StreamHarness {
  const captured: { streamOpts?: any; responseOpts?: any } = {}
  vi.mocked(toUIMessageStream).mockImplementation((responseOpts: any) => {
    captured.responseOpts = responseOpts
    return new ReadableStream({
      start(controller) {
        controller.close()
      },
    })
  })
  const streamText = vi.fn((opts: any) => {
    captured.streamOpts = opts
    return {
      // The runtime passes this raw model stream to the standalone UI-message
      // converter above, then builds the Response through the real
      // createUIMessageStreamResponse. The converter's inert stream keeps the
      // HTTP envelope side-effect free while exposing its lifecycle options.
      stream: new ReadableStream(),
    }
  })
  return { streamText, captured }
}

// Convex's generated `api` is a proxy, so function references are not
// identity-stable across reads — match by stable function name instead.
function sameRef(a: unknown, b: unknown): boolean {
  try {
    return (
      getFunctionName(a as Parameters<typeof getFunctionName>[0]) ===
      getFunctionName(b as Parameters<typeof getFunctionName>[0])
    )
  } catch {
    return false
  }
}

function makeFetchMutation() {
  return vi.fn(async (ref: unknown) => {
    if (sameRef(ref, api.chatRuntime.prepareGeneration)) {
      return {
        runId: "run1",
        assistantMessageId: "msg1",
        assistantOrder: 1,
        messages: [],
      }
    }
    return undefined
  })
}

function findCall(fetchMutation: ReturnType<typeof vi.fn>, ref: unknown) {
  return fetchMutation.mock.calls.find((call) => sameRef(call[0], ref))
}

// Post-prepare durable writes travel the Durable worker wire (ADR-0011), not
// fetchMutation — the recording wire is their test seam.
type RecordingWire = DurableWorkerWire & { calls: DurableWorkerCall[] }

function makeWorkerWire(
  responders: Partial<
    Record<string, (args: Record<string, unknown>) => unknown>
  > = {}
): RecordingWire {
  const calls: DurableWorkerCall[] = []
  const wire = (async (call: DurableWorkerCall) => {
    calls.push(call)
    const responder = responders[call.op]
    if (responder) return responder(call.args)
    return undefined
  }) as RecordingWire
  wire.calls = calls
  return wire
}

function wireCall<Op extends DurableWorkerCall["op"]>(
  wire: RecordingWire,
  op: Op
) {
  return wire.calls.find(
    (call): call is Extract<DurableWorkerCall, { op: Op }> => call.op === op
  )
}

function makeDeps(
  harness: StreamHarness,
  fetchMutation: ReturnType<typeof vi.fn>,
  overrides: Partial<ChatTurnDeps> = {}
) {
  return {
    streamText: harness.streamText as unknown as ChatTurnDeps["streamText"],
    fetchMutation: fetchMutation as unknown as ChatTurnDeps["fetchMutation"],
    fetchQuery: vi.fn(async () => []) as unknown as ChatTurnDeps["fetchQuery"],
    after: vi.fn() as unknown as ChatTurnDeps["after"],
    getPostHogClient: (() =>
      null) as unknown as ChatTurnDeps["getPostHogClient"],
    durableWorkerWire: makeWorkerWire(),
    durableSettleRetryDelaysMs: [0],
    ...overrides,
  }
}

function notAbortedSignal(): AbortSignal {
  // A REAL signal: toResponse composes it via AbortSignal.any (worker-loss +
  // provider-deadline), which rejects plain-object fakes.
  return new AbortController().signal
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAllModels).mockResolvedValue([
    { id: "test-model", provider: "anthropic", tools: false },
  ] as unknown as Awaited<ReturnType<typeof getAllModels>>)
  vi.mocked(getEffectiveProviderApiKey).mockResolvedValue({
    apiKey: "byok-key",
    source: "byok",
  })
  vi.mocked(prepareToolRuntime).mockResolvedValue(
    makeToolRuntime() as unknown as Awaited<
      ReturnType<typeof prepareToolRuntime>
    >
  )
  vi.mocked(adaptHistoryForProvider).mockResolvedValue({
    messages: [],
    stats: {
      originalMessageCount: 0,
      adaptedMessageCount: 0,
      droppedMessages: 0,
      partsDropped: {},
      partsTransformed: {},
      partsPreserved: {},
      totalPartsOriginal: 0,
      totalPartsAdapted: 0,
      providerIdsStripped: 0,
    },
    warnings: [],
  })
  vi.mocked(prepareTextFilePartsForModelInput).mockResolvedValue({
    messages: [],
    convertedCount: 0,
    failedCount: 0,
    truncatedCount: 0,
    skippedCount: 0,
  } as unknown as Awaited<ReturnType<typeof prepareTextFilePartsForModelInput>>)
})

describe("createChatTurnRuntime — prepare()", () => {
  it("throws a 401 MISSING_API_KEY when neither a BYOK nor an env key exists", async () => {
    vi.mocked(getEffectiveProviderApiKey).mockResolvedValue({})
    const harness = makeStreamHarness()
    const fetchMutation = makeFetchMutation()
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(harness, fetchMutation),
    })

    await expect(runtime.prepare()).rejects.toMatchObject({
      statusCode: 401,
      code: "MISSING_API_KEY",
    })
  })

  it("passes authoritative platform key provenance to the Tool runtime", async () => {
    vi.mocked(getEffectiveProviderApiKey).mockResolvedValue({
      apiKey: "platform-key",
      source: "platform",
    })
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(makeStreamHarness(), makeFetchMutation()),
    })

    await runtime.prepare()

    expect(prepareToolRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ providerToolKeyMode: "platform" })
    )
  })

  it("throws a 400 INVALID_REQUEST error when the model is unknown", async () => {
    vi.mocked(getAllModels).mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof getAllModels>>
    )
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(makeStreamHarness(), makeFetchMutation()),
    })

    const error = await runtime.prepare().then(
      () => null,
      (e) => e
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("not found")
    expect(error).toMatchObject({
      statusCode: 400,
      code: "INVALID_REQUEST",
    })
  })

  it("validates UI messages before converting them to model messages", async () => {
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(makeStreamHarness(), makeFetchMutation()),
    })
    await runtime.prepare()

    const validateOrder =
      vi.mocked(validateUIMessages).mock.invocationCallOrder[0]
    const convertOrder = vi.mocked(convertToModelMessages).mock
      .invocationCallOrder[0]
    expect(validateOrder).toBeGreaterThan(0)
    expect(convertOrder).toBeGreaterThan(0)
    expect(validateOrder).toBeLessThan(convertOrder)
  })

  it("rejects a second prepare() — the runtime is one-shot", async () => {
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(makeStreamHarness(), makeFetchMutation()),
    })
    await runtime.prepare()
    await expect(runtime.prepare()).rejects.toThrow("only be called once")
  })
})

describe("createChatTurnRuntime — durable completion handoff", () => {
  it("completes with durableFinal tool counts from streamText onEnd, not the countToolParts fallback", async () => {
    const harness = makeStreamHarness()
    const fetchMutation = makeFetchMutation()
    const wire = makeWorkerWire()
    // Two tool calls, one failed — the streamText onEnd freezes these into
    // durableFinal*. The response message carries NO tool parts, so the
    // countToolParts fallback would yield {0,0}; seeing {2,1} on the completion
    // write proves the cross-callback handoff is intact.
    vi.mocked(prepareToolRuntime).mockResolvedValue(
      makeToolRuntime({
        outcomeSummary: () => ({
          totalToolCalls: 2,
          failedToolCalls: 1,
          timeoutToolCalls: 0,
          budgetDeniedToolCalls: 0,
        }),
        toolApproval: { risky_tool: "user-approval" },
      }) as unknown as Awaited<ReturnType<typeof prepareToolRuntime>>
    )
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(harness, fetchMutation, { durableWorkerWire: wire }),
    })

    await runtime.prepare()
    runtime.toResponse(notAbortedSignal())

    // Durable run: the Tool runtime's call-site approval config reaches
    // streamText (guest runs omit it — the spread is durable-gated).
    expect(harness.captured.streamOpts.toolApproval).toEqual({
      risky_tool: "user-approval",
    })

    // Writer: streamText onEnd freezes durableFinal*.
    await harness.captured.streamOpts.onEnd({
      text: "final answer",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      steps: [],
      finishReason: "stop",
    })
    // Reader: the response-level onEnd performs markGenerationRunCompleted.
    await harness.captured.responseOpts.onEnd({
      responseMessage: {
        id: "msg1",
        role: "assistant",
        parts: [{ type: "text", text: "final answer" }],
        metadata: {},
      },
      isAborted: false,
      finishReason: "stop",
    })

    const completed = wireCall(wire, "markGenerationRunCompleted")
    expect(completed).toBeDefined()
    expect(completed!.args).toMatchObject({
      runId: "run1",
      messageId: "msg1",
      content: "final answer",
      finishReason: "stop",
      totalToolCalls: 2,
      failedToolCalls: 1,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    })
    // The user token authorizes admission only; no completion via fetchMutation.
    expect(
      findCall(fetchMutation, api.chatRuntime.markGenerationRunCompleted)
    ).toBeUndefined()
  })

  it("marks the run aborted (not completed) when the response stream is aborted", async () => {
    const harness = makeStreamHarness()
    const fetchMutation = makeFetchMutation()
    const wire = makeWorkerWire()
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(harness, fetchMutation, { durableWorkerWire: wire }),
    })

    await runtime.prepare()
    runtime.toResponse(notAbortedSignal())

    await harness.captured.responseOpts.onEnd({
      responseMessage: {
        id: "msg1",
        role: "assistant",
        parts: [],
        metadata: {},
      },
      isAborted: true,
      finishReason: "stop",
    })

    const aborted = wireCall(wire, "markGenerationRunAborted")
    expect(aborted).toBeDefined()
    expect(aborted!.args).toMatchObject({
      runId: "run1",
      messageId: "msg1",
      reason: "ui message stream aborted",
    })
    expect(wireCall(wire, "markGenerationRunCompleted")).toBeUndefined()
  })

  it("does not reject stream abort cleanup when the abort write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const harness = makeStreamHarness()
      const wire = makeWorkerWire({
        markGenerationRunAborted: () => {
          throw new Error("convex unavailable")
        },
      })
      const runtime = createChatTurnRuntime({
        input: makeInput(),
        deps: makeDeps(harness, makeFetchMutation(), {
          durableWorkerWire: wire,
        }),
      })

      await runtime.prepare()
      runtime.toResponse(notAbortedSignal())

      await expect(
        harness.captured.streamOpts.onAbort()
      ).resolves.toBeUndefined()

      const aborted = wireCall(wire, "markGenerationRunAborted")
      expect(aborted?.args).toMatchObject({
        runId: "run1",
        messageId: "msg1",
        reason: "stream aborted",
      })

      const logLine = warn.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("durable_run_abort_write_failed"))
      expect(logLine).toBeDefined()
      expect(JSON.parse(logLine ?? "{}")).toMatchObject({
        _tag: "durable_run_abort_write_failed",
        requestId: "req-1",
        chatId: SERVER_CHAT_ID,
        runId: "run1",
        error: "convex unavailable",
      })
    } finally {
      warn.mockRestore()
    }
  })

  it("fail() persists one context-normalized error with the assistant message", async () => {
    // The route's outer catch path: a post-prepare error must reach
    // markGenerationRunFailed with the run AND its placeholder message id —
    // the durable layer keeps that placeholder as the turn's visible failed
    // stub, so losing the id here would orphan the turn again.
    const harness = makeStreamHarness()
    const wire = makeWorkerWire()
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(harness, makeFetchMutation(), {
        durableWorkerWire: wire,
      }),
    })

    await runtime.prepare()
    const error = new Error("402 payment required")
    error.stack = `${error.stack}\n    at googleTransport (server.js:1:1)`
    await runtime.fail(error)

    const failed = wireCall(wire, "markGenerationRunFailed")
    expect(failed?.args).toMatchObject({
      runId: "run1",
      messageId: "msg1",
      error:
        "Your Anthropic API account has insufficient credits or requires payment. Check Anthropic billing or update your API key in settings.",
    })
  })
})

describe("createChatTurnRuntime — reasoning lifecycle timing", () => {
  it("persists the union of explicit reasoning intervals and ignores deltas as starts", async () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(0)
    try {
      const harness = makeStreamHarness()
      const runtime = createChatTurnRuntime({
        input: makeInput(),
        deps: makeDeps(harness, makeFetchMutation()),
      })

      await runtime.prepare()
      runtime.toResponse(notAbortedSignal())

      dateNow.mockReturnValue(50)
      harness.captured.streamOpts.onChunk({
        chunk: { type: "reasoning-delta", id: "metadata-only", delta: "" },
      })

      dateNow.mockReturnValue(100)
      harness.captured.streamOpts.onChunk({
        chunk: { type: "reasoning-start", id: "a" },
      })
      dateNow.mockReturnValue(200)
      harness.captured.streamOpts.onChunk({
        chunk: { type: "reasoning-start", id: "b" },
      })
      dateNow.mockReturnValue(300)
      harness.captured.streamOpts.onChunk({
        chunk: { type: "reasoning-end", id: "a" },
      })
      dateNow.mockReturnValue(500)
      harness.captured.streamOpts.onChunk({
        chunk: { type: "reasoning-end", id: "b" },
      })
      dateNow.mockReturnValue(700)
      harness.captured.streamOpts.onChunk({
        chunk: { type: "reasoning-start", id: "c" },
      })
      dateNow.mockReturnValue(900)
      await harness.captured.streamOpts.onEnd({
        text: "done",
        usage: {},
        steps: [],
        finishReason: "stop",
      })

      expect(
        harness.captured.responseOpts.messageMetadata({
          part: { type: "finish" },
        })
      ).toMatchObject({ reasoningDurationMs: 600 })
    } finally {
      dateNow.mockRestore()
    }
  })
})

describe("createChatTurnRuntime — Anthropic pause_turn telemetry", () => {
  it("captures one content-free event with model and search dimensions", async () => {
    const harness = makeStreamHarness()
    const fetchMutation = makeFetchMutation()
    const wire = makeWorkerWire()
    const capture = vi.fn()
    const toolRuntime = makeToolRuntime()
    toolRuntime.policySummary.searchInjected = true
    vi.mocked(prepareToolRuntime).mockResolvedValue(
      toolRuntime as unknown as Awaited<ReturnType<typeof prepareToolRuntime>>
    )
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(harness, fetchMutation, {
        durableWorkerWire: wire,
        getPostHogClient: (() =>
          ({ capture })) as unknown as ChatTurnDeps["getPostHogClient"],
      }),
    })

    await runtime.prepare()
    runtime.toResponse(notAbortedSignal())
    await harness.captured.streamOpts.onEnd({
      text: "private generated content",
      usage: {},
      steps: [{ rawFinishReason: "pause_turn", toolCalls: [] }],
      finishReason: "stop",
    })
    await harness.captured.responseOpts.onEnd({
      responseMessage: {
        id: "msg1",
        role: "assistant",
        parts: [{ type: "text", text: "private generated content" }],
        metadata: {},
      },
      isAborted: false,
      finishReason: "stop",
    })

    const pauseTurnEvents = capture.mock.calls.filter(
      ([event]) => event.event === "anthropic_pause_turn"
    )
    expect(pauseTurnEvents).toEqual([
      [
        {
          distinctId: "chat-runtime",
          event: "anthropic_pause_turn",
          properties: {
            provider: "anthropic",
            model: "test-model",
            searchToolsActive: true,
          },
        },
      ],
    ])
    expect(wireCall(wire, "markGenerationRunCompleted")?.args).toMatchObject({
      runId: "run1",
      messageId: "msg1",
      finishReason: "stop",
    })
    expect(wireCall(wire, "markGenerationRunAborted")).toBeUndefined()
    expect(wireCall(wire, "markGenerationRunFailed")).toBeUndefined()
  })

  it("does not let a telemetry capture failure break stream completion", async () => {
    const harness = makeStreamHarness()
    const captureError = new Error("analytics unavailable")
    const capture = vi.fn((event: { event: string }) => {
      if (event.event === "anthropic_pause_turn") {
        throw captureError
      }
    })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const runtime = createChatTurnRuntime({
        input: makeInput(),
        deps: makeDeps(harness, makeFetchMutation(), {
          getPostHogClient: (() =>
            ({ capture })) as unknown as ChatTurnDeps["getPostHogClient"],
        }),
      })

      await runtime.prepare()
      runtime.toResponse(notAbortedSignal())

      await expect(
        harness.captured.streamOpts.onEnd({
          text: "done",
          usage: {},
          steps: [{ rawFinishReason: "pause_turn", toolCalls: [] }],
          finishReason: "stop",
        })
      ).resolves.toBeUndefined()
      expect(consoleError).toHaveBeenCalledWith(
        "[PostHog] Failed to capture anthropic_pause_turn event:",
        captureError
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe("createChatTurnRuntime — abort telemetry", () => {
  it("excludes the request signal from a DURABLE turn's execution signal — a client disconnect leaves the worker streaming", async () => {
    const harness = makeStreamHarness()
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(harness, makeFetchMutation()),
    })

    await runtime.prepare()
    const controller = new AbortController()
    runtime.toResponse(controller.signal)

    // Reload/disconnect durability (gameplan §12 scenario 9, §14 "Reload
    // mid-text → same run ID"): the request abort is telemetry only; Stop and
    // supersession reach the worker via heartbeat `lost`/grant rejection.
    const executionSignal = harness.captured.streamOpts
      .abortSignal as AbortSignal
    expect(executionSignal.aborted).toBe(false)
    controller.abort()
    expect(executionSignal.aborted).toBe(false)
  })

  it("keeps the request signal authoritative for GUEST turns", async () => {
    const harness = makeStreamHarness()
    const runtime = createChatTurnRuntime({
      input: makeInput({ isAuthenticated: false, convexToken: undefined }),
      deps: makeDeps(harness, makeFetchMutation()),
    })

    await runtime.prepare()
    const controller = new AbortController()
    runtime.toResponse(controller.signal)

    // Nobody is left to receive or settle a disconnected guest stream — the
    // request signal IS the guest lifecycle.
    const executionSignal = harness.captured.streamOpts
      .abortSignal as AbortSignal
    expect(executionSignal.aborted).toBe(false)
    controller.abort()
    expect(executionSignal.aborted).toBe(true)
  })

  it("captures chat_client_abort exactly once when the request is already aborted", async () => {
    const harness = makeStreamHarness()
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(harness, makeFetchMutation()),
    })

    await runtime.prepare()
    const abortedController = new AbortController()
    abortedController.abort()
    runtime.toResponse(abortedController.signal)

    // Stream then completes — the streamCompleted/abortCaptured guards must
    // prevent any second chat_client_abort capture.
    await harness.captured.streamOpts.onEnd({
      text: "",
      usage: undefined,
      steps: [],
      finishReason: "stop",
    })

    const clientAborts = vi
      .mocked(Sentry.captureMessage)
      .mock.calls.filter((call) => call[0] === "chat_client_abort")
    expect(clientAborts).toHaveLength(1)
  })

  it("rejects toResponse() before prepare() — phase guard", () => {
    const runtime = createChatTurnRuntime({
      input: makeInput(),
      deps: makeDeps(makeStreamHarness(), makeFetchMutation()),
    })
    expect(() => runtime.toResponse(notAbortedSignal())).toThrow(
      "requires a completed prepare()"
    )
  })
})
