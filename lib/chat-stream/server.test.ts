import type { UIMessageChunk } from "ai"
import { createClient } from "redis"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  retainedChatStreamFrameSchema,
  type RetainedChatStreamFrame,
} from "./protocol"
import { initializeRetainedChatStream, readRetainedChatStream } from "./server"

const url = process.env.CHAT_STREAM_TEST_REDIS_URL
const runs: string[] = []
const client = createClient({
  url,
  disableOfflineQueue: true,
  socket: { connectTimeout: 3000, reconnectStrategy: false },
})
client.on("error", () => undefined)

function newRun() {
  const run = `test-${crypto.randomUUID()}`
  runs.push(run)
  return run
}

async function nextFrame(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const next = await reader.read()
  if (next.done) return null
  return retainedChatStreamFrameSchema.parseAsync(
    JSON.parse(new TextDecoder().decode(next.value))
  )
}

async function collect(stream: ReadableStream<Uint8Array> | null) {
  expect(stream).not.toBeNull()
  const reader = stream!.getReader()
  const frames: RetainedChatStreamFrame[] = []
  for (;;) {
    const frame = await nextFrame(reader)
    if (!frame) return frames
    frames.push(frame)
  }
}

describe.runIf(Boolean(url))(
  "retained chat streams (Redis integration)",
  () => {
    beforeAll(async () => {
      vi.stubEnv("CHAT_STREAM_REDIS_URL", url!)
      await client.connect()
    })
    afterAll(async () => {
      try {
        if (client.isReady)
          for (const run of runs) {
            const prefix = `chat-stream:v1:{${encodeURIComponent(run)}}`
            await client.del([`${prefix}:meta`, `${prefix}:events`])
          }
      } finally {
        if (client.isOpen) client.destroy()
        vi.unstubAllEnvs()
      }
    })

    it("replays a fixed prefix then follows the same ordered log without gaps", async () => {
      const runId = newRun()
      const baseMessage = {
        id: "assistant",
        role: "assistant" as const,
        parts: [],
      }
      const writer = await initializeRetainedChatStream({ runId, baseMessage })
      expect(writer).not.toBeNull()
      // A duplicate start must never overwrite the immutable base or own the producer.
      expect(await initializeRetainedChatStream({ runId })).toBeNull()
      let source!: ReadableStreamDefaultController<UIMessageChunk>
      const consuming = writer!.consume(
        new ReadableStream({
          start(controller) {
            source = controller
          },
        })
      )
      const replay = await readRetainedChatStream(runId)
      const reader = replay!.getReader()
      expect(await nextFrame(reader)).toEqual({
        type: "base",
        message: baseMessage,
        highWater: "0-0",
      })
      expect(await nextFrame(reader)).toEqual({ type: "caught-up" })

      const chunks: UIMessageChunk[] = [
        { type: "start", messageId: "assistant" },
        { type: "text-start", id: "text" },
        { type: "text-delta", id: "text", delta: "Hello" },
        { type: "text-delta", id: "text", delta: " world" },
        { type: "text-end", id: "text" },
        { type: "finish" },
      ]
      for (const chunk of chunks) source.enqueue(chunk)
      source.close()
      await consuming
      const live: UIMessageChunk[] = []
      for (;;) {
        const frame = await nextFrame(reader)
        if (!frame) break
        if (frame.type === "chunk") live.push(frame.chunk)
      }
      expect(live).toEqual(chunks)

      const resumed = await collect(await readRetainedChatStream(runId))
      expect(
        resumed
          .filter((frame) => frame.type === "chunk")
          .map((frame) => frame.chunk)
      ).toEqual(chunks)
      expect(resumed.slice(-2)).toEqual([
        { type: "caught-up" },
        { type: "end" },
      ])
    })

    it("disconnecting a blocked reader does not cancel the producer", async () => {
      const runId = newRun()
      const writer = await initializeRetainedChatStream({ runId })
      let source!: ReadableStreamDefaultController<UIMessageChunk>
      const consuming = writer!.consume(
        new ReadableStream({
          start(controller) {
            source = controller
          },
        })
      )
      const abort = new AbortController()
      const reader = (await readRetainedChatStream(runId, {
        signal: abort.signal,
      }))!.getReader()
      await nextFrame(reader)
      await nextFrame(reader)
      const pendingRead = reader.read()
      abort.abort()
      expect((await pendingRead).done).toBe(true)
      source.enqueue({ type: "start", messageId: "assistant" })
      source.enqueue({ type: "finish" })
      source.close()
      await consuming
      const frames = await collect(await readRetainedChatStream(runId))
      expect(frames.filter((frame) => frame.type === "chunk")).toHaveLength(2)
      expect(frames.at(-1)).toEqual({ type: "end" })
    })

    it("rejects oversized records before the wire and keeps Redis usable", async () => {
      const runId = newRun()
      const writer = await initializeRetainedChatStream({ runId })
      await writer!.consume(
        new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "text-delta",
              id: "text",
              delta: "x".repeat(16 * 1024 * 1024),
            })
            controller.close()
          },
        })
      )
      expect(await readRetainedChatStream(runId)).toBeNull()
      const prefix = `chat-stream:v1:{${encodeURIComponent(runId)}}`
      expect(await client.hGet(`${prefix}:meta`, "status")).toBe("unavailable")
      expect(
        await initializeRetainedChatStream({
          runId: newRun(),
          baseMessage: {
            id: "assistant",
            role: "assistant",
            parts: [{ type: "text", text: "x".repeat(2 * 1024 * 1024) }],
          },
        })
      ).toBeNull()
      expect(
        await initializeRetainedChatStream({ runId: newRun() })
      ).not.toBeNull()
    })
    it("bounds the aggregate log even when individual chunks fit", async () => {
      const runId = newRun()
      const writer = await initializeRetainedChatStream({ runId })
      let emitted = 0
      await writer!.consume(
        new ReadableStream({
          pull(controller) {
            if (emitted++ === 33) return controller.close()
            controller.enqueue({
              type: "text-delta",
              id: "text",
              delta: "x".repeat(512 * 1024),
            })
          },
        })
      )
      expect(await readRetainedChatStream(runId)).toBeNull()
      expect(
        await client.exists(
          `chat-stream:v1:{${encodeURIComponent(runId)}}:events`
        )
      ).toBe(0)
    })
    it("retains accepted chunks and a sanitized terminal error when the source fails", async () => {
      const runId = newRun()
      const writer = await initializeRetainedChatStream({ runId })
      let source!: ReadableStreamDefaultController<UIMessageChunk>
      const consuming = writer!.consume(
        new ReadableStream({
          start(controller) {
            source = controller
          },
        })
      )
      const reader = (await readRetainedChatStream(runId))!.getReader()
      await nextFrame(reader)
      await nextFrame(reader)
      source.enqueue({ type: "start", messageId: "assistant" })
      expect(await nextFrame(reader)).toMatchObject({
        type: "chunk",
        chunk: { type: "start" },
      })
      source.error(new Error("private provider credential details"))
      await consuming
      await reader.cancel()
      const frames = await collect(await readRetainedChatStream(runId))
      expect(
        frames
          .filter((frame) => frame.type === "chunk")
          .map((frame) => frame.chunk)
      ).toEqual([
        { type: "start", messageId: "assistant" },
        { type: "error", errorText: "The response stream was interrupted." },
      ])
      expect(frames.at(-1)).toEqual({ type: "end" })
    })
  }
)
