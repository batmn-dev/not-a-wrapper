import { validateTypes } from "@ai-sdk/provider-utils"
import {
  uiMessageChunkSchema,
  validateUIMessages,
  type UIMessage,
  type UIMessageChunk,
} from "ai"
import { createClient } from "redis"
import { z } from "zod"
import {
  retainedChatStreamCursorSchema,
  type RetainedChatStreamFrame,
} from "./protocol"

const MAX_LOG_BYTES = 16 * 1024 * 1024
// Keep a single base/chunk well below hosted Redis request-size limits.
const MAX_RECORD_BYTES = 1024 * 1024
const COMPLETED_TTL_SECONDS = 600
const DEFAULT_ACTIVE_TTL_SECONDS = 3600
const BATCH_INTERVAL_MS = 20
const BATCH_BYTES = 16 * 1024
const READ_COUNT = 128
const metadataSchema = z.object({
  base: z.string(),
  status: z.enum(["active", "finished", "unavailable"]),
})

// Keys share a Redis Cluster slot. A run has exactly one immutable producer.
function keys(runId: string) {
  const prefix = `chat-stream:v1:{${encodeURIComponent(runId)}}`
  return { metadata: `${prefix}:meta`, events: `${prefix}:events` }
}

function redisUrl() {
  if (process.env.CHAT_STREAM_REDIS_URL)
    return process.env.CHAT_STREAM_REDIS_URL
  return process.env.NODE_ENV === "development"
    ? "redis://127.0.0.1:6379"
    : null
}

function newClient(url: string) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    commandOptions: { timeout: 3000 },
    socket: { connectTimeout: 3000, reconnectStrategy: false },
  })
  // Transport errors must never print credential-bearing connection details.
  client.on("error", () => undefined)
  return client
}

let shared:
  | {
      url: string
      pending: ReturnType<ReturnType<typeof newClient>["connect"]>
    }
  | undefined

async function connection() {
  const url = redisUrl()
  if (!url) return null
  if (!shared || shared.url !== url) {
    const client = newClient(url)
    shared = { url, pending: client.connect() }
  }
  const current = shared
  try {
    const client = await current.pending
    if (!client.isReady) {
      if (shared === current) shared = undefined
      return null
    }
    return client
  } catch {
    if (shared === current) shared = undefined
    return null
  }
}

const INITIALIZE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('DEL', KEYS[2])
redis.call('HSET', KEYS[1], 'base', ARGV[1], 'status', 'active', 'bytes', ARGV[2], 'owner', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
`

const APPEND = `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] or redis.call('HGET', KEYS[1], 'status') ~= 'active' then return 0 end
local bytes = tonumber(redis.call('HGET', KEYS[1], 'bytes') or '0') + tonumber(ARGV[2])
if bytes > tonumber(ARGV[3]) then
  redis.call('HSET', KEYS[1], 'status', 'unavailable')
  redis.call('EXPIRE', KEYS[1], ARGV[5])
  redis.call('DEL', KEYS[2])
  return 0
end
for i = 6, #ARGV do redis.call('XADD', KEYS[2], '*', 'chunk', ARGV[i]) end
redis.call('HSET', KEYS[1], 'bytes', bytes)
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 1
`

const FINISH = `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] or redis.call('HGET', KEYS[1], 'status') ~= 'active' then return 0 end
redis.call('HSET', KEYS[1], 'status', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
if ARGV[2] == 'unavailable' then
  redis.call('DEL', KEYS[2])
else
  redis.call('EXPIRE', KEYS[2], ARGV[3])
end
return 1
`

/** A null writer leaves the existing Convex checkpoint path in charge. */
export async function initializeRetainedChatStream({
  runId,
  baseMessage,
  activeTtlSeconds = DEFAULT_ACTIVE_TTL_SECONDS,
}: {
  runId: string
  baseMessage?: UIMessage
  activeTtlSeconds?: number
}) {
  const client = await connection()
  if (!client) return null
  const key = keys(runId)
  const owner = crypto.randomUUID()
  const base = JSON.stringify(baseMessage ?? null)
  const baseBytes = Buffer.byteLength(base)
  if (baseBytes > MAX_RECORD_BYTES) return null
  const activeTtl = Math.max(COMPLETED_TTL_SECONDS, Math.ceil(activeTtlSeconds))
  try {
    const initialized = await client.eval(INITIALIZE, {
      keys: [key.metadata, key.events],
      arguments: [
        base,
        String(Buffer.byteLength(base)),
        owner,
        String(activeTtl),
      ],
    })
    if (initialized !== 1) return null
  } catch {
    return null
  }

  let consumed = false
  return {
    async consume(stream: ReadableStream<UIMessageChunk>): Promise<void> {
      if (consumed) throw new Error("Retained stream already has a producer")
      consumed = true
      const reader = stream.getReader()
      let available = true
      let logBytes = baseBytes
      let pending: ReturnType<typeof reader.read> | undefined
      async function append(batch: string[]) {
        if (!available || batch.length === 0) return
        const batchBytes = batch.reduce(
          (sum, chunk) => sum + Buffer.byteLength(chunk),
          0
        )
        if (logBytes + batchBytes > MAX_LOG_BYTES) {
          available = false
          await finish("unavailable")
          return
        }
        try {
          available =
            (await client!.eval(APPEND, {
              keys: [key.metadata, key.events],
              arguments: [
                owner,
                String(batchBytes),
                String(MAX_LOG_BYTES),
                String(activeTtl),
                String(COMPLETED_TTL_SECONDS),
                ...batch,
              ],
            })) === 1
          logBytes += batchBytes
        } catch {
          available = false
          await finish("unavailable")
        }
      }
      async function finish(status: "finished" | "unavailable") {
        try {
          await client!.eval(FINISH, {
            keys: [key.metadata, key.events],
            arguments: [owner, status, String(COMPLETED_TTL_SECONDS)],
          })
        } catch {
          // Redis failure cannot abort the independently owned generation.
        }
      }
      try {
        let done = false
        while (!done) {
          const batch: string[] = []
          let bytes = 0
          let timer: ReturnType<typeof setTimeout> | undefined
          const deadline = new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), BATCH_INTERVAL_MS)
          })
          try {
            while (bytes < BATCH_BYTES) {
              pending ??= reader.read()
              // Wait for the first chunk without polling during model/tool pauses.
              const result =
                batch.length === 0
                  ? await pending
                  : await Promise.race([pending, deadline])
              if (result === null) break
              pending = undefined
              if (result.done) {
                done = true
                break
              }
              if (available) {
                const encoded = JSON.stringify(result.value)
                const encodedBytes = Buffer.byteLength(encoded)
                if (encodedBytes > MAX_RECORD_BYTES) {
                  available = false
                  await finish("unavailable")
                  continue
                }
                batch.push(encoded)
                bytes += encodedBytes
              }
            }
          } catch (error) {
            await append(batch)
            throw error
          } finally {
            clearTimeout(timer)
          }
          await append(batch)
        }
        if (available) await finish("finished")
      } catch {
        if (available) {
          await append([
            JSON.stringify({
              type: "error",
              errorText: "The response stream was interrupted.",
            }),
          ])
          await finish("finished")
        }
      } finally {
        reader.releaseLock()
      }
    },
  }
}

function compareCursors(left: string, right: string) {
  const [leftTime, leftSequence] = left.split("-").map(BigInt)
  const [rightTime, rightSequence] = right.split("-").map(BigInt)
  return leftTime === rightTime
    ? leftSequence < rightSequence
      ? -1
      : leftSequence > rightSequence
        ? 1
        : 0
    : leftTime < rightTime
      ? -1
      : 1
}

/** The route must authorize run ownership before opening this private replay. */
export async function readRetainedChatStream(
  runId: string,
  { after = "0-0", signal }: { after?: string; signal?: AbortSignal } = {}
): Promise<ReadableStream<Uint8Array> | null> {
  if (
    !retainedChatStreamCursorSchema.safeParse(after).success ||
    signal?.aborted
  )
    return null
  const url = redisUrl()
  if (!url) return null
  const client = newClient(url)
  const key = keys(runId)
  const close = () => {
    if (client.isOpen) client.destroy()
    signal?.removeEventListener("abort", close)
  }
  signal?.addEventListener("abort", close, { once: true })
  let base: UIMessage | undefined
  let highWater = "0-0"
  try {
    await client.connect()
    const metadata = metadataSchema.safeParse(
      await client.hGetAll(key.metadata)
    )
    if (
      !metadata.success ||
      metadata.data.status === "unavailable" ||
      signal?.aborted
    ) {
      close()
      return null
    }
    const parsed: unknown = JSON.parse(metadata.data.base)
    if (parsed !== null)
      [base] = await validateUIMessages({ messages: [parsed] })
    const latest = await client.xRevRange(key.events, "+", "-", { COUNT: 1 })
    highWater = latest[0]?.id ?? "0-0"
    if (compareCursors(after, highWater) > 0) {
      close()
      return null
    }
  } catch {
    close()
    return null
  }

  const encoder = new TextEncoder()
  let cursor = after
  let sentBase = false
  let caughtUp = false
  const queued: RetainedChatStreamFrame[] = []
  let ended = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!sentBase) {
          sentBase = true
          queued.push({
            type: "base",
            message: base,
            highWater,
          })
        }
        while (queued.length === 0 && !ended) {
          if (!caughtUp && compareCursors(cursor, highWater) >= 0) {
            caughtUp = true
            queued.push({ type: "caught-up" })
            break
          }
          const metadata = metadataSchema.safeParse(
            await client.hGetAll(key.metadata)
          )
          if (!metadata.success || metadata.data.status === "unavailable") {
            queued.push({ type: "unavailable" })
            ended = true
            break
          }
          // Completed logs never block. Active readers periodically check expiry.
          const result = await client.xRead(
            { key: key.events, id: cursor },
            metadata.data.status === "active"
              ? { COUNT: READ_COUNT, BLOCK: 1000 }
              : { COUNT: READ_COUNT }
          )
          const messages = result?.[0]?.messages ?? []
          for (const message of messages) {
            const chunk = await validateTypes({
              value: JSON.parse(message.message.chunk),
              schema: uiMessageChunkSchema,
            })
            queued.push({ type: "chunk", id: message.id, chunk })
            cursor = message.id
            if (!caughtUp && compareCursors(cursor, highWater) >= 0) {
              caughtUp = true
              queued.push({ type: "caught-up" })
            }
          }
          if (messages.length === 0 && metadata.data.status === "finished") {
            queued.push({ type: "end" })
            ended = true
          }
        }
        const frame = queued.shift()
        if (frame)
          controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
        if (ended && queued.length === 0) {
          close()
          controller.close()
        }
      } catch {
        close()
        if (ended) return
        ended = true
        if (!signal?.aborted)
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ type: "unavailable" })}\n`)
          )
        controller.close()
      }
    },
    cancel() {
      ended = true
      close()
    },
  })
}
