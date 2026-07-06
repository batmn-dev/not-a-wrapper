import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import * as Sentry from "@sentry/nextjs"
import type { TextStreamPart, ToolSet, UIMessage } from "ai"
import { fetchMutation as moduleFetchMutation } from "convex/nextjs"
import { getFunctionName } from "convex/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createConvexDurableTurn,
  createGuestDurableTurn,
  type DurableTurnInput,
  type ToolFacts,
} from "./durable-turn-runtime"

// ---------------------------------------------------------------------------
// Durable turn runtime — the interface IS the test surface (ADR-0009). Five
// lean behaviors driven through the public methods with a recording
// `fetchMutation` fake (functions identified by getFunctionName, since the
// generated `api` proxy is not identity-stable across reads):
//   1. handoff loud-miss, 2. terminal ordering, 3. prepare() error mapping,
//   4. guest inertness, 5. fail() at each phase.
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
 * A recording fetchMutation: resolves `prepareGeneration` to a run descriptor,
 * lets callers override any function's outcome (value, thrown error, or a
 * pending promise), and records every `(ref, args, opts)` tuple in call order.
 */
function makeRecordingFetchMutation(
  overrides: {
    prepareResult?: PrepareResult
    responders?: Partial<
      Record<string, (args: unknown) => unknown | Promise<unknown>>
    >
  } = {}
) {
  const prepareResult: PrepareResult = overrides.prepareResult ?? {
    runId: "run1",
    assistantMessageId: "msg1",
    assistantOrder: 2,
    messages: [makeStoredUserMessage()],
  }
  return vi.fn(async (ref: unknown, args: unknown) => {
    const name = nameOf(ref)
    const responder = overrides.responders?.[name]
    if (responder) return responder(args)
    if (sameRef(ref, api.chatRuntime.prepareGeneration)) return prepareResult
    return undefined
  })
}

function findCalls(fetchMutation: ReturnType<typeof vi.fn>, ref: unknown) {
  return fetchMutation.mock.calls.filter((call) => sameRef(call[0], ref))
}

function orderedNames(fetchMutation: ReturnType<typeof vi.fn>): string[] {
  return fetchMutation.mock.calls.map((call) => nameOf(call[0]))
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
  fetchMutation: ReturnType<typeof vi.fn>
) {
  return createConvexDurableTurn({
    input,
    deps: {
      fetchMutation:
        fetchMutation as unknown as typeof import("convex/nextjs").fetchMutation,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("durable turn runtime — handoff loud-miss", () => {
  it("finalize without captureFinish warns + Sentry, still completes with countToolParts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const fetchMutation = makeRecordingFetchMutation()
      const turn = makeConvexTurn(
        makeInput() as DurableTurnInput & { convexToken: string },
        fetchMutation
      )
      await turn.prepare({ provider: "anthropic" })

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

      await turn.finalize({ responseMessage, isAborted: false })

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

      const completed = findCalls(
        fetchMutation,
        api.chatRuntime.markGenerationRunCompleted
      )[0]
      expect(completed[1]).toMatchObject({
        runId: "run1",
        messageId: "msg1",
        content: "done",
        totalToolCalls: 2,
        failedToolCalls: 1,
      })
      // No captured usage/finishReason survived the missed handoff.
      expect((completed[1] as { usage?: unknown }).usage).toBeUndefined()
    } finally {
      warn.mockRestore()
    }
  })
})

describe("durable turn runtime — terminal ordering", () => {
  it("settles approvals → flushes snapshot → completes, awaiting the approval write", async () => {
    const approvalDeferred = createDeferred<undefined>()
    const fetchMutation = makeRecordingFetchMutation({
      responders: {
        [nameOf(api.chatRuntime.createToolApprovalRequest)]: () =>
          approvalDeferred.promise,
      },
    })
    const turn = makeConvexTurn(
      makeInput() as DurableTurnInput & { convexToken: string },
      fetchMutation
    )
    await turn.prepare({ provider: "anthropic" })

    const extras = turn.streamTextExtras(makeToolFacts())
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
      extras.experimental_transform!({
        tools: {},
        stopStream: () => {},
      } as never)
    )
    const reader = stream.getReader()
    const readPromise = reader.read()
    await flush()

    // Dirty the snapshot: the first delta writes immediately, the throttled
    // second leaves the tracker dirty so the finalize flush actually writes.
    turn.onChunk({ type: "text-delta", text: "A" } as never)
    turn.onChunk({ type: "text-delta", text: "B" } as never)
    await flush()

    turn.captureFinish({
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: "stop",
      toolCounts: { totalToolCalls: 1, failedToolCalls: 0 },
    })

    // Finalize must block on the pending approval write before completing.
    let finalized = false
    const finalizePromise = turn
      .finalize({
        responseMessage: {
          id: "msg1",
          role: "assistant",
          parts: [{ type: "text", text: "AB" }],
          metadata: {},
        } as unknown as UIMessage,
        isAborted: false,
        finishReason: "stop",
      })
      .then(() => {
        finalized = true
      })
    await flush()

    expect(finalized).toBe(false)
    expect(
      findCalls(fetchMutation, api.chatRuntime.markGenerationRunCompleted)
    ).toHaveLength(0)

    approvalDeferred.resolve(undefined)
    await readPromise
    await finalizePromise
    expect(finalized).toBe(true)

    // The completion write is last, preceded by a snapshot flush; the captured
    // finish facts (not the part-count fallback) drive it.
    const names = orderedNames(fetchMutation)
    expect(names.at(-1)).toBe(
      nameOf(api.chatRuntime.markGenerationRunCompleted)
    )
    const lastSnapshot = names.lastIndexOf(
      nameOf(api.chatRuntime.updateAssistantSnapshot)
    )
    const complete = names.lastIndexOf(
      nameOf(api.chatRuntime.markGenerationRunCompleted)
    )
    expect(lastSnapshot).toBeGreaterThanOrEqual(0)
    expect(lastSnapshot).toBeLessThan(complete)
    const completed = findCalls(
      fetchMutation,
      api.chatRuntime.markGenerationRunCompleted
    )[0]
    expect(completed[1]).toMatchObject({
      finishReason: "stop",
      totalToolCalls: 1,
      failedToolCalls: 0,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    })
    expect(Sentry.captureMessage).not.toHaveBeenCalled()
  })

  it("marks aborted (never rejecting) on the isAborted variant, even if the write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const fetchMutation = makeRecordingFetchMutation({
        responders: {
          [nameOf(api.chatRuntime.markGenerationRunAborted)]: () => {
            throw new Error("convex unavailable")
          },
        },
      })
      const turn = makeConvexTurn(
        makeInput() as DurableTurnInput & { convexToken: string },
        fetchMutation
      )
      await turn.prepare({ provider: "anthropic" })

      await expect(
        turn.finalize({
          responseMessage: {
            id: "msg1",
            role: "assistant",
            parts: [],
            metadata: {},
          } as unknown as UIMessage,
          isAborted: true,
          finishReason: "stop",
        })
      ).resolves.toBeUndefined()

      const aborted = findCalls(
        fetchMutation,
        api.chatRuntime.markGenerationRunAborted
      )[0]
      expect(aborted[1]).toMatchObject({
        runId: "run1",
        messageId: "msg1",
        reason: "ui message stream aborted",
      })
      expect(
        findCalls(fetchMutation, api.chatRuntime.markGenerationRunCompleted)
      ).toHaveLength(0)
      const warnLine = warn.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("durable_run_abort_write_failed"))
      expect(warnLine).toBeDefined()
    } finally {
      warn.mockRestore()
    }
  })

  it("issues both abort writes with distinct reasons when onStreamAbort precedes finalize (double-terminal, first-terminal-wins)", async () => {
    const fetchMutation = makeRecordingFetchMutation()
    const turn = makeConvexTurn(
      makeInput() as DurableTurnInput & { convexToken: string },
      fetchMutation
    )
    await turn.prepare({ provider: "anthropic" })

    // The stream `onAbort` half flushes + marks aborted ("stream aborted")...
    await turn.onStreamAbort("stream aborted")
    // ...then the envelope `onEnd` half marks aborted again ("ui message stream
    // aborted"). Both fire by design; the Generation run lifecycle's
    // first-terminal-wins absorbs the second, and finalize never rejects.
    await expect(
      turn.finalize({
        responseMessage: {
          id: "msg1",
          role: "assistant",
          parts: [],
          metadata: {},
        } as unknown as UIMessage,
        isAborted: true,
        finishReason: "stop",
      })
    ).resolves.toBeUndefined()

    const abortReasons = findCalls(
      fetchMutation,
      api.chatRuntime.markGenerationRunAborted
    ).map((call) => (call[1] as { reason: string }).reason)
    expect(abortReasons).toEqual([
      "stream aborted",
      "ui message stream aborted",
    ])
    // The abort path never completes the run.
    expect(
      findCalls(fetchMutation, api.chatRuntime.markGenerationRunCompleted)
    ).toHaveLength(0)
  })
})

describe("durable turn runtime — prepare() error mapping", () => {
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
    const turn = makeConvexTurn(input, fetchMutation)

    await expect(turn.prepare({ provider: "anthropic" })).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_REQUEST",
    })
    expect(
      findCalls(fetchMutation, api.chatRuntime.prepareGeneration)
    ).toHaveLength(0)
  })

  it("maps a Convex argument-validation rejection to 400 after warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const fetchMutation = makeRecordingFetchMutation({
        responders: {
          [nameOf(api.chatRuntime.prepareGeneration)]: () => {
            throw new Error("ArgumentValidationError: bad id")
          },
        },
      })
      const turn = makeConvexTurn(
        makeInput() as DurableTurnInput & { convexToken: string },
        fetchMutation
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
      responders: {
        [nameOf(api.chatRuntime.prepareGeneration)]: () => {
          throw guardError
        },
      },
    })
    const turn = makeConvexTurn(
      makeInput() as DurableTurnInput & { convexToken: string },
      fetchMutation
    )

    const thrown = await turn.prepare({ provider: "anthropic" }).then(
      () => null,
      (error) => error
    )
    expect(thrown).toBe(guardError)
    expect((thrown as { statusCode?: number }).statusCode).toBeUndefined()
  })

  it("forwards the selected-path-token + edit guard args verbatim (count-drift edge)", async () => {
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
      fetchMutation
    )

    await turn.prepare({ provider: "anthropic" })

    const prepareArgs = findCalls(
      fetchMutation,
      api.chatRuntime.prepareGeneration
    )[0][1] as Record<string, unknown>
    expect(prepareArgs.expectedVisibleMessageCount).toBe(42)
    expect(prepareArgs.tailMessageId).toBe("tail-xyz")
    expect(prepareArgs.edit).toBe(edit)
    expect(prepareArgs.provider).toBe("anthropic")
    // An edit turn never re-sends the latest client user message.
    expect(prepareArgs.latestUserMessage).toBeUndefined()
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

    expect(guest.streamTextExtras(makeToolFacts())).toEqual({})

    const validated = [
      { id: "v1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ] as UIMessage[]
    const identity = guest.uiStreamIdentity(validated)
    expect(identity.originalMessages).toBe(validated)
    expect(identity.generateMessageId).toBeUndefined()

    // Every write method is an inert no-op.
    guest.onChunk({ type: "text-delta", text: "A" } as never)
    guest.recordStep({
      stepNumber: 1,
      toolCalls: [{ toolCallId: "c", toolName: "t", input: {} }],
      toolResults: [],
    })
    guest.noteStreamError("boom")
    guest.captureFinish({
      usage: {},
      finishReason: "stop",
      toolCounts: { totalToolCalls: 0, failedToolCalls: 0 },
    })
    await expect(guest.onStreamAbort("stream aborted")).resolves.toBeUndefined()
    await expect(
      guest.finalize({
        responseMessage: {
          id: "v1",
          role: "assistant",
          parts: [],
          metadata: {},
        } as unknown as UIMessage,
        isAborted: false,
        finishReason: "stop",
      })
    ).resolves.toBeUndefined()
    await expect(guest.fail(new Error("nope"))).resolves.toBeUndefined()

    expect(moduleFetchMutation).not.toHaveBeenCalled()
  })
})

describe("durable turn runtime — fail() at each phase", () => {
  it("is a no-op before prepare() (no run exists)", async () => {
    const fetchMutation = makeRecordingFetchMutation()
    const turn = makeConvexTurn(
      makeInput() as DurableTurnInput & { convexToken: string },
      fetchMutation
    )
    await expect(turn.fail(new Error("early"))).resolves.toBeUndefined()
    expect(fetchMutation).not.toHaveBeenCalled()
  })

  it("marks the run failed after prepare(), with the assistant message id", async () => {
    const fetchMutation = makeRecordingFetchMutation()
    const turn = makeConvexTurn(
      makeInput() as DurableTurnInput & { convexToken: string },
      fetchMutation
    )
    await turn.prepare({ provider: "anthropic" })
    await turn.fail(new Error("provider exploded"))

    const failed = findCalls(
      fetchMutation,
      api.chatRuntime.markGenerationRunFailed
    )[0]
    expect(failed[1]).toMatchObject({
      runId: "run1",
      messageId: "msg1",
      error: "provider exploded",
    })
    expect(failed[2]).toEqual({ token: "tok" })
  })

  it("warns and resolves when the failure write itself rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const fetchMutation = makeRecordingFetchMutation({
        responders: {
          [nameOf(api.chatRuntime.markGenerationRunFailed)]: () => {
            throw new Error("convex unavailable")
          },
        },
      })
      const turn = makeConvexTurn(
        makeInput() as DurableTurnInput & { convexToken: string },
        fetchMutation
      )
      await turn.prepare({ provider: "anthropic" })

      await expect(turn.fail(new Error("boom"))).resolves.toBeUndefined()
      const warnLine = warn.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("durable_run_failed_write_failed"))
      expect(warnLine).toBeDefined()
    } finally {
      warn.mockRestore()
    }
  })
})
