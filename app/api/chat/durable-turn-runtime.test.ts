import { api } from "@/convex/_generated/api"
import * as Sentry from "@sentry/nextjs"
import type { TextStreamPart, ToolSet, UIMessage } from "ai"
import { fetchMutation as moduleFetchMutation } from "convex/nextjs"
import { getFunctionName } from "convex/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createConvexDurableTurn,
  createGuestDurableTurn,
  type DurableTurnInput,
  type DurableWorkerCall,
  type DurableWorkerWire,
  type ToolFacts,
} from "./durable-turn-runtime"

// ---------------------------------------------------------------------------
// Durable turn runtime — the interface IS the test surface (ADR-0009/0011).
// The admission call (`prepareGeneration`) is driven through a recording
// `fetchMutation` fake; every post-prepare write is driven through a recording
// Durable worker wire fake — the ADR-0011 test seam. Behaviors:
//   1. handoff loud-miss, 2. settlement ordering + final full-parts snapshot,
//   3. degraded receipts (settle NEVER rejects), 4. prepare() error mapping +
//   grant minting, 5. guest inertness, 6. fail() at each phase.
// ---------------------------------------------------------------------------

// The module default `fetchMutation` is never used by the Convex adapter (it
// injects deps.fetchMutation) nor the guest adapter (no network) — mock it so
// guest inertness can assert zero calls against the default.
vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
}))

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
}))

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function nameOf(ref: unknown): string {
  try {
    return getFunctionName(ref as Parameters<typeof getFunctionName>[0])
  } catch {
    return "<unknown>"
  }
}

function sameRef(a: unknown, b: unknown): boolean {
  return nameOf(a) === nameOf(b)
}

/** A stored Convex `messages` doc shaped for the durable-prepare return path. */
function makeStoredUserMessage() {
  return {
    _id: "usermsg1",
    _creationTime: 100,
    chatId: "chat_1",
    orderId: 0,
    role: "user",
    content: "What is the weather?",
    parts: [{ type: "text", text: "What is the weather?" }],
    createdAt: 100,
    updatedAt: 200,
    status: "completed",
    metadata: {},
  }
}

type PrepareResult = {
  runId: string
  assistantMessageId: string
  assistantOrder: number
  messages: unknown[]
}

/**
 * A recording fetchMutation for the ONE remaining user-token call: resolves
 * `prepareGeneration` to a run descriptor, lets callers override its outcome.
 */
function makeRecordingFetchMutation(
  overrides: {
    prepareResult?: PrepareResult
    prepareResponder?: (args: unknown) => unknown | Promise<unknown>
  } = {}
) {
  const prepareResult: PrepareResult = overrides.prepareResult ?? {
    runId: "run1",
    assistantMessageId: "msg1",
    assistantOrder: 2,
    messages: [makeStoredUserMessage()],
  }
  return vi.fn(async (ref: unknown, args: unknown, opts?: unknown) => {
    void opts
    if (sameRef(ref, api.chatRuntime.prepareGeneration)) {
      if (overrides.prepareResponder) return overrides.prepareResponder(args)
      return prepareResult
    }
    return undefined
  })
}

type RecordingWire = DurableWorkerWire & {
  calls: DurableWorkerCall[]
}

/**
 * A recording Durable worker wire — the ADR-0011 test seam. Records every
 * `{ op, args }` in order; per-op responders override outcomes.
 */
function makeRecordingWire(
  overrides: {
    responders?: Partial<
      Record<string, (args: Record<string, unknown>) => unknown>
    >
  } = {}
): RecordingWire {
  const calls: DurableWorkerCall[] = []
  const wire = (async (call: DurableWorkerCall) => {
    calls.push(call)
    const responder = overrides.responders?.[call.op]
    if (responder) return responder(call.args)
    return undefined
  }) as RecordingWire
  wire.calls = calls
  return wire
}

function wireCalls(wire: RecordingWire, op: string): DurableWorkerCall[] {
  return wire.calls.filter((call) => call.op === op)
}

function orderedOps(wire: RecordingWire): string[] {
  return wire.calls.map((call) => call.op)
}

function makeInput(overrides: Partial<DurableTurnInput> = {}): DurableTurnInput {
  return {
    chatId: "convexchatid000000000000",
    requestId: "req-1",
    model: "test-model",
    messages: [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ] as UIMessage[],
    isAuthenticated: true,
    convexToken: "tok",
    ...overrides,
  }
}

function makeToolFacts(overrides: Partial<ToolFacts> = {}): ToolFacts {
  return {
    metadata: { source: () => "mcp" },
    approvalFor: (name: string) =>
      name === "send_email"
        ? { needsApproval: true, riskClass: "external_write", reason: "risk" }
        : undefined,
    toolApproval: { send_email: "user-approval" },
    ...overrides,
  }
}

function makeConvexTurn(
  input: DurableTurnInput & { convexToken: string },
  fetchMutation: ReturnType<typeof vi.fn>,
  wire: RecordingWire
) {
  return createConvexDurableTurn({
    input,
    deps: {
      fetchMutation:
        fetchMutation as unknown as typeof import("convex/nextjs").fetchMutation,
      workerWire: wire,
      settleRetryDelaysMs: [0, 0],
    },
  })
}

async function makePreparedTurn(
  options: {
    input?: Partial<DurableTurnInput>
    wire?: RecordingWire
    fetchMutation?: ReturnType<typeof vi.fn>
  } = {}
) {
  const wire = options.wire ?? makeRecordingWire()
  const fetchMutation = options.fetchMutation ?? makeRecordingFetchMutation()
  const turn = makeConvexTurn(
    makeInput(options.input) as DurableTurnInput & { convexToken: string },
    fetchMutation,
    wire
  )
  await turn.prepare({ provider: "anthropic" })
  return { turn, wire, fetchMutation }
}

const RESPONSE_MESSAGE = {
  id: "msg1",
  role: "assistant",
  parts: [{ type: "text", text: "done" }],
  metadata: {},
} as unknown as UIMessage

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("durable turn runtime — handoff loud-miss", () => {
  it("settle without captureFinish warns + Sentry, still completes with countToolParts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const { turn, wire } = await makePreparedTurn()
      const binding = turn.bind(makeToolFacts())

      // No captureFinish() — the missed handoff. The response message carries
      // two tool parts (one errored) so the part-counted fallback yields {2,1}.
      const responseMessage = {
        id: "msg1",
        role: "assistant",
        parts: [
          { type: "text", text: "done" },
          {
            type: "tool-get_weather",
            toolCallId: "c1",
            state: "output-available",
            input: {},
            output: {},
          },
          {
            type: "tool-send_email",
            toolCallId: "c2",
            state: "output-error",
            input: {},
            errorText: "boom",
          },
        ],
        metadata: {},
      } as unknown as UIMessage

      const receipt = await binding.envelope.settle({
        responseMessage,
        isAborted: false,
      })

      const warnLine = warn.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("durable_finish_handoff_missed"))
      expect(warnLine).toBeDefined()
      expect(JSON.parse(warnLine ?? "{}")).toMatchObject({
        _tag: "durable_finish_handoff_missed",
        requestId: "req-1",
        chatId: "convexchatid000000000000",
        runId: "run1",
      })
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "durable_finish_handoff_missed",
        { level: "warning" }
      )

      expect(receipt).toEqual({
        status: "confirmed",
        runId: "run1",
        outcome: "completed",
      })
      const completed = wireCalls(wire, "markGenerationRunCompleted")[0]
      expect(completed.args).toMatchObject({
        runId: "run1",
        messageId: "msg1",
        content: "done",
        totalToolCalls: 2,
        failedToolCalls: 1,
      })
      // No captured usage/finishReason survived the missed handoff.
      expect(completed.args.usage).toBeUndefined()
    } finally {
      warn.mockRestore()
    }
  })
})

describe("durable turn runtime — settlement ordering", () => {
  it("settles approvals → flushes → final full-parts snapshot → completes, awaiting the approval write", async () => {
    const approvalDeferred = createDeferred<undefined>()
    const wire = makeRecordingWire({
      responders: {
        createToolApprovalRequest: () => approvalDeferred.promise,
      },
    })
    const { turn } = await makePreparedTurn({ wire })
    const binding = turn.bind(makeToolFacts())

    // Drive a tool-approval-request chunk through the transform — it pushes a
    // (pending) approval write into the module-private backpressure array and
    // blocks on it before enqueuing the chunk.
    const approvalChunk = {
      type: "tool-approval-request",
      approvalId: "approval-1",
      toolCall: {
        toolCallId: "call-1",
        toolName: "send_email",
        input: { to: "x@example.com" },
      },
    } as unknown as TextStreamPart<ToolSet>
    const stream = new ReadableStream<TextStreamPart<ToolSet>>({
      start(controller) {
        controller.enqueue(approvalChunk)
        controller.close()
      },
    }).pipeThrough(
      binding.streamTextExtras.experimental_transform!({
        tools: {},
        stopStream: () => {},
      } as never)
    )
    const reader = stream.getReader()
    const readPromise = reader.read()
    await flush()

    // Dirty the snapshot: the first delta writes immediately, the throttled
    // second leaves the tracker dirty so the settle flush actually writes.
    binding.stream.onChunk({ type: "text-delta", text: "A" } as never)
    binding.stream.onChunk({ type: "text-delta", text: "B" } as never)
    await flush()

    binding.stream.captureFinish({
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: "stop",
      toolCounts: { totalToolCalls: 1, failedToolCalls: 0 },
    })

    // Settlement must block on the pending approval write before completing.
    const responseMessage = {
      id: "msg1",
      role: "assistant",
      parts: [
        { type: "text", text: "AB" },
        {
          type: "tool-send_email",
          toolCallId: "call-1",
          state: "output-available",
          input: {},
          output: {},
        },
      ],
      metadata: {},
    } as unknown as UIMessage
    let settled = false
    const settlePromise = binding.envelope
      .settle({ responseMessage, isAborted: false, finishReason: "stop" })
      .then((receipt) => {
        settled = true
        return receipt
      })
    await flush()

    expect(settled).toBe(false)
    expect(wireCalls(wire, "markGenerationRunCompleted")).toHaveLength(0)

    approvalDeferred.resolve(undefined)
    await readPromise
    const receipt = await settlePromise
    expect(receipt).toEqual({
      status: "confirmed",
      runId: "run1",
      outcome: "completed",
    })

    // The completion write is last, preceded by the final full-parts snapshot
    // (content survival, ADR-0011); the captured finish facts drive it.
    const ops = orderedOps(wire)
    expect(ops.at(-1)).toBe("markGenerationRunCompleted")
    const lastSnapshot = ops.lastIndexOf("updateAssistantSnapshot")
    const complete = ops.lastIndexOf("markGenerationRunCompleted")
    expect(lastSnapshot).toBeGreaterThanOrEqual(0)
    expect(lastSnapshot).toBeLessThan(complete)

    const finalSnapshot = wireCalls(wire, "updateAssistantSnapshot").at(-1)
    // The final pre-terminal snapshot carries the COMPLETE response parts
    // (tool parts included), not the tracker's text/reasoning subset.
    expect(finalSnapshot?.args).toMatchObject({
      runId: "run1",
      messageId: "msg1",
      textSnapshot: "AB",
      partsSnapshot: responseMessage.parts,
    })

    const completed = wireCalls(wire, "markGenerationRunCompleted")[0]
    expect(completed.args).toMatchObject({
      finishReason: "stop",
      totalToolCalls: 1,
      failedToolCalls: 0,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    })
    expect(Sentry.captureMessage).not.toHaveBeenCalled()
  })

  it("issues both abort writes with distinct reasons when stream onAbort precedes settle (double-terminal, first-terminal-wins)", async () => {
    const { turn, wire } = await makePreparedTurn()
    const binding = turn.bind(makeToolFacts())

    // The stream `onAbort` half flushes + marks aborted ("stream aborted")...
    await binding.stream.onAbort("stream aborted")
    // ...then the envelope half marks aborted again ("ui message stream
    // aborted"). Both fire by design; the Generation run lifecycle's
    // first-terminal-wins absorbs the second, and settle never rejects.
    const receipt = await binding.envelope.settle({
      responseMessage: RESPONSE_MESSAGE,
      isAborted: true,
      finishReason: "stop",
    })
    expect(receipt).toEqual({
      status: "confirmed",
      runId: "run1",
      outcome: "aborted",
    })

    const abortReasons = wireCalls(wire, "markGenerationRunAborted").map(
      (call) => call.args.reason
    )
    expect(abortReasons).toEqual([
      "stream aborted",
      "ui message stream aborted",
    ])
    // The abort path never completes the run.
    expect(wireCalls(wire, "markGenerationRunCompleted")).toHaveLength(0)
  })
})

describe("durable turn runtime — settlement receipts (never rejects)", () => {
  it("resolves a degraded receipt after bounded completion retries, capturing loudly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const wire = makeRecordingWire({
        responders: {
          markGenerationRunCompleted: () => {
            throw new Error("convex unavailable")
          },
        },
      })
      const { turn } = await makePreparedTurn({ wire })
      const binding = turn.bind(makeToolFacts())
      binding.stream.captureFinish({
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: "stop",
        toolCounts: { totalToolCalls: 0, failedToolCalls: 0 },
      })

      const receipt = await binding.envelope.settle({
        responseMessage: RESPONSE_MESSAGE,
        isAborted: false,
        finishReason: "stop",
      })

      // settleRetryDelaysMs [0, 0] → three attempts, then degradation.
      expect(wireCalls(wire, "markGenerationRunCompleted")).toHaveLength(3)
      expect(receipt).toEqual({
        status: "degraded",
        runId: "run1",
        reason: "completion write failed after retries",
      })
      const degradedLine = warn.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("durable_settlement_degraded"))
      expect(degradedLine).toBeDefined()
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "durable_settlement_degraded",
        expect.objectContaining({ level: "error" })
      )
      // The final full-parts snapshot still landed before the failed terminal
      // write — the answer content survives on the message doc.
      expect(wireCalls(wire, "updateAssistantSnapshot")).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })

  it("marks aborted without rejecting even when the abort write keeps failing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const wire = makeRecordingWire({
        responders: {
          markGenerationRunAborted: () => {
            throw new Error("convex unavailable")
          },
        },
      })
      const { turn } = await makePreparedTurn({ wire })
      const binding = turn.bind(makeToolFacts())

      const receipt = await binding.envelope.settle({
        responseMessage: RESPONSE_MESSAGE,
        isAborted: true,
        finishReason: "stop",
      })
      expect(receipt).toEqual({
        status: "degraded",
        runId: "run1",
        reason: "abort write failed",
      })

      const aborted = wireCalls(wire, "markGenerationRunAborted")[0]
      expect(aborted.args).toMatchObject({
        runId: "run1",
        messageId: "msg1",
        reason: "ui message stream aborted",
      })
      expect(wireCalls(wire, "markGenerationRunCompleted")).toHaveLength(0)
      const warnLine = warn.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("durable_run_abort_write_failed"))
      expect(warnLine).toBeDefined()
    } finally {
      warn.mockRestore()
    }
  })
})

describe("durable turn runtime — prepare() error mapping and grant minting", () => {
  it("rejects regeneration that carries pending approval responses (400, no network)", async () => {
    const fetchMutation = makeRecordingFetchMutation()
    const input = makeInput({
      regeneration: {
        targetAssistantMessageId: "a1",
        targetAssistantCreatedAt: 1,
        expectedChatVersion: 3,
        precedingUserMessageId: "u1",
      },
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-send_email",
              toolCallId: "call-1",
              state: "approval-responded",
              input: {},
              approval: { id: "approval-1", approved: false },
            },
          ],
        },
      ] as unknown as UIMessage[],
    }) as DurableTurnInput & { convexToken: string }
    const turn = makeConvexTurn(input, fetchMutation, makeRecordingWire())

    await expect(turn.prepare({ provider: "anthropic" })).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_REQUEST",
    })
    expect(fetchMutation).not.toHaveBeenCalled()
  })

  it("maps a Convex argument-validation rejection to 400 after warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const fetchMutation = makeRecordingFetchMutation({
        prepareResponder: () => {
          throw new Error("ArgumentValidationError: bad id")
        },
      })
      const turn = makeConvexTurn(
        makeInput() as DurableTurnInput & { convexToken: string },
        fetchMutation,
        makeRecordingWire()
      )

      await expect(
        turn.prepare({ provider: "anthropic" })
      ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_REQUEST" })
      const warnLine = warn.mock.calls
        .map(([message]) => String(message))
        .find((message) =>
          message.includes("durable_prepare_argument_rejected")
        )
      expect(warnLine).toBeDefined()
    } finally {
      warn.mockRestore()
    }
  })

  it("passes a concurrency-guard rejection through untouched (no 400 remap)", async () => {
    const guardError = new Error("expectedVisibleMessageCount mismatch")
    const fetchMutation = makeRecordingFetchMutation({
      prepareResponder: () => {
        throw guardError
      },
    })
    const turn = makeConvexTurn(
      makeInput() as DurableTurnInput & { convexToken: string },
      fetchMutation,
      makeRecordingWire()
    )

    const thrown = await turn.prepare({ provider: "anthropic" }).then(
      () => null,
      (error) => error
    )
    expect(thrown).toBe(guardError)
    expect((thrown as { statusCode?: number }).statusCode).toBeUndefined()
  })

  it("forwards the selected-path-token + edit guard args verbatim and mints the grant digest", async () => {
    const fetchMutation = makeRecordingFetchMutation()
    const edit = {
      editedMessageId: "m9",
      editCutoffTimestamp: 123,
      expectedChatVersion: 7,
      replacementMessage: {
        id: "m9",
        role: "user" as const,
        content: "edited",
        parts: [{ type: "text", text: "edited" }] as UIMessage["parts"],
      },
    }
    const turn = makeConvexTurn(
      makeInput({
        expectedVisibleMessageCount: 42,
        tailMessageId: "tail-xyz",
        edit,
      }) as DurableTurnInput & { convexToken: string },
      fetchMutation,
      makeRecordingWire()
    )

    await turn.prepare({ provider: "anthropic" })

    const prepareCall = fetchMutation.mock.calls.find((call) =>
      sameRef(call[0], api.chatRuntime.prepareGeneration)
    )
    const prepareArgs = prepareCall?.[1] as Record<string, unknown>
    expect(prepareArgs.expectedVisibleMessageCount).toBe(42)
    expect(prepareArgs.tailMessageId).toBe("tail-xyz")
    expect(prepareArgs.edit).toBe(edit)
    expect(prepareArgs.provider).toBe("anthropic")
    // An edit turn never re-sends the latest client user message.
    expect(prepareArgs.latestUserMessage).toBeUndefined()
    // The execution grant digest rides the admission call (ADR-0011): a
    // 64-hex SHA-256 — never the raw secret (which is 64 hex of entropy too,
    // but the digest is deterministic given the secret; assert shape only).
    expect(prepareArgs.grantDigest).toMatch(/^[0-9a-f]{64}$/)
    // The user token authorizes the admission call and nothing after it.
    expect(prepareCall?.[2]).toEqual({ token: "tok" })
  })
})

describe("durable turn runtime — guest inertness", () => {
  it("drives the full lifecycle with zero network and identity passthrough", async () => {
    const guest = createGuestDurableTurn(
      makeInput({
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
        ] as UIMessage[],
      })
    )

    expect(guest.mode).toBe("guest")

    const canonical = await guest.prepare({ provider: "anthropic" })
    expect(canonical).toHaveLength(1)
    expect(canonical[0]?.id).toBe("u1")

    const binding = guest.bind(makeToolFacts())
    expect(binding.streamTextExtras).toEqual({})

    const validated = [
      { id: "v1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ] as UIMessage[]
    const identity = binding.envelope.identity(validated)
    expect(identity.originalMessages).toBe(validated)
    expect(identity.generateMessageId).toBeUndefined()

    // Every write method is an inert no-op; settle resolves the guest receipt.
    binding.stream.onChunk({ type: "text-delta", text: "A" } as never)
    binding.stream.recordStep({
      stepNumber: 1,
      toolCalls: [{ toolCallId: "c", toolName: "t", input: {} }],
      toolResults: [],
    })
    binding.stream.noteStreamError("boom")
    binding.stream.captureFinish({
      usage: {},
      finishReason: "stop",
      toolCounts: { totalToolCalls: 0, failedToolCalls: 0 },
    })
    await expect(binding.stream.onAbort("stream aborted")).resolves.toBeUndefined()
    await expect(
      binding.envelope.settle({
        responseMessage: {
          id: "v1",
          role: "assistant",
          parts: [],
          metadata: {},
        } as unknown as UIMessage,
        isAborted: false,
        finishReason: "stop",
      })
    ).resolves.toEqual({ status: "guest" })
    await expect(guest.fail("nope")).resolves.toBeUndefined()

    expect(moduleFetchMutation).not.toHaveBeenCalled()
  })
})

describe("durable turn runtime — fail() at each phase", () => {
  it("is a no-op before prepare() (no run exists)", async () => {
    const wire = makeRecordingWire()
    const fetchMutation = makeRecordingFetchMutation()
    const turn = makeConvexTurn(
      makeInput() as DurableTurnInput & { convexToken: string },
      fetchMutation,
      wire
    )
    await expect(turn.fail("early")).resolves.toBeUndefined()
    expect(fetchMutation).not.toHaveBeenCalled()
    expect(wire.calls).toHaveLength(0)
  })

  it("marks the run failed over the worker wire after prepare(), with the assistant message id", async () => {
    const { turn, wire } = await makePreparedTurn()
    await turn.fail("provider exploded")

    const failed = wireCalls(wire, "markGenerationRunFailed")[0]
    expect(failed.args).toMatchObject({
      runId: "run1",
      messageId: "msg1",
      error: "provider exploded",
    })
  })

  it("warns and resolves when the failure write itself rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const wire = makeRecordingWire({
        responders: {
          markGenerationRunFailed: () => {
            throw new Error("convex unavailable")
          },
        },
      })
      const { turn } = await makePreparedTurn({ wire })

      await expect(turn.fail("boom")).resolves.toBeUndefined()
      const warnLine = warn.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("durable_run_failed_write_failed"))
      expect(warnLine).toBeDefined()
    } finally {
      warn.mockRestore()
    }
  })
})
