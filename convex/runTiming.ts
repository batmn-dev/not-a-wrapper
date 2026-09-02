import { v } from "convex/values"
import { internalQuery } from "./_generated/server"
import {
  pacingOverheadMs,
  RUN_TIMING_RECEIPT_DURATION_FIELDS,
  serverTimeToFirstOutputMs,
  type RunTimingReceipt,
} from "./lib/runTimingReceipt"

/**
 * Run timing receipt summary (ADR-0030): completed runs in a time window,
 * grouped by logical model, route, and build, with p50/max per receipt
 * segment plus the two derived figures. Internal — read from the terminal:
 *
 *   bunx convex run runTiming:timingSummary "{\"sinceMs\": $(( $(date +%s) * 1000 - 7*24*60*60*1000 ))}"
 *
 * Reads at most `limit` rows (default 2000, max 5000), newest first, from the
 * status+completedAt index; that read is the only table access, so the scan
 * is bounded regardless of `sinceMs`. The `model`/`buildId` filters apply in
 * memory WITHIN that window (neither field is indexed), so a filtered summary
 * over a capped window (`scannedRuns === limit`) can omit older matches:
 * narrow `sinceMs` or raise `limit`. `matchedRuns` counts what the filters
 * kept. `p95` follows the metric dictionary's non-metrics rule: absent under
 * `P95_MINIMUM_SAMPLES` samples rather than reported from a handful of runs.
 */

/** Below this many samples the dictionary forbids a p95; report median/max. */
export const P95_MINIMUM_SAMPLES = 20

const SUMMARY_METRICS = [
  ...RUN_TIMING_RECEIPT_DURATION_FIELDS,
  "serverTimeToFirstOutputMs",
  "pacingOverheadMs",
] as const

type SummaryMetric = (typeof SUMMARY_METRICS)[number]

type MetricSamples = Record<SummaryMetric, number[]>

function emptySamples(): MetricSamples {
  const samples = {} as MetricSamples
  for (const metric of SUMMARY_METRICS) samples[metric] = []
  return samples
}

function metricValue(
  receipt: RunTimingReceipt,
  metric: SummaryMetric
): number | undefined {
  if (metric === "serverTimeToFirstOutputMs")
    return serverTimeToFirstOutputMs(receipt)
  if (metric === "pacingOverheadMs") return pacingOverheadMs(receipt)
  return receipt[metric]
}

/** Nearest-rank percentile over an unsorted sample; undefined when empty. */
function percentile(values: number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000

export const timingSummary = internalQuery({
  args: {
    sinceMs: v.optional(v.number()),
    model: v.optional(v.string()),
    buildId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const since = args.sinceMs ?? Date.now() - DEFAULT_WINDOW_MS
    const limit = Math.min(5000, Math.max(1, Math.floor(args.limit ?? 2000)))
    // `take` before filtering: a `.filter()` on the index range would keep
    // reading past sparse matches until `limit` were met, unbounded by `sinceMs`.
    const scanned = await ctx.db
      .query("generationRuns")
      .withIndex("by_status_completed", (q) =>
        q.eq("status", "completed").gte("completedAt", since)
      )
      .order("desc")
      .take(limit)
    const runs = scanned.filter(
      (run) =>
        (args.model === undefined || run.model === args.model) &&
        (args.buildId === undefined ||
          run.timingReceipt?.buildId === args.buildId)
    )

    const groups = new Map<
      string,
      {
        model: string
        routeId: string | undefined
        buildId: string | undefined
        runs: number
        withReceipt: number
        samples: MetricSamples
      }
    >()

    for (const run of runs) {
      const buildId = run.timingReceipt?.buildId
      const key = `${run.model}\u0000${run.routeId ?? ""}\u0000${buildId ?? ""}`
      let group = groups.get(key)
      if (!group) {
        group = {
          model: run.model,
          routeId: run.routeId,
          buildId,
          runs: 0,
          withReceipt: 0,
          samples: emptySamples(),
        }
        groups.set(key, group)
      }
      group.runs += 1
      const receipt = run.timingReceipt
      if (!receipt) continue
      group.withReceipt += 1
      for (const metric of SUMMARY_METRICS) {
        const value = metricValue(receipt, metric)
        if (value !== undefined) group.samples[metric].push(value)
      }
    }

    return {
      sinceMs: since,
      scannedRuns: scanned.length,
      matchedRuns: runs.length,
      groups: [...groups.values()]
        .sort((a, b) => b.runs - a.runs)
        .map((group) => ({
          model: group.model,
          routeId: group.routeId,
          buildId: group.buildId,
          runs: group.runs,
          withReceipt: group.withReceipt,
          metrics: Object.fromEntries(
            SUMMARY_METRICS.map((metric) => {
              const samples = group.samples[metric]
              return [
                metric,
                {
                  n: samples.length,
                  p50: percentile(samples, 0.5),
                  max: percentile(samples, 1),
                  p95:
                    samples.length >= P95_MINIMUM_SAMPLES
                      ? percentile(samples, 0.95)
                      : undefined,
                },
              ]
            })
          ),
        })),
    }
  },
})
