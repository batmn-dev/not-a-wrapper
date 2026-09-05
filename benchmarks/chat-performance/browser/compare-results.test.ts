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
    measurementVersion: "dom-frame-v1",
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
    current.scenarios[0].metrics.inputToFirstTextFrameMs = summarize([])
    expect(compareResults(result(), current).join(" ")).toMatch(
      /missing samples/
    )
    expect(compareResults(result(), current).join(" ")).toMatch(
      /browserVersion mismatch/
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
      run.ui = { inputToOptimisticFrameMs: [500] }
    })
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
})
