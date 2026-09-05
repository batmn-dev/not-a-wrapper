import { pacingOverheadMs } from "@/convex/lib/runTimingReceipt"
import { z } from "zod"
import { summarize, type MetricSummary } from "./result-schema"
import {
  directiveFor,
  DURABLE_SUITE,
  RESPONSIVENESS_SUITE,
  SMOKE_SUITE,
  STANDARD_SUITE,
  type BrowserScenarioConfig,
} from "./scenarios"

const duration = z.number().finite().nonnegative()
const summary = z
  .object({
    n: z.number().int().nonnegative(),
    p50: z.number().finite(),
    p75: z.number().finite(),
    p95: z.number().finite().optional(),
    max: z.number().finite(),
  })
  .refine(
    (value) => value.n >= 20 === (value.p95 !== undefined),
    "p95 must be present exactly when n >= 20"
  )

const scenario = z
  .object({
    id: z.string().min(1),
    scenario: z.string(),
    directive: z.string(),
    viewport: z.string(),
    cpuThrottle: z.number().positive(),
    network: z.enum(["unthrottled", "constrained"]),
    cache: z.enum(["cold", "warm"]),
    auth: z.boolean(),
    followup: z.boolean(),
    wheelProtocol: z.literal("prepared-wheel-v1").optional(),
    menuProtocol: z.literal("activation-v1").optional(),
    contentFrameProtocol: z.literal("publisher-frame-v1").optional(),
    action: z.enum(["complete", "stop", "second-tab", "reload"]),
    sampleCount: z.number().int().min(5),
    warmupRuns: z.number().int().nonnegative(),
    correctnessOk: z.literal(true),
    metrics: z.record(z.string(), summary),
    runs: z.array(
      z
        .object({
          correctness: z.object({
            ok: z.literal(true),
            settlementOutcome: z.string().nullable().optional(),
          }),
          hiddenDuringMeasurement: z.literal(false),
          pendingDeltaSamples: z.number().int().nonnegative(),
          droppedUiSamples: z.literal(0),
          stopSourceLengths: z.object({
            atReady: z.number().int().nonnegative(),
            after250Ms: z.number().int().nonnegative(),
            afterSettlement: z.number().int().nonnegative(),
          }).optional(),
          ui: z.record(z.string(), z.array(duration)).optional(),
          sendToFirstVisibleTextMs: duration.optional(),
          totalBlockingTimeMs: duration.optional(),
          reloadToAuthoritativeMs: duration.optional(),
          // Signed ordering offset: a durable receipt can precede local terminal.
          terminalToSettlementReceiptMs: z.number().finite().optional(),
          timingReceipt: z.record(z.string(), duration).optional(),
          serverSpans: z.record(z.string(), duration).optional(),
        })
        .passthrough()
    ),
  })
  .refine(
    (value) => value.runs.length === value.sampleCount,
    "run count mismatch"
  )

export const resultContract = z
  .object({
    schemaVersion: z.literal(2),
    measurementVersion: z.literal("dom-frame-v3"),
    typingCadenceMs: z.literal(40),
    replayPolicy: z.literal("disabled-v1"),
    identityProtocol: z.enum(["ci-isolated-v1", "attached-session-v1"]),
    profiled: z.literal(false).optional(),
    buildClass: z.literal("production"),
    instrumentationBuild: z.boolean(),
    machineClass: z.string().min(1),
    cpuModel: z.string().min(1),
    cpuCount: z.number().positive(),
    memoryGb: z.number().positive(),
    browserVersion: z.string().min(1),
    fixtureHash: z.string().min(1),
    suite: z.string().min(1),
    scenarios: z.array(scenario),
    threadSwitch: z
      .object({
        correctnessOk: z.literal(true),
        chatCount: z.number().int().min(2),
        switchCount: z.number().int().min(5),
        hoverMs: duration,
        documents: z.number().int().positive(),
        passes: z
          .array(
            z
              .object({
                kind: z.enum(["unvisited-click", "unvisited-hover", "visited"]),
                switches: z.number().int().min(5),
                navToThreadPaintedMs: summary,
                intentToRouteCommitMs: summary,
                commitToFirstContentMs: summary,
                firstContentToPaintedMs: summary,
                querySetAddsPerSwitch: summary,
                cacheHits: z.number().int().nonnegative(),
                cacheMisses: z.number().int().nonnegative(),
                samples: z.array(
                  z.object({
                    navToPaintedMs: duration,
                    intentToCommitMs: duration.optional(),
                    commitToFirstContentMs: duration.optional(),
                    firstContentToPaintedMs: duration.optional(),
                    cache: z.enum(["hit", "miss"]).optional(),
                    querySetAdds: z.number().int().nonnegative(),
                    ok: z.literal(true),
                    detail: z.string().optional(),
                  })
                ),
              })
              .passthrough()
          )
          .length(3),
        heapSamples: z.array(
          z.object({
            switches: z.number().int().nonnegative(),
            jsHeapUsedBytes: z.number().int().nonnegative(),
          })
        ),
        detail: z.string().optional(),
      })
      .optional(),
  })
  .refine(
    (value) => value.scenarios.length > 0 || value.threadSwitch !== undefined,
    "empty benchmark is not a pass"
  )

export type ComparableResult = z.infer<typeof resultContract>

function matchesSamples(
  value: MetricSummary | undefined,
  samples: number[]
): boolean {
  const actual = summarize(samples)
  return (
    value !== undefined &&
    (Object.keys(actual) as Array<keyof MetricSummary>).every(
      (key) => value[key] === actual[key]
    ) &&
    value.p95 === actual.p95
  )
}

export function scenarioKey(
  value: Pick<
    ComparableResult["scenarios"][number],
    | "id"
    | "directive"
    | "action"
    | "viewport"
    | "cpuThrottle"
    | "network"
    | "cache"
    | "auth"
    | "followup"
    | "wheelProtocol"
    | "menuProtocol"
    | "contentFrameProtocol"
  >
): string {
  return [
    value.id,
    value.directive,
    value.action,
    value.viewport,
    value.cpuThrottle,
    value.network,
    value.cache,
    value.auth,
    value.followup,
    value.wheelProtocol,
    value.menuProtocol,
    value.contentFrameProtocol,
  ].join("/")
}

export const UI_BUDGETS: Record<string, number> = {
  inputToOptimisticFrameMs: 100,
  stopToReadyFrameMs: 100,
  typingToFrameMs: 50,
  deltaToContentFrameMs: 50,
  menuToFrameMs: 100,
}

const GATES: Record<string, { relative: number; floor: number }> = {
  inputToOptimisticFrameMs: { relative: 0.35, floor: 20 },
  inputToFirstTextFrameMs: { relative: 0.35, floor: 150 },
  inputToFirstActivityFrameMs: { relative: 0.35, floor: 100 },
  navigationToComposerInputMs: { relative: 0.35, floor: 150 },
  navigationToSendReadyMs: { relative: 0.35, floor: 150 },
  typingToFrameMs: { relative: 0.35, floor: 15 },
  typingToFrameEarlyMs: { relative: 0.35, floor: 15 },
  typingToFrameLateMs: { relative: 0.35, floor: 15 },
  deltaToContentFrameMs: { relative: 0.35, floor: 15 },
  deltaToContentFrameEarlyMs: { relative: 0.35, floor: 15 },
  deltaToContentFrameLateMs: { relative: 0.35, floor: 15 },
  menuToFrameMs: { relative: 0.35, floor: 20 },
  menuToFrameEarlyMs: { relative: 0.35, floor: 20 },
  menuToFrameLateMs: { relative: 0.35, floor: 20 },
  scrollToFrameLateMs: { relative: 0.35, floor: 20 },
  terminalToReadyFrameMs: { relative: 0.35, floor: 30 },
  stopToReadyFrameMs: { relative: 0.35, floor: 20 },
  sendToFirstVisibleTextMs: { relative: 0.35, floor: 150 },
  totalBlockingTimeMs: { relative: 0.5, floor: 100 },
  prepareMs: { relative: 0.35, floor: 40 },
  firstWriteDelayMs: { relative: 0.5, floor: 20 },
  pacingOverheadMs: { relative: 0.5, floor: 50 },
  settlementTotalMs: { relative: 0.5, floor: 100 },
  reloadToAuthoritativeMs: { relative: 0.35, floor: 150 },
}

type RawRun = ComparableResult["scenarios"][number]["runs"][number]
const RAW_GATED_METRICS = {
  sendToFirstVisibleTextMs: (run: RawRun) => run.sendToFirstVisibleTextMs,
  totalBlockingTimeMs: (run: RawRun) => run.totalBlockingTimeMs,
  reloadToAuthoritativeMs: (run: RawRun) => run.reloadToAuthoritativeMs,
  prepareMs: (run: RawRun) => run.timingReceipt?.prepareMs,
  firstWriteDelayMs: (run: RawRun) => run.timingReceipt?.firstWriteDelayMs,
  pacingOverheadMs: (run: RawRun) =>
    run.timingReceipt ? pacingOverheadMs(run.timingReceipt) : undefined,
  settlementTotalMs: (run: RawRun) => run.serverSpans?.settlement_total,
  terminalToSettlementReceiptMs: (run: RawRun) =>
    run.terminalToSettlementReceiptMs,
}

const THREAD_SUMMARY_FIELDS = {
  navToThreadPaintedMs: "navToPaintedMs",
  intentToRouteCommitMs: "intentToCommitMs",
  commitToFirstContentMs: "commitToFirstContentMs",
  firstContentToPaintedMs: "firstContentToPaintedMs",
  querySetAddsPerSwitch: "querySetAdds",
} as const

const EXPECTED_SUITES = new Map<string, readonly BrowserScenarioConfig[]>([
  ["standard", STANDARD_SUITE],
  ["smoke", SMOKE_SUITE],
  ["durable", DURABLE_SUITE],
  ["responsiveness", RESPONSIVENESS_SUITE],
  ["thread-switch", []],
])

function observedNumbers(values: Array<number | undefined>): number[] {
  return values.filter((value): value is number => value !== undefined)
}

export function validateCoverage(result: ComparableResult): string[] {
  const errors: string[] = []
  if (result.scenarios.some((scenario) => scenario.contentFrameProtocol !== "publisher-frame-v1"))
    errors.push("missing content-frame protocol: publisher-frame-v1")
  const keys = result.scenarios.map(scenarioKey)
  if (new Set(keys).size !== keys.length)
    errors.push("duplicate scenario identity")
  const expectedSuite = EXPECTED_SUITES.get(result.suite)
  if (!expectedSuite) errors.push(`unknown benchmark suite: ${result.suite}`)
  else {
    const expected = new Set(
      expectedSuite.map((config) =>
        scenarioKey({
          ...config,
          directive: directiveFor(config),
          network: config.network ?? "unthrottled",
          cache: config.cache ?? "warm",
          auth: config.auth ?? false,
          followup: config.followup ?? false,
          wheelProtocol: config.interact ? "prepared-wheel-v1" : undefined,
          menuProtocol: config.interact ? "activation-v1" : undefined,
          contentFrameProtocol: "publisher-frame-v1",
        })
      )
    )
    const actual = new Set(keys)
    if (
      expected.size !== actual.size ||
      [...expected].some((id) => !actual.has(id))
    )
      errors.push(
        `${result.suite} suite is incomplete or has unexpected scenarios`
      )
  }
  if (result.threadSwitch) {
    const passes = result.threadSwitch.passes
    if (
      passes.find((pass) => pass.kind === "visited")?.switches !==
      result.threadSwitch.switchCount
    )
      errors.push(
        "thread-switch visited count differs from declared switchCount"
      )
    if (new Set(passes.map((pass) => pass.kind)).size !== 3)
      errors.push("thread-switch pass identities are incomplete or duplicated")
    if (passes.some((pass) => pass.navToThreadPaintedMs.n !== pass.switches))
      errors.push("thread-switch sample count mismatch")
    for (const pass of passes) {
      if (pass.samples.length !== pass.switches)
        errors.push(`thread-switch ${pass.kind}: raw sample count mismatch`)
      for (const [metric, field] of Object.entries(THREAD_SUMMARY_FIELDS)) {
        if (
          !matchesSamples(
            pass[metric as keyof typeof THREAD_SUMMARY_FIELDS],
            observedNumbers(pass.samples.map((sample) => sample[field]))
          )
        )
          errors.push(
            `thread-switch ${pass.kind}: ${metric} summary disagrees with raw samples`
          )
      }
      if (
        pass.cacheHits !==
          pass.samples.filter((sample) => sample.cache === "hit").length ||
        pass.cacheMisses !==
          pass.samples.filter((sample) => sample.cache === "miss").length
      )
        errors.push(
          `thread-switch ${pass.kind}: cache counts disagree with raw samples`
        )
    }
    const heap = result.threadSwitch.heapSamples
    if (
      new Set(heap.map((sample) => sample.switches)).size !== heap.length ||
      heap.some((sample) => sample.switches > result.threadSwitch!.switchCount)
    )
      errors.push(
        "thread-switch heap checkpoints are duplicated or outside the visited pass"
      )
  }
  for (const value of result.scenarios) {
    if (value.action === "stop") {
      for (const run of value.runs) {
        if (value.auth && run.correctness.settlementOutcome !== "aborted")
          errors.push(`${value.id}: authenticated Stop did not settle as aborted`)
        const lengths = run.stopSourceLengths
        if (!lengths)
          errors.push(`${value.id}: Stop stability observations are missing`)
        else if (
          lengths.after250Ms > lengths.atReady ||
          lengths.afterSettlement > lengths.after250Ms
        )
          errors.push(`${value.id}: assistant text grew after Stop feedback`)
      }
    }
    if (
      value.action === "complete" &&
      value.runs.some((run) => run.pendingDeltaSamples > 0)
    )
      errors.push(`${value.id}: received content was never observed rendering`)
    const uiMetrics = new Set([
      ...value.runs.flatMap((run) => Object.keys(run.ui ?? {})),
      ...Object.keys(GATES).filter(
        (metric) =>
          !(metric in RAW_GATED_METRICS) && value.metrics[metric] !== undefined
      ),
    ])
    for (const metric of uiMetrics) {
      const samples = value.runs.flatMap((run) => run.ui?.[metric] ?? [])
      if (
        metric in GATES &&
        samples.length > 0 &&
        value.runs.some((run) => !run.ui?.[metric]?.length)
      )
        errors.push(`${value.id}: ${metric} missing from an individual run`)
      if (!matchesSamples(value.metrics[metric], samples))
        errors.push(`${value.id}: ${metric} summary disagrees with raw samples`)
    }
    for (const [metric, read] of Object.entries(RAW_GATED_METRICS)) {
      const samples = observedNumbers(value.runs.map(read))
      if (
        metric in GATES &&
        samples.length > 0 &&
        samples.length !== value.sampleCount
      )
        errors.push(`${value.id}: ${metric} missing from an individual run`)
      if (
        (samples.length > 0 || value.metrics[metric] !== undefined) &&
        !matchesSamples(value.metrics[metric], samples)
      )
        errors.push(`${value.id}: ${metric} summary disagrees with raw samples`)
    }
    for (const [metric, summary] of Object.entries(value.metrics)) {
      if (
        metric.endsWith("Ms") &&
        metric !== "terminalToSettlementReceiptMs" &&
        [summary.p50, summary.p75, summary.p95 ?? 0, summary.max].some(
          (duration) => duration < 0
        )
      )
        errors.push(`${value.id}: ${metric} has a negative duration`)
    }
    const required =
      value.action === "reload"
        ? ["reloadToAuthoritativeMs"]
        : ["inputToOptimisticFrameMs", "inputToFirstTextFrameMs"]
    if (value.action === "complete") required.push("terminalToReadyFrameMs")
    if (value.action === "stop") required.push("stopToReadyFrameMs")
    if (value.scenario === "mixed-markdown")
      required.push("inputToFirstActivityFrameMs")
    if (result.suite === "responsiveness") {
      required.push("navigationToComposerInputMs", "navigationToSendReadyMs")
      if (value.scenario === "long-markdown")
        required.push(
          "typingToFrameMs",
          "typingToFrameEarlyMs",
          "typingToFrameLateMs",
          "menuToFrameMs",
          "menuToFrameEarlyMs",
          "menuToFrameLateMs",
          "scrollToFrameMs",
          "scrollToFrameLateMs",
          "deltaToContentFrameMs",
          "deltaToContentFrameEarlyMs",
          "deltaToContentFrameLateMs"
        )
    }
    for (const metric of required) {
      const count = value.metrics[metric]?.n ?? 0
      if (count < value.sampleCount)
        errors.push(
          `${value.id}: ${metric} missing samples (${count}/${value.sampleCount})`
        )
      if (
        metric !== "reloadToAuthoritativeMs" &&
        value.runs.some((run) => !run.ui?.[metric]?.length)
      ) {
        errors.push(`${value.id}: ${metric} missing from an individual run`)
      }
    }
  }
  return errors
}

export function checkBudgets(result: ComparableResult): string[] {
  const errors: string[] = []
  for (const scenario of result.scenarios) {
    if (scenario.cpuThrottle !== 1 || scenario.network !== "unthrottled")
      continue
    for (const [metric, budget] of Object.entries(UI_BUDGETS)) {
      const values = scenario.runs.flatMap((run) => run.ui?.[metric] ?? [])
      if (!values.length) continue
      const exceeded = values.filter((value) => value > budget).length
      if (exceeded / values.length > 0.05)
        errors.push(
          `${scenario.id} ${metric}: ${exceeded}/${values.length} exceed ${budget}ms (budget: at most 5%)`
        )
    }
  }
  return errors
}

export const ENVIRONMENT_FIELDS = [
  "measurementVersion",
  "typingCadenceMs",
  "replayPolicy",
  "identityProtocol",
  "buildClass",
  "instrumentationBuild",
  "machineClass",
  "cpuModel",
  "cpuCount",
  "memoryGb",
  "browserVersion",
  "fixtureHash",
  "suite",
] as const satisfies readonly (keyof ComparableResult)[]

export function compareResults(
  base: ComparableResult,
  current: ComparableResult
): string[] {
  const errors = [
    ...validateCoverage(base),
    ...validateCoverage(current),
    ...checkBudgets(current),
  ]
  for (const field of ENVIRONMENT_FIELDS) {
    if (base[field] !== current[field])
      errors.push(`${field} mismatch; collect a matching baseline`)
  }
  const baseline = new Map(
    base.scenarios.map((value) => [scenarioKey(value), value])
  )
  const candidate = new Map(
    current.scenarios.map((value) => [scenarioKey(value), value])
  )
  for (const key of new Set([...baseline.keys(), ...candidate.keys()])) {
    const a = baseline.get(key)
    const b = candidate.get(key)
    if (!a || !b) {
      errors.push(`scenario missing from ${a ? "current" : "baseline"}: ${key}`)
      continue
    }
    if (a.warmupRuns !== b.warmupRuns)
      errors.push(`${key}: warmupRuns mismatch`)
    for (const [metric, gate] of Object.entries(GATES)) {
      const before = a.metrics[metric]
      const after = b.metrics[metric]
      if (!before?.n && !after?.n) continue
      if (!before?.n || !after?.n) {
        errors.push(`${key}: ${metric} missing samples`)
        continue
      }
      if (
        after.p50 - before.p50 >
        Math.max(before.p50 * gate.relative, gate.floor)
      )
        errors.push(`${key} ${metric}: ${before.p50} → ${after.p50}ms`)
    }
  }
  if (Boolean(base.threadSwitch) !== Boolean(current.threadSwitch))
    errors.push("thread-switch coverage mismatch")
  if (base.threadSwitch && current.threadSwitch) {
    for (const field of [
      "chatCount",
      "switchCount",
      "hoverMs",
      "documents",
    ] as const)
      if (base.threadSwitch[field] !== current.threadSwitch[field])
        errors.push(`thread-switch ${field} mismatch`)
  }
  for (const before of base.threadSwitch?.passes ?? []) {
    const after = current.threadSwitch?.passes.find(
      (pass) => pass.kind === before.kind
    )
    if (!after || after.navToThreadPaintedMs.n < after.switches)
      errors.push(`thread-switch ${before.kind}: missing samples`)
    else if (
      after.navToThreadPaintedMs.p50 - before.navToThreadPaintedMs.p50 >
      Math.max(30, before.navToThreadPaintedMs.p50 * 0.35)
    )
      errors.push(`thread-switch ${before.kind}: navigation regressed`)
  }
  return errors
}
