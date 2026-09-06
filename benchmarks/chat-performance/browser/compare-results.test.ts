import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  compareResults,
  assessComparison,
  checkBudgets,
  resultContract,
  scenarioKey,
  validateCoverage,
  type ComparableResult,
} from "./result-contract"
import { summarize } from "./result-schema"
import { directiveFor, DURABLE_SUITE, RESPONSIVENESS_SUITE, SMOKE_SUITE, STANDARD_SUITE } from "./scenarios"

const SUITES = {
  smoke: SMOKE_SUITE,
  standard: STANDARD_SUITE,
  durable: DURABLE_SUITE,
  responsiveness: RESPONSIVENESS_SUITE,
}

function result(suite: keyof typeof SUITES = "smoke"): ComparableResult {
  return {
    schemaVersion: 3,
    measurementVersion: "dom-frame-v3",
    typingCadenceMs: 40,
    replayPolicy: "disabled-v1",
    identityProtocol: "ci-isolated-v1",
    accountReadinessProtocol: "matching-account-v1",
    buildClass: "production",
    instrumentationBuild: true,
    machineClass: "linux-x64",
    cpuModel: "test-cpu",
    cpuCount: 4,
    memoryGb: 8,
    browserVersion: "151.0",
    fixtureHash: "fixture",
    suite,
    scenarios: SUITES[suite].map((config) => {
      const ui: Record<string, number[]> = {
        inputToOptimisticFrameMs: [40],
        inputToFirstTextFrameMs: [200],
        deltaToContentFrameMs: [20],
      }
      if (config.action === "complete") ui.terminalToReadyFrameMs = [20]
      if (config.action === "stop") ui.stopToReadyFrameMs = [40]
      if (config.scenario === "mixed-markdown") ui.inputToFirstActivityFrameMs = [80]
      if (suite === "responsiveness") {
        ui.navigationToComposerInputMs = [100]
        ui.navigationToSendControlEnabledMs = [100]
        ui.navigationToSendReadyMs = [100]
      }
      if (config.interact) {
        for (const metric of ["typingToFrame", "menuToFrame", "deltaToContentFrame"])
          for (const phase of ["", "Early", "Late"])
            ui[`${metric}${phase}Ms`] = [20]
      }
      return {
        ...config,
        directive: directiveFor(config),
        network: config.network ?? "unthrottled",
        cache: config.cache ?? "warm",
        auth: config.auth ?? false,
        followup: config.followup ?? false,
        contentFrameProtocol: "publisher-frame-v1",
        wheelProtocol: config.interact ? "native-browser-presentation-v2" : undefined,
        menuProtocol: config.interact ? "activation-v1" : undefined,
        interactionProtocol: config.interact ? "late-typing-native-wheel-menu-v2" : undefined,
        sampleCount: 5,
        warmupRuns: 1,
        correctnessOk: true,
        metrics: Object.fromEntries(
          Object.entries({ ...ui, ...(config.interact ? {
            scrollInputToPresentationMs: [25], scrollAutomationDispatchMs: [5], scrollBrowserToPresentationMs: [20],
          } : {}), ...(config.action === "reload" ? { reloadToAuthoritativeMs: [40] } : {}) })
            .map(([key, values]) => [key, summarize(Array(5).fill(values[0]))])
        ),
        runs: Array.from({ length: 5 }, () => ({
          correctness: { ok: true, ...(config.action === "stop" ? { settlementOutcome: "aborted" } : {}) },
          hiddenDuringMeasurement: false,
          pendingDeltaSamples: 0,
          droppedUiSamples: 0,
          ...(config.interact ? {
            scrollInputToPresentationMs: 25, scrollAutomationDispatchMs: 5, scrollBrowserToPresentationMs: 20,
          } : {}),
          ...(config.action === "stop" ? { stopSourceLengths: { atReady: 100, after250Ms: 80, afterSettlement: 60 } } : {}),
          ...(config.action === "reload" ? { reloadToAuthoritativeMs: 40 } : {}),
          ui: structuredClone(ui),
        })),
      }
    }),
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
  it("separates valid slow collection, actual regression, targets, and unavailable comparisons", () => {
    const directory = mkdtempSync(join(tmpdir(), "chat-perf-policy-"))
    try {
      const baseline = join(directory, "baseline.json")
      const current = join(directory, "current.json")
      const slow = result()
      const setLatency = (value: ComparableResult, ms: number) => {
        value.scenarios[0].runs.forEach((run) => { run.ui!.inputToOptimisticFrameMs = [ms] })
        value.scenarios[0].metrics.inputToOptimisticFrameMs = summarize(Array(5).fill(ms))
      }
      setLatency(slow, 500)
      writeFileSync(baseline, JSON.stringify(slow))
      writeFileSync(current, JSON.stringify(slow))
      const run = (path: string, regressionOnly = true) => spawnSync("bun", [
        "run", "benchmarks/chat-performance/browser/compare-results.ts",
        ...(regressionOnly ? ["--regression-only"] : []), path, current,
      ], { encoding: "utf8" })
      const collected = run("--collect-baseline")
      expect(collected.status).toBe(0)
      expect(collected.stdout).toContain("relative regression: NOT EVALUATED")
      expect(collected.stdout).toContain("responsiveness targets: FAIL")
      expect(run("--collect-baseline", false).status).toBe(1)
      const compared = run(baseline)
      expect(compared.status).toBe(0)
      expect(compared.stdout).toContain("relative regression: PASS")
      expect(compared.stdout).toContain("responsiveness targets: FAIL")
      expect(run(baseline, false).status).toBe(1)

      const worse = structuredClone(slow)
      setLatency(worse, 800)
      writeFileSync(current, JSON.stringify(worse))
      const regressed = run(baseline)
      expect(regressed.status).toBe(1)
      expect(regressed.stdout).toContain("relative regression: FAIL")
      const withinTarget = result()
      setLatency(withinTarget, 80)
      const report = assessComparison(result(), withinTarget)
      expect(report.targetFailures).toEqual([])
      expect(report.regressions?.join(" ")).toContain("40 → 80ms")

      writeFileSync(current, JSON.stringify(result()))
      const absent = run(join(directory, "absent.json"))
      expect(absent.status).toBe(1)
      expect(absent.stdout).toContain("relative regression: NOT EVALUATED")
      expect(absent.stdout).toContain("responsiveness targets: PASS")
      slow.cpuModel = "different-cpu"
      writeFileSync(baseline, JSON.stringify(slow))
      const mismatched = run(baseline)
      expect(mismatched.status).toBe(1)
      expect(mismatched.stdout).toContain("relative regression: NOT EVALUATED")
      writeFileSync(baseline, "{}")
      expect(run(baseline).status).toBe(1)
      const incomplete = result()
      incomplete.scenarios.pop()
      writeFileSync(current, JSON.stringify(incomplete))
      expect(run("--collect-baseline").status).toBe(1)
      expect(assessComparison(result(), incomplete).regressions).toBeNull()
      writeFileSync(current, JSON.stringify(threadResult()))
      expect(run("--collect-baseline").stdout).toContain("responsiveness targets: NOT APPLICABLE")
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it("selects one exact environment from a directory and rejects missing, duplicate, or invalid candidates", () => {
    const directory = mkdtempSync(join(tmpdir(), "chat-perf-baselines-"))
    try {
      const baselines = join(directory, "baselines")
      mkdirSync(baselines)
      const current = join(directory, "current.json")
      writeFileSync(current, JSON.stringify(result()))
      const compare = (path = baselines) => spawnSync("bun", [
        "run", "benchmarks/chat-performance/browser/compare-results.ts", path, current,
      ], { encoding: "utf8" })
      const otherCpu = result()
      otherCpu.cpuModel = "another-cpu"
      writeFileSync(join(baselines, "other.json"), JSON.stringify(otherCpu))
      const missing = compare()
      expect(missing.status).toBe(1)
      expect(missing.stderr).toContain("No matching baseline")

      const matching = join(baselines, "matching.json")
      writeFileSync(matching, JSON.stringify(result()))
      const selected = compare()
      expect(selected.status).toBe(0)
      expect(selected.stdout).toContain(`selected baseline: ${matching}`)
      expect(compare(matching).status).toBe(0)

      const duplicate = join(baselines, "duplicate.json")
      writeFileSync(duplicate, JSON.stringify(result()))
      const ambiguous = compare()
      expect(ambiguous.status).toBe(1)
      expect(ambiguous.stderr).toContain("Multiple matching baselines")

      writeFileSync(duplicate, "{}")
      const invalid = compare()
      expect(invalid.status).toBe(1)
      expect(invalid.stderr).toContain(`Invalid baseline ${duplicate}`)
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

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

  it.each(["smoke", "standard", "durable", "responsiveness"] as const)("requires the exact complete %s suite", (suite) => {
    const complete = resultContract.parse(result(suite))
    expect(validateCoverage(complete)).toEqual([])
    const partial = structuredClone(complete)
    partial.scenarios.pop()
    expect(validateCoverage(partial)).toContain(`${suite} suite is incomplete or has unexpected scenarios`)
    const mislabeled = structuredClone(complete)
    mislabeled.scenarios[0].auth = !mislabeled.scenarios[0].auth
    expect(validateCoverage(mislabeled)).toContain(`${suite} suite is incomplete or has unexpected scenarios`)
  })

  it.each(["smoke", "standard", "durable", "responsiveness"] as const)("rejects missing transport delta observations in every %s scenario", (suite) => {
    const complete = result(suite)
    expect(validateCoverage(complete)).toEqual([])
    for (const scenario of complete.scenarios) {
      const missing = structuredClone(complete)
      const changed = missing.scenarios.find((value) => value.id === scenario.id)!
      delete changed.metrics.deltaToContentFrameMs
      for (const run of changed.runs) delete run.ui!.deltaToContentFrameMs
      expect(validateCoverage(missing)).toContain(
        `${scenario.id}: deltaToContentFrameMs missing samples (0/5)`
      )
    }
  })

  it("rejects unknown suite names and scenarios attached to thread-switch", () => {
    expect(validateCoverage({ ...result(), suite: "custom" })).toContain("unknown benchmark suite: custom")
    const mixed = threadResult()
    mixed.scenarios = result().scenarios
    expect(validateCoverage(mixed)).toContain("thread-switch suite is incomplete or has unexpected scenarios")
  })

  it.each([undefined, "production-sampled"])("rejects an unverified replay policy (%s)", (replayPolicy) => {
    expect(resultContract.safeParse({ ...result(), replayPolicy }).success).toBe(false)
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
      "text-only-30-fixed: totalBlockingTimeMs missing from an individual run",
    ])
    const ui = result()
    ui.scenarios[0].runs[0].ui!.menuToFrameMs = [30]
    ui.scenarios[0].metrics.menuToFrameMs = summarize([30])
    expect(validateCoverage(ui)).toEqual([
      "text-only-30-fixed: menuToFrameMs missing from an individual run",
    ])
  })

  it("distinguishes delivery shapes and never overwrites a baseline", () => {
    const base = result("standard")
    const slab = base.scenarios.find((scenario) => scenario.id === "mixed-markdown-30-slab")!
    const current = structuredClone(base)
    current.scenarios[1].metrics.inputToFirstTextFrameMs = summarize(
      Array(5).fill(800)
    )
    current.scenarios[1].runs.forEach((run) => { run.ui!.inputToFirstTextFrameMs = [800] })
    expect(scenarioKey(base.scenarios[1])).not.toBe(scenarioKey(slab))
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

  it.each(["typingToFrame", "deltaToContentFrame", "menuToFrame"])("does not let overall samples dilute a slow late %s phase", (metric) => {
    const current = result("responsiveness")
    const scenario = current.scenarios.find((value) => value.id === "interact-long-answer")!
    scenario.runs.forEach((run) => {
      run.ui![`${metric}Ms`] = [...Array(39).fill(20), 120]
      run.ui![`${metric}LateMs`] = [20, 20, 20, 120]
    })
    for (const suffix of ["Ms", "LateMs"])
      scenario.metrics[`${metric}${suffix}`] = summarize(scenario.runs.flatMap((run) => run.ui![`${metric}${suffix}`]))
    expect(validateCoverage(current)).toEqual([])
    const failures = checkBudgets(current)
    expect(failures.some((failure) => failure.includes(`${metric}Ms:`))).toBe(false)
    expect(failures).toContain(
      `interact-long-answer ${metric}LateMs: 5/20 exceed ${metric === "menuToFrame" ? 100 : 50}ms (budget: at most 5%)`
    )
  })

  it("rejects wheel captures without matching native presentation evidence", () => {
    const before = result("responsiveness")
    const current = result("responsiveness")
    delete before.scenarios[3].wheelProtocol
    expect(compareResults(before, current).join(" ")).toContain("scenario missing")
    before.scenarios[3].wheelProtocol = "native-browser-presentation-v2"
    expect(compareResults(before, current)).toEqual([])
  })

  it.each([
    "scrollInputToPresentationMs", "scrollAutomationDispatchMs", "scrollBrowserToPresentationMs",
  ] as const)("requires per-run %s samples and matching aggregates", (metric) => {
    const current = result("responsiveness")
    const scenario = current.scenarios.find((value) => value.wheelProtocol)!
    expect(validateCoverage(current)).toEqual([]) // No DOM scroll proxy is required.
    const sample = scenario.runs[0][metric]!
    delete scenario.runs[0][metric]
    scenario.metrics[metric] = summarize(Array(4).fill(sample))
    expect(validateCoverage(current).join(" ")).toContain(`${metric} missing`)
    scenario.runs[0][metric] = 80
    scenario.metrics[metric] = summarize(Array(5).fill(sample))
    expect(validateCoverage(current).join(" ")).toContain(`${metric} summary disagrees`)
    scenario.runs.forEach((run) => { delete run[metric] })
    delete scenario.metrics[metric]
    expect(validateCoverage(current).join(" ")).toContain(`${metric} missing`)
  })

  it.each([0, -1, NaN, Infinity])("rejects invalid native scroll duration %s", (duration) => {
    for (const metric of ["scrollInputToPresentationMs", "scrollAutomationDispatchMs", "scrollBrowserToPresentationMs"] as const) {
      const current = result("responsiveness")
      current.scenarios.find((value) => value.wheelProtocol)!.runs[0][metric] = duration
      expect(resultContract.safeParse(current).success).toBe(duration === 0 && metric === "scrollAutomationDispatchMs")
    }
  })

  it("retains the same relative allowance for native scroll timing", () => {
    const before = result("responsiveness")
    const current = result("responsiveness")
    const scenario = current.scenarios.find((value) => value.wheelProtocol)!
    for (const ms of [40, 41]) {
      scenario.runs.forEach((run) => {
        run.scrollBrowserToPresentationMs = ms
        run.scrollInputToPresentationMs = ms + run.scrollAutomationDispatchMs!
      })
      scenario.metrics.scrollBrowserToPresentationMs = summarize(Array(5).fill(ms))
      scenario.metrics.scrollInputToPresentationMs = summarize(Array(5).fill(ms + 5))
      const report = assessComparison(before, current)
      expect(report.measurementErrors).toEqual([])
      expect(report.regressions).toHaveLength(ms === 40 ? 0 : 1)
      if (ms === 41) expect(report.regressions![0]).toContain("scrollBrowserToPresentationMs: 20 → 41ms")
    }
  })

  it("keeps automation delay diagnostic while requiring an additive raw breakdown", () => {
    const before = result("responsiveness")
    const current = result("responsiveness")
    const scenario = current.scenarios.find((value) => value.wheelProtocol)!
    scenario.runs.forEach((run) => {
      run.scrollAutomationDispatchMs = 500
      run.scrollInputToPresentationMs = 520
    })
    scenario.metrics.scrollAutomationDispatchMs = summarize(Array(5).fill(500))
    scenario.metrics.scrollInputToPresentationMs = summarize(Array(5).fill(520))
    expect(compareResults(before, current)).toEqual([])
    scenario.runs[0].scrollAutomationDispatchMs = 501
    scenario.metrics.scrollAutomationDispatchMs = summarize([501, 500, 500, 500, 500])
    expect(validateCoverage(current)).toContain(`${scenario.id}: native scroll intervals do not add up`)
  })

  it("requires raw enabled-control and joint readiness observations independently", () => {
    for (const metric of ["navigationToSendControlEnabledMs", "navigationToSendReadyMs"]) {
      const current = result("responsiveness")
      delete current.scenarios[0].runs[0].ui![metric]
      expect(validateCoverage(current).join(" ")).toContain(`${metric} missing from an individual run`)
    }
  })

  it("rejects legacy readiness and DOM-wheel protocols rather than relabeling them", () => {
    const current = result("responsiveness")
    expect(resultContract.safeParse({ ...current, accountReadinessProtocol: undefined }).success).toBe(false)
    for (const protocol of [
      { wheelProtocol: "prepared-wheel-v1" },
      { wheelProtocol: "native-presentation-v1" },
      { wheelProtocol: "native-browser-presentation-v1" },
      { interactionProtocol: "late-typing-wheel-menu-v1" },
    ]) {
      const legacy = structuredClone(current)
      Object.assign(legacy.scenarios.find((value) => value.wheelProtocol)!, protocol)
      expect(resultContract.safeParse(legacy).success).toBe(false)
    }
  })

  it("rejects menu captures using the old post-mousedown click anchor", () => {
    const before = result("responsiveness")
    const current = result("responsiveness")
    delete before.scenarios[3].menuProtocol
    expect(compareResults(before, current).join(" ")).toContain("scenario missing")
    before.scenarios[3].menuProtocol = "activation-v1"
    expect(compareResults(before, current)).toEqual([])
  })

  it("does not compare late probes with a different interaction order", () => {
    const before = result("responsiveness")
    const current = result("responsiveness")
    delete before.scenarios[3].interactionProtocol
    expect(assessComparison(before, current).regressions).toBeNull()
    expect(validateCoverage(before).join(" ")).toContain("unexpected scenarios")
    before.scenarios[3].interactionProtocol = "late-typing-native-wheel-menu-v2"
    expect(compareResults(before, current)).toEqual([])
  })

  it("rejects streamed content captured without the publication-frame protocol", () => {
    const before = result()
    delete before.scenarios[0].contentFrameProtocol
    expect(validateCoverage(before).join(" ")).toContain("content-frame protocol")
    expect(compareResults(before, result()).join(" ")).toContain("scenario missing")
  })

  it("rejects failures and malformed numbers rather than dropping them", () => {
    const invalid = result()
    invalid.scenarios[0].metrics.inputToFirstTextFrameMs.p50 = NaN
    expect(resultContract.safeParse(invalid).success).toBe(false)
    expect(
      resultContract.safeParse({ ...result(), schemaVersion: 1 }).success
    ).toBe(false)
    expect(resultContract.safeParse({ ...result(), schemaVersion: 2 }).success).toBe(false)
    expect(resultContract.safeParse({ ...result(), measurementVersion: "dom-frame-v2" }).success).toBe(false)
    expect(resultContract.safeParse({ ...result(), typingCadenceMs: undefined }).success).toBe(false)
    expect(() => summarize([1, NaN])).toThrow()
    expect(summarize([-1]).p50).toBe(-1) // DOM growth is a signed count.
  })

  it("uses the middle-pair median without changing tail summaries or input order", () => {
    const values = [40, 10, 30, 20]
    expect(summarize(values)).toEqual({ n: 4, p50: 25, p75: 40, max: 40 })
    expect(values).toEqual([40, 10, 30, 20])
    expect(summarize([30, 10, 20]).p50).toBe(20)
    expect(summarize([-4, -2]).p50).toBe(-3)
    expect(summarize([])).toEqual({ n: 0, p50: 0, p75: 0, max: 0 })
    expect(summarize(Array.from({ length: 20 }, (_, index) => index + 1)))
      .toEqual({ n: 20, p50: 10.5, p75: 16, p95: 20, max: 20 })
    // The correction can strengthen detection too; upper-middle values differ by 10.
    expect(summarize([80, 110]).p50 - summarize([0, 100]).p50).toBe(45)
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

  it("requires all declared forced-GC checkpoints while keeping historical latency evidence usable", () => {
    const current = threadResult()
    const thread = current.threadSwitch!
    thread.switchCount = 50
    const visited = thread.passes.find((pass) => pass.kind === "visited")!
    visited.switches = 50
    visited.samples = Array.from({ length: 50 }, () => ({ ...visited.samples[0] }))
    visited.cacheHits = 0
    for (const [metric, field] of [
      ["navToThreadPaintedMs", "navToPaintedMs"],
      ["intentToRouteCommitMs", "intentToCommitMs"],
      ["commitToFirstContentMs", "commitToFirstContentMs"],
      ["firstContentToPaintedMs", "firstContentToPaintedMs"],
      ["querySetAddsPerSwitch", "querySetAdds"],
    ] as const) visited[metric] = summarize(visited.samples.map((sample) => sample[field]!))
    thread.heapSamples = []
    expect(validateCoverage(current)).toEqual([])
    thread.heapProtocol = "forced-gc-v1"
    thread.heapSamples = [0, 10, 25, 50].map((switches) => ({ switches, jsHeapUsedBytes: 1000 }))
    expect(resultContract.parse(current).threadSwitch!.heapProtocol).toBe("forced-gc-v1")
    expect(validateCoverage(current)).toEqual([])
    for (const checkpoint of [0, 10, 25, 50]) {
      const missing = structuredClone(current)
      missing.threadSwitch!.heapSamples = thread.heapSamples.filter((sample) => sample.switches !== checkpoint)
      expect(validateCoverage(missing)).toContain("thread-switch forced-GC heap checkpoints are incomplete")
    }
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
    const current = result("durable")
    const stopped = current.scenarios.find((scenario) => scenario.action === "stop")!
    expect(stopped.metrics.terminalToReadyFrameMs).toBeUndefined()
    expect(validateCoverage(current)).toEqual([])
    for (const outcome of [undefined, "completed", "failed"]) {
      stopped.runs[0].correctness.settlementOutcome = outcome
      expect(validateCoverage(current).join(" ")).toContain(
        "authenticated Stop did not settle as aborted"
      )
    }
    stopped.runs[0].correctness.settlementOutcome = "aborted"
    stopped.runs[0].stopSourceLengths!.afterSettlement = 90
    expect(validateCoverage(current).join(" ")).toContain("text grew after Stop")
    delete stopped.runs[0].stopSourceLengths
    expect(validateCoverage(current).join(" ")).toContain("Stop stability observations are missing")
  })
})
