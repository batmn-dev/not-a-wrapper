import { describe, expect, it } from "vitest"
import {
  assertProjectionEquivalence,
  buildCodePayload,
  buildDeterministicBranchTree,
  buildMarkdownPayload,
  buildRandomBranchTree,
  buildRandomBranchTreeSeeds,
  buildStreamScript,
  createSeededRandom,
  currentBranchImplementation,
  foldStreamScript,
  hashValue,
  NAMED_BRANCH_FIXTURES,
  projectionHash,
  type StreamChunkEvent,
} from "./fixtures"

describe("seeded reproducibility", () => {
  it("produces identical random sequences for the same seed", () => {
    const a = createSeededRandom(42)
    const b = createSeededRandom(42)
    const c = createSeededRandom(43)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    const seqC = Array.from({ length: 20 }, () => c())
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual(seqC)
  })

  it("rebuilds byte-identical branch trees per seed", () => {
    for (const seed of buildRandomBranchTreeSeeds(10)) {
      expect(hashValue(buildRandomBranchTree(seed))).toBe(
        hashValue(buildRandomBranchTree(seed))
      )
    }
  })

  it("keeps deterministic tree row counts and stable projection hashes", () => {
    const tree575 = buildDeterministicBranchTree(575)
    const tree1150 = buildDeterministicBranchTree(1150)
    expect(tree575).toHaveLength(575)
    expect(tree1150).toHaveLength(1150)
    // Reproducibility gate: rebuilding must reproduce the exact projection.
    expect(projectionHash(currentBranchImplementation.project(tree575))).toBe(
      projectionHash(
        currentBranchImplementation.project(buildDeterministicBranchTree(575))
      )
    )
  })
})

describe("branch projection equivalence harness", () => {
  const randomSeeds = buildRandomBranchTreeSeeds(200)

  it("projects every named fixture and stays reproducible", () => {
    for (const [name, build] of Object.entries(NAMED_BRANCH_FIXTURES)) {
      const first = assertProjectionEquivalence(
        [currentBranchImplementation],
        build(),
        name
      )
      const second = assertProjectionEquivalence(
        [currentBranchImplementation],
        build(),
        name
      )
      expect(second, name).toBe(first)
    }
  })

  it("projects at least 200 seeded randomized trees without divergence or hangs", () => {
    for (const seed of randomSeeds) {
      const tree = buildRandomBranchTree(seed)
      const first = assertProjectionEquivalence(
        [currentBranchImplementation],
        tree,
        `seed ${seed}`
      )
      expect(
        assertProjectionEquivalence(
          [currentBranchImplementation],
          buildRandomBranchTree(seed),
          `seed ${seed}`
        )
      ).toBe(first)
    }
  })

  it("fails loudly when implementations diverge", () => {
    const broken = {
      name: "broken",
      project: (messages: Parameters<typeof currentBranchImplementation.project>[0]) => {
        const projection = currentBranchImplementation.project(messages)
        return { ...projection, selectedPath: projection.selectedPath.slice(1) }
      },
    }
    expect(() =>
      assertProjectionEquivalence(
        [currentBranchImplementation, broken],
        buildDeterministicBranchTree(575),
        "broken-comparison"
      )
    ).toThrow(/mismatch/)
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
