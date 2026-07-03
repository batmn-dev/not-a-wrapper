import type { TextStreamPart, ToolSet, UIMessage } from "ai"
import { fetchMutation } from "convex/nextjs"
import { describe, expect, it, vi } from "vitest"
import type { Id } from "@/convex/_generated/dataModel"
import {
  createDurableSnapshotTracker,
  createRuntimeApprovalPersistenceTransform,
  extractApprovalResponses,
  getFinalAssistantText,
  getLatestUserMessage,
  isDurableConvexChat,
  toDurableUiMessage,
} from "./durable-runtime"

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
}))

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe("durable chat runtime helpers", () => {
  it("only enables Convex durability for authenticated Convex chats", () => {
    expect(
      isDurableConvexChat({
        isAuthenticated: true,
        convexToken: "token",
        chatId: "chat_123",
      })
    ).toBe(true)
    expect(
      isDurableConvexChat({
        isAuthenticated: true,
        convexToken: "token",
        chatId: "local-123",
      })
    ).toBe(false)
    expect(
      isDurableConvexChat({
        isAuthenticated: true,
        convexToken: "token",
        chatId: "optimistic-123",
      })
    ).toBe(false)
    expect(
      isDurableConvexChat({
        isAuthenticated: false,
        convexToken: "token",
        chatId: "chat_123",
      })
    ).toBe(false)
  })

  it("uses the latest user message instead of trusting full client history", () => {
    const messages = [
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "old" }] },
      { id: "u1", role: "user", parts: [{ type: "text", text: "first" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "latest" }] },
    ] as UIMessage[]

    expect(getLatestUserMessage(messages)?.id).toBe("u2")
  })

  it("preserves approval responses for the next server turn", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-send_email",
            toolCallId: "call-1",
            state: "approval-responded",
            input: { to: "person@example.com" },
            approval: {
              id: "approval-1",
              approved: false,
              reason: "Denied by user",
            },
          },
        ],
      },
    ] as unknown as UIMessage[]

    expect(extractApprovalResponses(messages)).toEqual([
      {
        messageId: "assistant-1",
        approvalId: "approval-1",
        toolCallId: "call-1",
        toolName: "send_email",
        approved: false,
        reason: "Denied by user",
      },
    ])
  })

  it("persists tool approval requests before streaming approval chunks", async () => {
    const approvalWrite = createDeferred<void>()
    const approvalWritePromises: Promise<unknown>[] = []
    const events: string[] = []
    const approvalChunk = {
      type: "tool-approval-request",
      approvalId: "approval-1",
      toolCall: {
        toolCallId: "call-1",
        toolName: "send_email",
        input: { to: "person@example.com" },
      },
    } as unknown as TextStreamPart<ToolSet>

    const transform = createRuntimeApprovalPersistenceTransform({
      chatId: "chat_1",
      convexToken: "token",
      durableRunState: {
        runId: "run_1" as Id<"generationRuns">,
        assistantMessageId: "message_1" as Id<"messages">,
      },
      runtimeApprovalByToolName: new Map([
        ["send_email", { reason: "External write", riskClass: "write" }],
      ]),
      toolMetadataResolver: { source: () => "mcp" },
      approvalWritePromises,
      requestId: "request-1",
      persistApprovalRequest: async (args) => {
        events.push(`write-start:${args.approvalId}`)
        expect(args).toMatchObject({
          approvalId: "approval-1",
          toolCallId: "call-1",
          toolName: "send_email",
          source: "mcp",
          reason: "External write",
          riskClass: "write",
          inputPreview: JSON.stringify({ to: "person@example.com" }),
        })
        await approvalWrite.promise
        events.push("write-finished")
      },
    })
    const stream = new ReadableStream<TextStreamPart<ToolSet>>({
      start(controller) {
        controller.enqueue(approvalChunk)
        controller.close()
      },
    }).pipeThrough(
      transform({
        tools: {},
        stopStream: () => {},
      })
    )

    const reader = stream.getReader()
    const firstRead = reader.read().then((result) => {
      events.push("chunk-read")
      return result
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events).toEqual(["write-start:approval-1"])
    expect(approvalWritePromises).toHaveLength(1)

    approvalWrite.resolve()
    const result = await firstRead

    expect(result.done).toBe(false)
    expect(result.value).toBe(approvalChunk)
    expect(events).toEqual([
      "write-start:approval-1",
      "write-finished",
      "chunk-read",
    ])
    const trackedApprovalWrite = approvalWritePromises[0]
    if (!trackedApprovalWrite) throw new Error("Approval write was not tracked")
    await expect(trackedApprovalWrite).resolves.toBeUndefined()
  })

  it("maps streaming Convex messages into nonblank UI messages", () => {
    const message = toDurableUiMessage({
      _id: "msg_1",
      _creationTime: 100,
      chatId: "chat_1",
      orderId: 0,
      role: "assistant",
      content: "partial output",
      parts: [{ type: "text", text: "partial output" }],
      status: "aborted",
      createdAt: 100,
      updatedAt: 200,
    } as Parameters<typeof toDurableUiMessage>[0])

    expect(message.id).toBe("msg_1")
    expect(message.createdAt).toEqual(new Date(100))
    expect(message.status).toBe("aborted")
    expect(getFinalAssistantText(message)).toBe("partial output")
    expect(message.metadata?.durableStatus).toBe("aborted")
  })

  it("uses an injected persister for snapshot writes", async () => {
    vi.mocked(fetchMutation).mockReset()
    const injectedFetchMutation = vi.fn().mockResolvedValue(undefined)

    const tracker = createDurableSnapshotTracker({
      convexToken: "token",
      runId: "run_1" as Id<"generationRuns">,
      chatId: "chat_1" as Id<"chats">,
      messageId: "message_1" as Id<"messages">,
      order: 1,
      fetchMutation: injectedFetchMutation as unknown as typeof fetchMutation,
    })

    tracker.onChunk({ type: "text-delta", text: "A" } as never)
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(injectedFetchMutation).toHaveBeenCalledTimes(1)
    expect(injectedFetchMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "run_1",
        chatId: "chat_1",
        messageId: "message_1",
        order: 1,
        sequence: 1,
        textSnapshot: "A",
        partsSnapshot: [{ type: "text", text: "A" }],
      }),
      { token: "token" }
    )
    expect(fetchMutation).not.toHaveBeenCalled()
  })

  it("does not force-write an empty snapshot before the first semantic delta", async () => {
    vi.mocked(fetchMutation).mockReset()

    const tracker = createDurableSnapshotTracker({
      convexToken: "token",
      runId: "run_1" as Id<"generationRuns">,
      chatId: "chat_1" as Id<"chats">,
      messageId: "message_1" as Id<"messages">,
      order: 1,
    })

    await tracker.flush()

    expect(fetchMutation).not.toHaveBeenCalled()
    expect(tracker.textSnapshot).toBe("")
    expect(tracker.partsSnapshot).toEqual([])
  })

  it("waits for an in-flight snapshot write before flushing the final snapshot", async () => {
    const firstWrite = createDeferred<void>()
    vi.mocked(fetchMutation)
      .mockReset()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(undefined)

    const tracker = createDurableSnapshotTracker({
      convexToken: "token",
      runId: "run_1" as Id<"generationRuns">,
      chatId: "chat_1" as Id<"chats">,
      messageId: "message_1" as Id<"messages">,
      order: 1,
      throttleMs: 60_000,
    })

    tracker.onChunk({ type: "text-delta", text: "A" } as never)
    tracker.onChunk({ type: "text-delta", text: "B" } as never)

    let flushed = false
    const flushPromise = tracker.flush().then(() => {
      flushed = true
    })

    await Promise.resolve()

    expect(flushed).toBe(false)
    expect(fetchMutation).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchMutation).mock.calls[0]?.[1]).toMatchObject({
      sequence: 1,
      textSnapshot: "A",
      partsSnapshot: [{ type: "text", text: "A" }],
    })

    firstWrite.resolve()
    await flushPromise

    expect(fetchMutation).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetchMutation).mock.calls[1]?.[1]).toMatchObject({
      sequence: 2,
      textSnapshot: "AB",
      partsSnapshot: [{ type: "text", text: "AB" }],
    })
  })

  it("resolves overlapping flushes with bounded writes (post-Stop livelock)", async () => {
    // Regression: onAbort and the response-level onFinish both flush() within
    // ~200ms of a Stop. With a shared boolean `pending` flag, the two forced
    // persist loops re-armed each other forever — flush() never resolved, so
    // markGenerationRunAborted never ran and snapshot writes continued at the
    // write-latency rate until the Convex token expired.
    vi.mocked(fetchMutation)
      .mockReset()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(resolve, 5)
          ) as unknown as ReturnType<typeof fetchMutation>
      )

    const tracker = createDurableSnapshotTracker({
      convexToken: "token",
      runId: "run_1" as Id<"generationRuns">,
      chatId: "chat_1" as Id<"chats">,
      messageId: "message_1" as Id<"messages">,
      order: 1,
      throttleMs: 60_000,
    })

    // First chunk starts an in-flight write both flushes must contend with.
    tracker.onChunk({ type: "text-delta", text: "A" } as never)
    tracker.onChunk({ type: "text-delta", text: "B" } as never)

    const flushes = Promise.all([tracker.flush(), tracker.flush()])
    const outcome = await Promise.race([
      flushes.then(() => "flushed" as const),
      new Promise<"livelocked">((resolve) =>
        setTimeout(() => resolve("livelocked"), 500)
      ),
    ])

    expect(outcome).toBe("flushed")
    // One in-flight incremental write plus at most one forced final write.
    expect(vi.mocked(fetchMutation).mock.calls.length).toBeLessThanOrEqual(3)
    const lastCall = vi.mocked(fetchMutation).mock.calls.at(-1)
    expect(lastCall?.[1]).toMatchObject({ textSnapshot: "AB" })
  })

  it("catches rejected incremental snapshot writes", async () => {
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason)
    }
    vi.mocked(fetchMutation)
      .mockReset()
      .mockRejectedValueOnce(new Error("snapshot failed"))

    process.on("unhandledRejection", onUnhandledRejection)

    try {
      const tracker = createDurableSnapshotTracker({
        convexToken: "token",
        runId: "run_1" as Id<"generationRuns">,
        chatId: "chat_1" as Id<"chats">,
        messageId: "message_1" as Id<"messages">,
        order: 1,
      })

      tracker.onChunk({
        type: "text-delta",
        text: "A",
      } as TextStreamPart<ToolSet>)

      await new Promise<void>((resolve) => setImmediate(resolve))
    } finally {
      process.off("unhandledRejection", onUnhandledRejection)
    }

    expect(fetchMutation).toHaveBeenCalledTimes(1)
    expect(unhandledRejections).toEqual([])
  })
})
