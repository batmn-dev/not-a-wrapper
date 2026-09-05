import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  compareResults,
  resultContract,
  scenarioKey,
  validateCoverage,
  type ComparableResult,
} from "./result-contract"
import { summarize } from "./result-schema"

function result(): ComparableResult {
  const ui = {
    inputToOptimisticFrameMs: [40],
    inputToFirstTextFrameMs: [200],
    terminalToReadyFrameMs: [20],
  }
  return {
    schemaVersion: 2,
    measurementVersion: "dom-frame-v2",
    identityProtocol: "ci-isolated-v1",
    buildClass: "production",
    instrumentationBuild: true,
    machineClass: "linux-x64",
    cpuModel: "test-cpu",
    cpuCount: 4,
    memoryGb: 8,
    browserVersion: "151.0",
    fixtureHash: "fixture",
    suite: "smoke",
    scenarios: [
      {
        id: "text-fixed",
        scenario: "text-only",
        directive: "[[perf:text-only:30:fixed]]",
        viewport: "desktop",
        cpuThrottle: 1,
        network: "unthrottled",
        cache: "warm",
        auth: true,
        followup: false,
        action: "complete",
        sampleCount: 5,
        warmupRuns: 1,
        correctnessOk: true,
        metrics: Object.fromEntries(
          Object.entries(ui).map(([key, values]) => [
            key,
            summarize(Array(5).fill(values[0])),
          ])
        ),
        runs: Array.from({ length: 5 }, () => ({
          correctness: { ok: true },
          hiddenDuringMeasurement: false,
          pendingDeltaSamples: 0,
          droppedUiSamples: 0,
          ui: structuredClone(ui),
        })),
      },
    ],
  }
}

function threadResult(): ComparableResult {
  const value = result()
  value.suite = "thread-switch"
  value.scenarios = []
  value.threadSwitch = {
    correctnessOk: true,
    chatCount: 2,
    switchCount: 5,
    hoverMs: 250,
    documents: 5,
    heapSamples: [
      { switches: 0, jsHeapUsedBytes: 1000 },
      { switches: 5, jsHeapUsedBytes: 1100 },
    ],
    passes: (["unvisited-click", "unvisited-hover", "visited"] as const).map(
      (kind) => ({
        kind,
        switches: 5,
        samples: Array.from({ length: 5 }, (_, index) => ({
          navToPaintedMs: 40,
          intentToCommitMs: 10,
          commitToFirstContentMs: 5,
          firstContentToPaintedMs: 25,
          cache: index === 0 ? undefined : ("hit" as const),
          querySetAdds: 2,
          ok: true as const,
        })),
        navToThreadPaintedMs: summarize(Array(5).fill(40)),
        intentToRouteCommitMs: summarize(Array(5).fill(10)),
        commitToFirstContentMs: summarize(Array(5).fill(5)),
        firstContentToPaintedMs: summarize(Array(5).fill(25)),
        querySetAddsPerSwitch: summarize(Array(5).fill(2)),
        cacheHits: 4,
        cacheMisses: 0,
      })
    ),
  }
  return value
}

describe("performance evidence contract", () => {
  it("the CLI fails instead of reporting success when its baseline is absent", () => {
    const directory = mkdtempSync(join(tmpdir(), "chat-perf-contract-"))
    try {
      const current = join(directory, "current.json")
      writeFileSync(current, JSON.stringify(result()))
      const command = spawnSync(
        "bun",
        [
          "run",
          "benchmarks/chat-performance/browser/compare-results.ts",
          join(directory, "absent.json"),
          current,
        ],
        { encoding: "utf8" }
      )
      expect(command.status).toBe(1)
      expect(command.stderr).toContain(
        "Performance regression protection is NOT armed"
      )
    } finally {
      rmSync(directory, { recursive: true })
    }
  })
  it("accepts comparable, complete observations", () => {
    expect(resultContract.safeParse(result()).success).toBe(true)
    expect(compareResults(result(), result())).toEqual([])
  })

  it("preserves warmup counts and rejects incompatible warmup protocols", () => {
    const base = resultContract.parse(result())
    const current = result()
    current.scenarios[0].warmupRuns = 0
    expect(base.scenarios[0].warmupRuns).toBe(1)
    expect(compareResults(base, resultContract.parse(current))).toEqual([
      `${scenarioKey(base.scenarios[0])}: warmupRuns mismatch`,
    ])
  })

  it("rejects partial gated observations even when their summaries agree", () => {
    const scalar = result()
    scalar.scenarios[0].runs[0].totalBlockingTimeMs = 10
    scalar.scenarios[0].metrics.totalBlockingTimeMs = summarize([10])
    expect(validateCoverage(scalar)).toEqual([
      "text-fixed: totalBlockingTimeMs missing from an individual run",
    ])
    const ui = result()
    ui.scenarios[0].runs[0].ui!.menuToFrameMs = [30]
    ui.scenarios[0].metrics.menuToFrameMs = summarize([30])
    expect(validateCoverage(ui)).toEqual([
      "text-fixed: menuToFrameMs missing from an individual run",
    ])
  })

  it("distinguishes delivery shapes and never overwrites a baseline", () => {
    const base = result()
    const slab = structuredClone(base.scenarios[0])
    slab.id = "text-slab"
    slab.directive = "[[perf:text-only:30:slab]]"
    slab.metrics.inputToFirstTextFrameMs = summarize(Array(5).fill(4000))
    base.scenarios.push(slab)
    const current = structuredClone(base)
    current.scenarios[0].metrics.inputToFirstTextFrameMs = summarize(
      Array(5).fill(800)
    )
    expect(scenarioKey(base.scenarios[0])).not.toBe(scenarioKey(slab))
    expect(compareResults(base, current).join(" ")).toContain("200 → 800")
    current.scenarios.push(structuredClone(current.scenarios[0]))
    expect(validateCoverage(current)).toContain("duplicate scenario identity")
  })

  it("fails missing scenarios, missing observations, and environment drift", () => {
    const current = result()
    current.browserVersion = "152.0"
    current.identityProtocol = "attached-session-v1"
    current.scenarios[0].metrics.inputToFirstTextFrameMs = summarize([])
    expect(compareResults(result(), current).join(" ")).toMatch(
      /missing samples/
    )
    expect(compareResults(result(), current).join(" ")).toMatch(
      /browserVersion mismatch/
    )
    expect(compareResults(result(), current).join(" ")).toContain(
      "identityProtocol mismatch"
    )
    current.scenarios = []
    expect(compareResults(result(), current).join(" ")).toMatch(
      /scenario missing/
    )
    expect(resultContract.safeParse(current).success).toBe(false)
  })

  it("does not let a slow baseline normalize a failed feedback budget", () => {
    const slow = result()
    slow.scenarios[0].runs.forEach((run) => {
      run.ui!.inputToOptimisticFrameMs = [500]
    })
    slow.scenarios[0].metrics.inputToOptimisticFrameMs = summarize(
      Array(5).fill(500)
    )
    expect(validateCoverage(slow)).toEqual([])
    expect(compareResults(slow, slow).join(" ")).toContain("5/5 exceed 100ms")
  })

  it("rejects failures and malformed numbers rather than dropping them", () => {
    const invalid = result()
    invalid.scenarios[0].metrics.inputToFirstTextFrameMs.p50 = NaN
    expect(resultContract.safeParse(invalid).success).toBe(false)
    expect(
      resultContract.safeParse({ ...result(), schemaVersion: 1 }).success
    ).toBe(false)
    expect(() => summarize([1, NaN])).toThrow()
    expect(summarize([-1]).p50).toBe(-1) // DOM growth is a signed count.
  })

  it("keeps sample counts honest and withholds p95 for small runs", () => {
    expect(summarize(Array(10).fill(20))).not.toHaveProperty("p95")
    expect(summarize(Array(20).fill(20))).toHaveProperty("p95", 20)
    const invalid = result()
    invalid.scenarios[0].runs.pop()
    expect(resultContract.safeParse(invalid).success).toBe(false)
    const missingP95 = result()
    missingP95.scenarios[0].metrics.inputToFirstTextFrameMs.n = 20
    expect(resultContract.safeParse(missingP95).success).toBe(false)
  })

  it("rejects summaries that conceal the raw observations", () => {
    const current = result()
    current.scenarios[0].runs[0].ui!.inputToFirstTextFrameMs = [5000]
    expect(validateCoverage(current).join(" ")).toContain(
      "summary disagrees with raw samples"
    )
  })

  it("rejects unfinished rendering samples in completed turns", () => {
    const current = result()
    current.scenarios[0].runs[0].pendingDeltaSamples = 1
    expect(validateCoverage(current).join(" ")).toContain(
      "never observed rendering"
    )
  })

  it.each([
    ["sendToFirstVisibleTextMs", { sendToFirstVisibleTextMs: 4000 }],
    ["totalBlockingTimeMs", { totalBlockingTimeMs: 4000 }],
    ["reloadToAuthoritativeMs", { reloadToAuthoritativeMs: 4000 }],
    ["prepareMs", { timingReceipt: { prepareMs: 4000 } }],
    ["firstWriteDelayMs", { timingReceipt: { firstWriteDelayMs: 4000 } }],
    [
      "pacingOverheadMs",
      {
        timingReceipt: {
          wireStreamMs: 4100,
          modelResponseMs: 200,
          providerFirstOutputMs: 100,
          toolExecutionMs: 0,
        },
      },
    ],
    ["settlementTotalMs", { serverSpans: { settlement_total: 4000 } }],
  ])("checks %s against its raw observations", (metric, raw) => {
    const current = result()
    current.scenarios[0].runs.forEach((run) => Object.assign(run, raw))
    current.scenarios[0].metrics[metric] = summarize(Array(5).fill(40))
    expect(validateCoverage(resultContract.parse(current)).join(" ")).toContain(
      `${metric} summary disagrees`
    )
    current.scenarios[0].metrics[metric] = summarize(Array(5).fill(4000))
    expect(validateCoverage(resultContract.parse(current))).toEqual([])
  })

  it("rejects gated summaries with no raw observation", () => {
    const current = result()
    current.scenarios[0].metrics.reloadToAuthoritativeMs = summarize(
      Array(5).fill(40)
    )
    expect(validateCoverage(current).join(" ")).toContain(
      "reloadToAuthoritativeMs summary disagrees"
    )
    current.scenarios[0].metrics.menuToFrameMs = summarize(Array(5).fill(40))
    expect(validateCoverage(current).join(" ")).toContain(
      "menuToFrameMs summary disagrees"
    )
    current.scenarios[0].runs[0].totalBlockingTimeMs = NaN
    expect(resultContract.safeParse(current).success).toBe(false)
  })

  it("preserves complete thread-switch evidence and checks all summaries", () => {
    const current = threadResult()
    expect(resultContract.parse(current).threadSwitch).toEqual(
      current.threadSwitch
    )
    expect(validateCoverage(current)).toEqual([])
    for (const field of [
      "navToThreadPaintedMs",
      "intentToRouteCommitMs",
      "commitToFirstContentMs",
      "firstContentToPaintedMs",
      "querySetAddsPerSwitch",
    ] as const) {
      const invalid = threadResult()
      invalid.threadSwitch!.passes[0][field].p50 = 9000
      expect(validateCoverage(invalid).join(" ")).toContain(
        `${field} summary disagrees`
      )
    }
    current.threadSwitch!.passes[0].cacheHits = 5
    expect(validateCoverage(current).join(" ")).toContain(
      "cache counts disagree"
    )
    current.threadSwitch!.heapSamples[0].jsHeapUsedBytes = -1
    expect(resultContract.safeParse(current).success).toBe(false)
  })

  it("rejects an undersampled visited pass and invalid heap checkpoints", () => {
    const current = threadResult()
    current.threadSwitch!.switchCount = 50
    expect(validateCoverage(current).join(" ")).toContain(
      "visited count differs"
    )
    current.threadSwitch!.heapSamples.push({
      switches: 51,
      jsHeapUsedBytes: 2000,
    })
    expect(validateCoverage(current).join(" ")).toContain("heap checkpoints")
  })

  it("allows only the signed terminal-to-receipt ordering offset to be negative", () => {
    const current = result()
    current.scenarios[0].runs.forEach((run) => {
      run.terminalToSettlementReceiptMs = -25
    })
    current.scenarios[0].metrics.terminalToSettlementReceiptMs = summarize(
      Array(5).fill(-25)
    )
    expect(validateCoverage(resultContract.parse(current))).toEqual([])
    current.scenarios[0].metrics.otherDurationMs = summarize(Array(5).fill(-25))
    expect(validateCoverage(current).join(" ")).toContain(
      "otherDurationMs has a negative duration"
    )
  })

  it("requires Stop feedback without inventing a received terminal event", () => {
    const current = result()
    current.scenarios[0].action = "stop"
    delete current.scenarios[0].metrics.terminalToReadyFrameMs
    current.scenarios[0].metrics.stopToReadyFrameMs = summarize(
      Array(5).fill(40)
    )
    current.scenarios[0].runs.forEach((run) => {
      delete run.ui!.terminalToReadyFrameMs
      run.ui!.stopToReadyFrameMs = [40]
      run.stopSourceLengths = { atReady: 100, after250Ms: 80, afterSettlement: 60 }
    })
    expect(validateCoverage(current)).toEqual([])
    current.scenarios[0].runs[0].stopSourceLengths!.afterSettlement = 90
    expect(validateCoverage(current).join(" ")).toContain("text grew after Stop")
    delete current.scenarios[0].runs[0].stopSourceLengths
    expect(validateCoverage(current).join(" ")).toContain("Stop stability observations are missing")
  })
})
