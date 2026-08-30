import { describe, expect, it } from "vitest"
import {
  buildCodePayload,
  buildCodeStressPayload,
  buildLongMarkdownPayload,
  buildManyShortBlocksPayload,
  buildShortProsePayload,
  buildMarkdownPayload,
  buildStreamScript,
  foldStreamScript,
  hashValue,
  type StreamChunkEvent,
} from "./fixtures"

// Payload hashes are pinned because baselines, reports, and the browser
// harness's oracle assume these bytes never drift. A fixture change must update
// this constant and every stored baseline together.
const PINNED_PAYLOAD_HASHES = {
  markdown: "f42a045150755c72",
  longMarkdown: "7eac4d6cfe004f8b",
  code: "14211443cdfb3464",
  codeStress: "8fe6b2d0232f534b",
  manyShortBlocks: "c26e29ecbbe52bd5",
  shortProse: "8ff1d190a914ef01",
} as const

describe("pinned payload hashes (cross-commit comparability)", () => {
  it("fixture payloads are byte-identical to the pinned baseline generation", () => {
    expect({
      markdown: hashValue(buildMarkdownPayload()),
      longMarkdown: hashValue(buildLongMarkdownPayload()),
      code: hashValue(buildCodePayload()),
      codeStress: hashValue(buildCodeStressPayload()),
      manyShortBlocks: hashValue(buildManyShortBlocksPayload()),
      shortProse: hashValue(buildShortProsePayload()),
    }).toEqual(PINNED_PAYLOAD_HASHES)
  })
})

describe("deterministic payloads", () => {
  it("keeps the Markdown payload inside the 8–15 KB window", () => {
    const bytes = Buffer.byteLength(buildMarkdownPayload(), "utf8")
    expect(bytes).toBeGreaterThanOrEqual(8 * 1024)
    expect(bytes).toBeLessThanOrEqual(15 * 1024)
  })

  it("keeps the code payload inside the 250–500 line window", () => {
    const lines = buildCodePayload().split("\n").length
    expect(lines).toBeGreaterThanOrEqual(250)
    expect(lines).toBeLessThanOrEqual(500)
    expect(buildCodePayload(300).split("\n")).toHaveLength(300)
  })

  it("keeps the short prose payload near 500 characters with no block markup", () => {
    const prose = buildShortProsePayload()
    expect(prose.length).toBeGreaterThanOrEqual(400)
    expect(prose.length).toBeLessThanOrEqual(650)
    expect(prose).not.toContain("\n")
    expect(prose).not.toContain("```")
  })

  it("keeps the long payload near 100 KB and ending in a short growing paragraph", () => {
    const long = buildLongMarkdownPayload()
    const bytes = Buffer.byteLength(long, "utf8")
    expect(bytes).toBeGreaterThanOrEqual(90 * 1024)
    expect(bytes).toBeLessThanOrEqual(115 * 1024)
    expect(long.endsWith("Short growing terminal paragraph under construction")).toBe(true)
    // The terminal paragraph is its own block: preceded by a blank line.
    expect(long).toContain("\n\nShort growing terminal paragraph")
  })

  it("builds many short completed blocks with a small mutable tail", () => {
    const payload = buildManyShortBlocksPayload()
    const blocks = payload.split("\n\n")
    expect(blocks.length).toBe(401)
    expect(blocks[blocks.length - 1]).toBe("Growing tail paragraph")
  })

  it("scales the code stress payload to ~4× the 400-line fixture", () => {
    expect(buildCodeStressPayload().split("\n")).toHaveLength(1600)
  })
})

describe("deterministic stream fixture", () => {
  it("stamps exact virtual chunk cadence at 10/30/100 chunks per second", () => {
    for (const rate of [10, 30, 100] as const) {
      const events = buildStreamScript({
        scenario: "text-only",
        chunksPerSecond: rate,
      })
      events.forEach((event, index) => {
        expect(event.sequence).toBe(index)
        expect(event.atMs).toBe(Math.round((index * 1000) / rate))
      })
    }
  })

  it("interleaves reasoning, text, sources, tools, approval, and continuation", () => {
    const events = buildStreamScript({
      scenario: "interleaved",
      chunksPerSecond: 30,
    })
    const types = new Set(events.map((event) => event.type))
    for (const required of [
      "reasoning-delta",
      "text-delta",
      "source",
      "tool-input",
      "tool-output",
      "approval-request",
      "approval-continuation",
      "finish",
    ]) {
      expect(types.has(required as StreamChunkEvent["type"]), required).toBe(
        true
      )
    }

    const folded = foldStreamScript(events)
    expect(folded.terminal).toBe("finish")
    expect(folded.text).toBe(buildMarkdownPayload())
    expect(folded.sources).toHaveLength(2)
    expect(folded.tools.map((tool) => tool.state)).toEqual([
      "output-available",
      "output-available",
    ])
    expect(folded.approvals).toEqual([
      { approvalId: "approval_1", toolCallId: "call_dynamic", state: "continued" },
    ])
    // Final folded output is reproducible — the equality baseline later
    // phases compare their candidate stream handling against.
    expect(hashValue(folded)).toBe(hashValue(foldStreamScript(events)))
  })

  it("preserves partial output for error and Stop terminals", () => {
    const errored = foldStreamScript(
      buildStreamScript({ scenario: "partial-error", chunksPerSecond: 100 })
    )
    expect(errored.terminal).toBe("error")
    expect(errored.errorMessage).toBe("provider_stream_interrupted")
    expect(errored.text.length).toBeGreaterThan(0)

    const stopped = foldStreamScript(
      buildStreamScript({ scenario: "stop-during-text", chunksPerSecond: 100 })
    )
    expect(stopped.terminal).toBe("abort")
    expect(stopped.text).toBe(
      buildMarkdownPayload().slice(
        0,
        Math.floor(buildMarkdownPayload().length / 2)
      )
    )
  })

  it("fails loudly on missing, duplicated, reordered, or post-terminal chunks", () => {
    const events = buildStreamScript({
      scenario: "text-only",
      chunksPerSecond: 30,
    })

    const dropped = [...events.slice(0, 3), ...events.slice(4)]
    expect(() => foldStreamScript(dropped)).toThrow(/sequence violation/)

    const duplicated = [...events.slice(0, 4), events[3]!, ...events.slice(4)]
    expect(() => foldStreamScript(duplicated)).toThrow(/sequence violation/)

    const reordered = [...events]
    ;[reordered[2], reordered[3]] = [reordered[3]!, reordered[2]!]
    expect(() => foldStreamScript(reordered)).toThrow(/sequence violation/)

    const afterTerminal: StreamChunkEvent[] = [
      ...events,
      {
        sequence: events.length,
        atMs: events[events.length - 1]!.atMs + 1,
        type: "text-delta",
        delta: "late",
      },
    ]
    expect(() => foldStreamScript(afterTerminal)).toThrow(/after terminal/)

    expect(() => foldStreamScript(events.slice(0, -1))).toThrow(
      /without a terminal/
    )
  })
})
