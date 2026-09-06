import type { ChatStatus, UIMessage, UIMessageChunk } from "ai"
import { afterEach, expect, it, vi } from "vitest"
import { consumeRetainedResponse, ResumableChat } from "./resumable-chat"

const base: UIMessage = {
  id: "assistant",
  role: "assistant",
  parts: [{ type: "text", text: "Before approval." }],
}
const chunks: UIMessageChunk[] = [
  { type: "start", messageId: "assistant" },
  { type: "text-start", id: "new-text" },
  { type: "text-delta", id: "new-text", delta: "Hello" },
]
const frame = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value)}\n`)

afterEach(() => vi.unstubAllGlobals())

it.each(["text", "reasoning"] as const)(
  "restores historical %s once without replaying it or changing live chunks",
  async (type) => {
    const history = "x".repeat(99) + "🦇" + "z".repeat(899)
    const live = " live".repeat(100)
    const updates: string[] = []
    let caughtUp = false
    const events = [
      { type: "base", highWater: "3-0" },
      { type: "chunk", id: "1-0", chunk: chunks[0] },
      {
        type: "chunk",
        id: "2-0",
        chunk: { type: `${type}-start`, id: "part" },
      },
      {
        type: "chunk",
        id: "3-0",
        chunk: { type: `${type}-delta`, id: "part", delta: history },
      },
      { type: "caught-up" },
      {
        type: "chunk",
        id: "4-0",
        chunk: { type: `${type}-delta`, id: "part", delta: live },
      },
      { type: "end" },
    ]
    await consumeRetainedResponse(
      new ReadableStream({
        start(controller) {
          events.forEach((event) => controller.enqueue(frame(event)))
          controller.close()
        },
      }),
      (message) => {
        const part = message.parts.find((part) => part.type === type)
        if (!part || !("text" in part) || !part.text) return
        expect(/[\uD800-\uDBFF]$/.test(part.text)).toBe(false)
        if (part.text.length <= history.length) {
          expect(caughtUp).toBe(false)
        }
        updates.push(part.text)
      },
      new AbortController().signal,
      undefined,
      () => {
        caughtUp = true
      }
    )
    expect(updates).toEqual([history, history + live])
  }
)

it("cancels reconstruction without exposing partial history", async () => {
  const abort = new AbortController()
  const publish = vi.fn()
  let source!: ReadableStreamDefaultController<Uint8Array>
  const consuming = consumeRetainedResponse(
    new ReadableStream({
      start(controller) {
        source = controller
        controller.enqueue(frame({ type: "base", highWater: "3-0" }))
        for (const chunk of chunks)
          controller.enqueue(frame({ type: "chunk", id: "1-0", chunk }))
      },
    }),
    publish,
    abort.signal
  )
  await vi.waitFor(() => expect(source.desiredSize).toBe(1))
  expect(publish).not.toHaveBeenCalled()
  abort.abort()
  await consuming
  expect(publish).not.toHaveBeenCalled()
})

it("restores an approval baseline and retained output together before live updates", async () => {
  const updates: string[] = []
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        frame({ type: "base", message: base, highWater: "3-0" })
      )
      chunks.forEach((chunk, i) =>
        controller.enqueue(frame({ type: "chunk", id: `${i + 1}-0`, chunk }))
      )
      controller.enqueue(frame({ type: "caught-up" }))
      controller.enqueue(
        frame({
          type: "chunk",
          id: "4-0",
          chunk: { type: "text-delta", id: "new-text", delta: " world" },
        })
      )
      controller.enqueue(frame({ type: "end" }))
      controller.close()
    },
  })
  await consumeRetainedResponse(
    stream,
    (message) => {
      updates.push(
        message.parts
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("")
      )
    },
    new AbortController().signal
  )
  expect(updates).toEqual([
    "Before approval.Hello",
    "Before approval.Hello world",
  ])
})

it("reconnects by GET without erasing visible text or dispatching another generation", async () => {
  const sendMessages = vi.fn()
  const onFinish = vi.fn()
  const fetchMock = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(frame({ type: "base", highWater: "3-0" }))
            chunks.forEach((chunk, i) =>
              controller.enqueue(
                frame({ type: "chunk", id: `${i + 1}-0`, chunk })
              )
            )
            controller.enqueue(frame({ type: "caught-up" }))
            controller.enqueue(
              frame({
                type: "chunk",
                id: "4-0",
                chunk: { type: "text-delta", id: "new-text", delta: " world" },
              })
            )
            controller.enqueue(frame({ type: "end" }))
            controller.close()
          },
        })
      )
  )
  vi.stubGlobal("fetch", fetchMock)
  const message: UIMessage = {
    id: "assistant",
    role: "assistant",
    parts: [{ type: "text", text: "Hello world" }],
  }
  const chat = new ResumableChat({
    messages: [message],
    transport: { sendMessages, reconnectToStream: vi.fn() },
    onFinish,
  })
  const published: string[] = []
  chat["~registerMessagesCallback"](() =>
    published.push(
      chat.messages[0].parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("")
    )
  )
  chat.syncRun(
    {
      chatId: "chat",
      runId: "run",
      assistantMessageId: "assistant",
      status: "streaming",
    },
    [message]
  )
  await vi.waitFor(() => expect(published).toEqual(["Hello world"]))
  expect(published).toEqual(["Hello world"])
  expect(sendMessages).not.toHaveBeenCalled()
  expect(onFinish).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it("keeps checkpoints available during a missing replay and releases a detached reader", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 503 }))
  vi.stubGlobal("fetch", fetchMock)
  const chat = new ResumableChat({ messages: [] })
  const run = {
    chatId: "chat",
    runId: "run",
    assistantMessageId: "assistant",
    status: "streaming",
  }
  chat.syncRun(run, [])
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  expect(chat.status).toBe("ready")
  chat.syncRun(run, [])
  expect(fetchMock).toHaveBeenCalledTimes(1)
  chat.detachObserver()
  chat.syncRun(run, [])
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  await chat.stop()
  expect(chat.status).toBe("ready")
})

it("recovers a failed original transport but respects explicit Stop", async () => {
  class ControlledChat extends ResumableChat {
    transition(status: ChatStatus) {
      this.setStatus({ status })
    }
  }
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal("fetch", fetchMock)
  const run = {
    chatId: "chat",
    runId: "run",
    assistantMessageId: "assistant",
    status: "streaming",
  }
  const chat = new ControlledChat({ messages: [] })
  chat.transition("streaming")
  chat.syncRun(run, [])
  expect(fetchMock).not.toHaveBeenCalled()
  chat.transition("error")
  chat.syncRun(run, [])
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const stopped = new ControlledChat({ messages: [] })
  stopped.transition("streaming")
  stopped.syncRun(run, [])
  await stopped.stop()
  stopped.syncRun(run, [])
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it("restores the checkpoint before subscription hydration and silently catches up", async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>
  const fetchMock = vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller
          },
        })
      )
  )
  vi.stubGlobal("fetch", fetchMock)
  const chat = new ResumableChat({ messages: [] })
  const conversation = {
    chatId: "chat",
    isAuthenticated: true,
    isLoading: true,
  }
  chat.syncRun(null, [], conversation)
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/chat/chat/stream",
    expect.objectContaining({ cache: "no-store" })
  )
  chat.syncRun(null, [], conversation)
  source.enqueue(
    frame({
      type: "selection",
      runId: "run",
      assistantMessageId: "assistant",
      messages: [
        { id: "user", role: "user", parts: [{ type: "text", text: "Prompt" }] },
        {
          id: "assistant",
          role: "assistant",
          parts: [{ type: "text", text: "x".repeat(800) }],
          createdAt: "2026-09-05T12:00:00.000Z",
          content: "x".repeat(800),
          status: "streaming",
        },
      ],
    })
  )
  source.enqueue(frame({ type: "base", highWater: "20-0" }))
  source.enqueue(frame({ type: "chunk", id: "1-0", chunk: chunks[0] }))
  source.enqueue(frame({ type: "chunk", id: "2-0", chunk: chunks[1] }))
  for (let i = 0; i < 12; i++)
    source.enqueue(
      frame({
        type: "chunk",
        id: `${i + 3}-0`,
        chunk: { type: "text-delta", id: "new-text", delta: "x".repeat(100) },
      })
    )
  const text = () =>
    chat.messages
      .at(-1)
      ?.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("") ?? ""
  await vi.waitFor(() => expect(text().length).toBeGreaterThan(0))
  expect(text()).toBe("x".repeat(800))
  expect(chat.messages.at(-1)).toMatchObject({
    createdAt: new Date("2026-09-05T12:00:00.000Z"),
    content: "x".repeat(800),
    status: "streaming",
  })
  chat.syncRun(
    {
      chatId: "chat",
      runId: "run",
      assistantMessageId: "assistant",
      status: "completed",
    },
    [],
    { ...conversation, isLoading: false }
  )
  source.enqueue(frame({ type: "caught-up" }))
  source.enqueue(frame({ type: "end" }))
  source.close()
  await vi.waitFor(() => expect(text()).toBe("x".repeat(1200)))
  await vi.waitFor(() => expect(chat.status).toBe("ready"))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(chat.messages.map((message) => message.id)).toEqual([
    "user",
    "assistant",
  ])
})

it("does not reconnect after Stop while discovery is awaiting its selection", async () => {
  const fetchMock = vi.fn<typeof fetch>(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Stopped", "AbortError")),
          { once: true }
        )
      })
  )
  vi.stubGlobal("fetch", fetchMock)
  const chat = new ResumableChat({ messages: [] })
  const conversation = {
    chatId: "chat",
    isAuthenticated: true,
    isLoading: true,
  }
  const run = {
    chatId: "chat",
    runId: "run",
    assistantMessageId: "assistant",
    status: "streaming",
  }
  chat.syncRun(null, [], conversation)
  chat.syncRun(run, [], { ...conversation, isLoading: false })
  await chat.stop()
  chat.syncRun(run, [], { ...conversation, isLoading: false })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(chat.status).toBe("ready")
})

it("keeps a checkpoint painted while discovery was pending", async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              source = controller
            },
          })
        )
    )
  )
  const chat = new ResumableChat({ messages: [] })
  chat.syncRun(null, [], {
    chatId: "chat",
    isAuthenticated: true,
    isLoading: true,
  })
  await vi.waitFor(() => expect(source).toBeDefined())
  const checkpoint: UIMessage = {
    id: "assistant",
    role: "assistant",
    parts: [{ type: "text", text: "Hello" }],
  }
  chat.messages = [checkpoint]
  const published: string[] = []
  chat["~registerMessagesCallback"](() =>
    published.push(
      chat.messages
        .flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "text" ? [part.text] : []
          )
        )
        .join("")
    )
  )
  source.enqueue(
    frame({
      type: "selection",
      runId: "run",
      assistantMessageId: "assistant",
      messages: [checkpoint],
    })
  )
  source.enqueue(frame({ type: "base", highWater: "3-0" }))
  chunks.forEach((chunk, i) =>
    source.enqueue(frame({ type: "chunk", id: `${i + 1}-0`, chunk }))
  )
  source.enqueue(frame({ type: "caught-up" }))
  source.enqueue(
    frame({
      type: "chunk",
      id: "4-0",
      chunk: { type: "text-delta", id: "new-text", delta: " world" },
    })
  )
  source.enqueue(frame({ type: "end" }))
  source.close()
  await vi.waitFor(() => expect(published.at(-1)).toBe("Hello world"))
  expect(published.every((text) => text.startsWith("Hello"))).toBe(true)
  expect(chat.replayingMessageId).toBeNull()
})

it.each([
  {
    name: "tool result",
    checkpoint: {
      type: "tool-search",
      toolCallId: "tool",
      state: "output-available",
      input: { query: "test" },
      output: { answer: "saved" },
    },
    history: [
      {
        type: "tool-search",
        toolCallId: "tool",
        state: "input-available",
        input: { query: "test" },
      },
    ],
    catchUp: [
      {
        type: "tool-output-available",
        toolCallId: "tool",
        output: { answer: "saved" },
      },
    ],
  },
  {
    name: "newer tool output",
    checkpoint: {
      type: "tool-search",
      toolCallId: "tool",
      state: "output-available",
      input: { query: "test" },
      output: { answer: "saved" },
    },
    history: [
      {
        type: "tool-search",
        toolCallId: "tool",
        state: "output-available",
        input: { query: "test" },
        output: { answer: "old" },
      },
    ],
    catchUp: [
      {
        type: "tool-output-available",
        toolCallId: "tool",
        output: { answer: "saved" },
      },
    ],
  },
  {
    name: "source",
    checkpoint: {
      type: "source-url",
      sourceId: "source",
      url: "https://example.com",
      title: "Saved citation",
    },
    history: [],
    catchUp: [
      {
        type: "source-url",
        sourceId: "source",
        url: "https://example.com",
        title: "Saved citation",
      },
    ],
  },
  {
    name: "file",
    checkpoint: {
      type: "file",
      mediaType: "image/png",
      url: "https://example.com/image.png",
    },
    history: [],
    catchUp: [
      {
        type: "file",
        mediaType: "image/png",
        url: "https://example.com/image.png",
      },
    ],
  },
] satisfies {
  name: string
  checkpoint: UIMessage["parts"][number]
  history: UIMessage["parts"]
  catchUp: UIMessageChunk[]
}[])(
  "keeps the checkpoint's $name until retained structured output catches up",
  async ({ checkpoint, history, catchUp }) => {
    const message: UIMessage = {
      id: "assistant",
      role: "assistant",
      parts: [{ type: "text", text: "Saved" }, checkpoint],
    }
    let source!: ReadableStreamDefaultController<Uint8Array>
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                source = controller
              },
            })
          )
      )
    )
    const chat = new ResumableChat({ messages: [message] })
    const updates: UIMessage[] = []
    chat["~registerMessagesCallback"](() => updates.push(chat.messages[0]))
    chat.syncRun(
      {
        chatId: "chat",
        runId: "run",
        assistantMessageId: "assistant",
        status: "streaming",
      },
      [message]
    )
    await vi.waitFor(() => expect(source).toBeDefined())
    source.enqueue(
      frame({
        type: "base",
        highWater: "0-0",
        message: { ...message, parts: [message.parts[0], ...history] },
      })
    )
    source.enqueue(frame({ type: "caught-up" }))
    await vi.waitFor(() => expect(source.desiredSize).toBe(1))
    expect(chat.messages[0]).toEqual(message)
    expect(updates).toEqual([])
    for (const chunk of catchUp)
      source.enqueue(frame({ type: "chunk", id: "1-0", chunk }))
    source.enqueue(frame({ type: "end" }))
    source.close()
    await vi.waitFor(() => expect(chat.replayRunId).toBeNull())
    expect(updates.length).toBeGreaterThan(0)
    for (const update of updates) expect(update.parts).toEqual(message.parts)
  }
)

it.each([true, false])(
  "a generation error retries only if its transport is incomplete (end=%s)",
  async (ended) => {
    const events = [
      { type: "base", highWater: "4-0" },
      ...chunks.map((chunk) => ({ type: "chunk", id: "1-0", chunk })),
      {
        type: "chunk",
        id: "4-0",
        chunk: { type: "error", errorText: "Model failed" },
      },
      { type: "caught-up" },
      ...(ended ? [{ type: "end" }] : []),
    ]
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const event of events) controller.enqueue(frame(event))
              controller.close()
            },
          })
        )
    )
    vi.stubGlobal("fetch", fetchMock)
    const chat = new ResumableChat({ messages: [] })
    chat.syncRun(
      {
        chatId: "chat",
        runId: "run",
        assistantMessageId: "assistant",
        status: "streaming",
      },
      []
    )
    if (ended) {
      await vi.waitFor(() => expect(chat.replayRunId).toBeNull())
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } else {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
        timeout: 1500,
      })
      chat.detachObserver()
    }
    expect(chat.messages[0].parts).toEqual([
      { type: "text", text: "Hello", state: "streaming" },
    ])
  }
)

it("accepts mutable live data after reaching the checkpoint", async () => {
  const message: UIMessage = {
    id: "assistant",
    role: "assistant",
    parts: [
      { type: "data-progress", id: "progress", data: { phase: "queued" } },
    ],
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                frame({ type: "base", highWater: "0-0", message })
              )
              controller.enqueue(frame({ type: "caught-up" }))
              controller.enqueue(
                frame({
                  type: "chunk",
                  id: "1-0",
                  chunk: {
                    type: "data-progress",
                    id: "progress",
                    data: { phase: "running" },
                  },
                })
              )
              controller.enqueue(frame({ type: "end" }))
              controller.close()
            },
          })
        )
    )
  )
  const chat = new ResumableChat({ messages: [message] })
  chat.syncRun(
    {
      chatId: "chat",
      runId: "run",
      assistantMessageId: "assistant",
      status: "streaming",
    },
    [message]
  )
  await vi.waitFor(() => expect(chat.replayRunId).toBeNull())
  expect(chat.messages[0].parts).toEqual([
    { type: "data-progress", id: "progress", data: { phase: "running" } },
  ])
})

it.each([false, true])(
  "defers retained reads during local submission (selected run=%s)",
  (selected) => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const chat = new ResumableChat({ messages: [] })
    const run = selected
      ? {
          chatId: "chat",
          runId: "run",
          assistantMessageId: "assistant",
          status: "streaming",
        }
      : null
    const conversation = {
      chatId: "chat",
      isAuthenticated: true,
      isLoading: true,
      isSubmitting: true,
    }
    chat.syncRun(run, [], conversation)
    expect(fetchMock).not.toHaveBeenCalled()
    chat.syncRun(run, [], { ...conversation, isSubmitting: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    chat.detachObserver()
  }
)
