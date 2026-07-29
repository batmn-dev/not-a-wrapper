import { describe, expect, it } from "vitest"
import type { TextStreamPart, ToolSet } from "ai"
import {
  createWordChunkingTransform,
  splitIntoWordChunks,
} from "./word-chunking-transform"

type Part = TextStreamPart<ToolSet>

function makeTransform() {
  return createWordChunkingTransform<ToolSet>()({
    tools: {},
    stopStream: () => undefined,
  })
}

/** Write all parts, close, and collect every output with arrival times. */
async function run(parts: Part[]) {
  const transform = makeTransform()
  const writer = transform.writable.getWriter()
  const outputs: { part: Part; atMs: number }[] = []
  const start = Date.now()
  const readAll = (async () => {
    const reader = transform.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      outputs.push({ part: value, atMs: Date.now() - start })
    }
  })()
  for (const part of parts) await writer.write(part)
  await writer.close()
  await readAll
  return outputs
}

const textDelta = (text: string, id = "t1"): Part => ({
  type: "text-delta",
  id,
  text,
})

describe("splitIntoWordChunks", () => {
  it("splits on whitespace with concatenation identity", () => {
    const text = "one  two\nthree,   four. "
    const chunks = splitIntoWordChunks(text)
    expect(chunks.join("")).toBe(text)
    expect(chunks.length).toBeGreaterThan(3)
  })
})

describe("createWordChunkingTransform", () => {
  it("passes word-granular deltas through untouched and in order", async () => {
    const parts = [textDelta("Hello "), textDelta("world.")]
    const outputs = await run(parts)
    expect(outputs.map((o) => o.part)).toEqual(parts)
  })

  it("splits an oversized slab into word deltas with exact content and identity fields", async () => {
    const slab =
      "The quick brown fox jumps over the lazy dog while the moon rises slowly."
    const outputs = await run([textDelta(slab, "block-9")])
    const texts = outputs.map((o) => (o.part as { text: string }).text)
    expect(texts.join("")).toBe(slab)
    expect(outputs.length).toBeGreaterThan(5)
    for (const { part } of outputs) {
      expect(part.type).toBe("text-delta")
      expect((part as { id: string }).id).toBe("block-9")
    }
  })

  it("leaves oversized non-text parts (reasoning deltas) untouched", async () => {
    const reasoning = {
      type: "reasoning-delta",
      id: "r1",
      text: "x".repeat(500),
    } as Part
    const outputs = await run([reasoning])
    expect(outputs).toHaveLength(1)
    expect(outputs[0].part).toBe(reasoning)
  })

  it("preserves part order: a tool part never overtakes a draining slab", async () => {
    const slabText = "alpha beta gamma delta epsilon zeta eta theta iota kappa"
    const toolPart = { type: "tool-call", toolCallId: "c1" } as unknown as Part
    const outputs = await run([textDelta(slabText), toolPart])
    expect(outputs[outputs.length - 1].part).toBe(toolPart)
    const texts = outputs
      .slice(0, -1)
      .map((o) => (o.part as { text: string }).text)
    expect(texts.join("")).toBe(slabText)
  })

  it("bounds total added latency below one spread budget even for large slabs", async () => {
    // A same-instant slab (no prior gap) must drain within the MIN_SPREAD
    // floor plus slack — the bounded-lag guarantee, not a fixed per-word tax.
    const slab = textDelta(Array.from({ length: 120 }, () => "word").join(" "))
    const outputs = await run([slab])
    expect(outputs.length).toBeGreaterThan(100)
    const lastAt = outputs[outputs.length - 1].atMs
    expect(lastAt).toBeLessThan(500)
  })

  it("stops emitting promptly when the stream is cancelled mid-slab", async () => {
    const transform = makeTransform()
    const writer = transform.writable.getWriter()
    const reader = transform.readable.getReader()
    const slab = textDelta(
      Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ")
    )
    // Force pacing: a prior gap makes the spread budget non-trivial.
    void writer.write(textDelta("tiny"))
    await reader.read()
    await new Promise((resolve) => setTimeout(resolve, 120))
    const writePromise = writer.write(slab).catch(() => undefined)
    await reader.read() // first word emitted, slab is draining
    await reader.cancel()
    // The abandoned write settles instead of hanging on orphaned timers.
    await expect(
      Promise.race([
        writePromise.then(() => "settled"),
        new Promise((resolve) => setTimeout(() => resolve("hung"), 400)),
      ])
    ).resolves.toBe("settled")
  })
})
